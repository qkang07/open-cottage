/**
 * RAG 检索：query → topK 相似 chunks
 * 暴力余弦相似度（适合 ≤50000 chunks）
 */

import { getCottageConfig } from '../config/store';
import { workspace } from '../workspace/FileSystemWorkspace';
import {
  matchesPathFilters,
  matchesSizeFilters,
  mergeIncludeGlobs,
  type FileSearchFilters,
} from '../workspace/searchFilters';
import { getEmbeddingProvider } from './embeddingProvider';
import type { EmbeddingProvider, RetrievalResult } from './types';
import {
  getChunkIdsOrdered,
  loadChunksMeta,
  loadManifest,
  loadVectors,
} from './vectorStore';
import { loadVectorsPacked, migrateLegacyVectors } from './chunkVectorStore';
import { computeCosineScores } from './wasm/cosineKernel';

/**
 * 计算余弦相似度（向量已归一化时等于点积）
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export interface SearchSemanticOptions extends FileSearchFilters {
  /** 返回的最大结果数 */
  topK?: number;
  /** 最低分数阈值 */
  minScore?: number;
  signal?: AbortSignal;
}

/**
 * 语义检索：对查询文本嵌入后，在索引中做暴力相似度搜索
 * @returns topK 结果，按分数降序
 */
export async function searchSemantic(
  query: string,
  options: SearchSemanticOptions = {},
): Promise<RetrievalResult[]> {
  const config = getCottageConfig();
  const ragConfig = config.rag!;
  const retrievalConfig = ragConfig.retrieval!;

  const topK = options.topK ?? retrievalConfig.topK ?? 5;
  const minScore = options.minScore ?? retrievalConfig.minScore ?? 0.35;
  const pathFilters: FileSearchFilters = {
    include: mergeIncludeGlobs(options.include, options.extensions),
    exclude: options.exclude,
    minSizeBytes: options.minSizeBytes,
    maxSizeBytes: options.maxSizeBytes,
  };
  const needsSizeCheck =
    pathFilters.minSizeBytes !== undefined ||
    pathFilters.maxSizeBytes !== undefined;
  const sizeCache = new Map<string, number | null>();

  // Load index
  const manifest = await loadManifest();
  if (!manifest) {
    throw new Error('INDEX_NOT_FOUND');
  }

  const chunksMeta = await loadChunksMeta();
  const chunkIds = getChunkIdsOrdered(chunksMeta);
  if (chunkIds.length !== manifest.totalChunks) {
    throw new Error('INDEX_CORRUPTED');
  }

  let vectors: Float32Array | null;
  if (manifest.vectorStorage === 'per-chunk') {
    vectors = await loadVectorsPacked(chunkIds, manifest.dim);
  } else {
    await migrateLegacyVectors().catch(() => undefined);
    const refreshed = await loadManifest();
    if (refreshed?.vectorStorage === 'per-chunk') {
      vectors = await loadVectorsPacked(chunkIds, manifest.dim);
    } else {
      vectors = await loadVectors(manifest.totalChunks, manifest.dim);
    }
  }
  if (!vectors) {
    throw new Error('INDEX_NOT_FOUND');
  }

  // Embed query
  const embeddingConfig = ragConfig.embedding!;
  let provider: EmbeddingProvider;
  try {
    provider = await getEmbeddingProvider(embeddingConfig);
  } catch (err) {
    throw new Error(
      `嵌入模型加载失败: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (provider.dim !== manifest.dim) {
    throw new Error('INDEX_MODEL_MISMATCH');
  }

  const queryVector = await provider.embedQuery(query);
  const dim = manifest.dim;
  const hasPathFilters = Boolean(
    pathFilters.include?.length || pathFilters.exclude?.length,
  );
  const hasFilters = hasPathFilters || needsSizeCheck;

  const passesSizeFilter = async (path: string): Promise<boolean> => {
    if (!needsSizeCheck) return true;
    let size = sizeCache.get(path);
    if (size === undefined) {
      const stat = await workspace.statFile(path);
      size = stat?.size ?? null;
      sizeCache.set(path, size);
    }
    return matchesSizeFilters(size, pathFilters);
  };

  // Brute-force search：优先用 WASM SIMD kernel 批量点积；不可用则逐个用 JS
  const scoreArray = options.signal?.aborted
    ? null
    : await computeCosineScores(
        queryVector,
        vectors,
        manifest.totalChunks,
        dim,
      );

  const scores: { idx: number; score: number }[] = [];
  for (let i = 0; i < manifest.totalChunks; i++) {
    if (options.signal?.aborted) break;
    const chunkId = chunkIds[i];
    const meta = chunksMeta[chunkId];
    if (!meta) continue;
    if (hasFilters) {
      if (hasPathFilters && !matchesPathFilters(meta.path, pathFilters)) continue;
      if (!(await passesSizeFilter(meta.path))) continue;
    }

    const score = scoreArray
      ? scoreArray[i]
      : cosineSimilarity(queryVector, vectors.subarray(i * dim, (i + 1) * dim));
    if (score >= minScore) {
      scores.push({ idx: i, score });
    }
  }

  // Sort descending
  scores.sort((a, b) => b.score - a.score);

  // Take topK
  const topResults = scores.slice(0, topK);

  // Map to results
  const results: RetrievalResult[] = [];
  for (const { idx, score } of topResults) {
    const chunkId = chunkIds[idx];
    const meta = chunksMeta[chunkId];
    if (!meta) continue;

    results.push({
      id: chunkId,
      path: meta.path,
      startLine: meta.startLine,
      endLine: meta.endLine,
      text: meta.preview, // Preview only for tool result; full text loaded on demand
      score,
    });
  }

  return results;
}

/**
 * 获取索引统计信息
 */
export async function getIndexStats(): Promise<{
  exists: boolean;
  totalChunks: number;
  totalFiles: number;
  model: string;
  builtAt: number;
  dim: number;
} | null> {
  const manifest = await loadManifest();
  if (!manifest) return null;

  const filesIndex = await import('./vectorStore').then((m) => m.loadFilesIndex());
  return {
    exists: true,
    totalChunks: manifest.totalChunks,
    totalFiles: Object.keys(filesIndex).length,
    model: manifest.model,
    builtAt: manifest.builtAt,
    dim: manifest.dim,
  };
}

const INDEX_FILES = [
  'manifest.json',
  'files.json',
  'chunks.json',
  'vectors.bin',
] as const;

/**
 * 向量存储详情（.cottage/index/ 各文件大小）
 */
export async function getIndexStorageInfo(): Promise<{
  stats: NonNullable<Awaited<ReturnType<typeof getIndexStats>>>;
  files: { name: string; bytes: number }[];
  totalBytes: number;
  vectorBytes: number;
} | null> {
  const stats = await getIndexStats();
  if (!stats) return null;

  const { workspace } = await import('../workspace/FileSystemWorkspace');
  const files: { name: string; bytes: number }[] = [];

  for (const name of INDEX_FILES) {
    try {
      const bytes = await workspace.readFileBytes(`.cottage/index/${name}`);
      files.push({ name, bytes: bytes.byteLength });
    } catch {
      files.push({ name, bytes: 0 });
    }
  }

  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const vectorBytes = files.find((f) => f.name === 'vectors.bin')?.bytes ?? 0;

  return { stats, files, totalBytes, vectorBytes };
}
