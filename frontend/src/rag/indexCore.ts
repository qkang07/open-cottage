/**
 * RAG 建库核心逻辑（主线程 / Worker 共用）
 */

import type { RagConfig } from '../config/constants';
import { isLikelyTextPath, matchesAnyGlob } from '../workspace/search';
import { chunkFile, hashContent } from './chunker';
import { buildMerkleSnapshot, planFileReads } from './merkle';
import { loadMerkleWs, saveMerkleWs } from './merkleStore';
import type { EmbeddingProvider } from './types';
import {
  getEmbeddingProvider,
  getExpectedEmbeddingModelId,
} from './embeddingProvider';
import { isOfficeFile } from './officeExtractor';
import type {
  IndexedFileEntry,
  IndexManifest,
  IndexProgress,
  StoredChunkMeta,
  TextChunk,
} from './types';
import {
  deleteChunkVectorsWs,
  loadChunkVectorWs,
  saveChunkVectorWs,
} from './chunkVectorStore';
import {
  getChunkIdsOrdered,
  loadChunksMetaWs,
  loadFilesIndexWs,
  loadManifestWs,
  loadVectorsWs,
  saveChunksMetaWs,
  saveFilesIndexWs,
  saveManifestWs,
} from './vectorStoreWs';
import type { IndexWorkspace } from './indexWorkspace';

export type ProgressCallback = (progress: IndexProgress) => void;

export interface BuildIndexCoreOptions {
  ws: IndexWorkspace;
  ragConfig: RagConfig;
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
  /** Office 文本抽取（Worker 内通过 RPC 回主线程） */
  readOfficeText?: (path: string) => Promise<string | null>;
}

const checkAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error('已取消');
};

async function readFileContent(
  ws: IndexWorkspace,
  path: string,
  readOfficeText?: (path: string) => Promise<string | null>,
): Promise<string | null> {
  if (isOfficeFile(path)) {
    if (readOfficeText) {
      return readOfficeText(path);
    }
    return null;
  }
  return ws.readFile(path);
}

function canReuseExistingIndex(
  force: boolean,
  manifest: IndexManifest | null,
  expectedModel: string | null,
  chunkSize: number,
  chunkOverlap: number,
): boolean {
  if (force || !manifest || !expectedModel) return false;
  if (manifest.model !== expectedModel) return false;
  if (manifest.chunkParams.chunkSize !== chunkSize) return false;
  if (manifest.chunkParams.chunkOverlap !== chunkOverlap) return false;
  return true;
}

export async function buildIndexCore(
  options: BuildIndexCoreOptions,
): Promise<{ totalChunks: number; filesIndexed: number }> {
  const { ws, ragConfig, force = false, signal, onProgress, readOfficeText } =
    options;
  const indexingConfig = ragConfig.indexing!;
  const embeddingConfig = ragConfig.embedding!;

  const chunkSize = indexingConfig.chunkSize ?? 1000;
  const chunkOverlap = indexingConfig.chunkOverlap ?? 0.15;
  const chunkStrategy = indexingConfig.chunkStrategy ?? 'char';
  const useMerkle = indexingConfig.useMerkle !== false;
  const ignoreGlobs = indexingConfig.ignoreGlobs ?? [];
  const expectedModel = getExpectedEmbeddingModelId(embeddingConfig);

  onProgress?.({
    phase: 'scanning',
    current: 0,
    total: 0,
    detail: '正在读取工作区文件结构…',
  });

  const allFiles = await ws.listFiles({ ignoreGlobs });
  const indexOfficeText = indexingConfig.indexOfficeText !== false;
  const candidates = allFiles.filter((p) => {
    if (matchesAnyGlob(p, ignoreGlobs)) return false;
    if (isLikelyTextPath(p)) return true;
    if (indexOfficeText && isOfficeFile(p)) return true;
    return false;
  });

  checkAborted(signal);

  onProgress?.({
    phase: 'scanning',
    current: candidates.length,
    total: candidates.length,
    detail: `发现 ${candidates.length} 个可索引文件`,
  });

  const existingManifest = force ? null : await loadManifestWs(ws);
  const reuseCache = canReuseExistingIndex(
    force,
    existingManifest,
    expectedModel,
    chunkSize,
    chunkOverlap,
  );
  const existingFiles = reuseCache ? await loadFilesIndexWs(ws) : {};
  const existingChunks = reuseCache ? await loadChunksMetaWs(ws) : {};
  const oldMerkle =
    reuseCache && useMerkle ? await loadMerkleWs(ws) : null;

  const filesToIndex: string[] = [];
  const unchangedChunkIds: string[] = [];
  const fileHashes: Record<string, string> = {};

  onProgress?.({
    phase: 'analyzing',
    current: 0,
    total: candidates.length,
    detail: useMerkle ? '正在比对 Merkle 目录树…' : '正在比对文件变更…',
  });

  const { pathsToRead, knownHashes } = await planFileReads(
    candidates,
    existingFiles,
    oldMerkle,
    !reuseCache || !useMerkle,
  );
  Object.assign(fileHashes, knownHashes);

  let analyzed = 0;
  for (const path of pathsToRead) {
    checkAborted(signal);
    const content = await readFileContent(ws, path, readOfficeText);
    analyzed += 1;
    if (!content) {
      onProgress?.({
        phase: 'analyzing',
        current: analyzed,
        total: pathsToRead.size,
        currentFile: path,
      });
      continue;
    }
    fileHashes[path] = await hashContent(content);
    onProgress?.({
      phase: 'analyzing',
      current: analyzed,
      total: pathsToRead.size,
      currentFile: path,
      detail: `读取变更文件 ${analyzed}/${pathsToRead.size}`,
    });
  }

  for (const path of candidates) {
    const hash = fileHashes[path];
    if (!hash) continue;
    const existing = existingFiles[path];

    if (reuseCache && existing && existing.hash === hash) {
      for (const cid of existing.chunkIds) {
        unchangedChunkIds.push(cid);
      }
    } else {
      filesToIndex.push(path);
    }
  }

  const candidateSet = new Set(candidates);
  const hasDeletions = Object.keys(existingFiles).some(
    (path) => !candidateSet.has(path),
  );
  const indexUnchanged =
    reuseCache &&
    Boolean(existingManifest) &&
    filesToIndex.length === 0 &&
    !hasDeletions;

  if (indexUnchanged && existingManifest) {
    onProgress?.({
      phase: 'done',
      current: existingManifest.totalChunks,
      total: existingManifest.totalChunks,
      detail: `索引未变更，已复用缓存（${Object.keys(existingFiles).length} 个文件，${existingManifest.totalChunks} 个片段）`,
    });
    return {
      totalChunks: existingManifest.totalChunks,
      filesIndexed: Object.keys(existingFiles).length,
    };
  }

  onProgress?.({
    phase: 'analyzing',
    current: candidates.length,
    total: candidates.length,
    detail:
      pathsToRead.size === 0
        ? `Merkle 未变，跳过 ${candidates.length} 个文件读取`
        : `需更新 ${filesToIndex.length} 个文件（读取 ${pathsToRead.size} 个）`,
  });

  checkAborted(signal);

  let provider: EmbeddingProvider | null = null;
  if (filesToIndex.length > 0) {
    onProgress?.({
      phase: 'init',
      current: 0,
      total: 1,
      detail: '准备嵌入环境…',
    });
    try {
      provider = await getEmbeddingProvider(embeddingConfig, (detail) => {
        onProgress?.({ phase: 'init', current: 0, total: 1, detail });
      });
    } catch (err) {
      throw new Error(
        `嵌入模型加载失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    checkAborted(signal);
    onProgress?.({
      phase: 'init',
      current: 1,
      total: 1,
      detail: '嵌入模型就绪',
    });
  }

  const newChunks: TextChunk[] = [];
  const newFilesIndex: Record<string, IndexedFileEntry> = {};

  if (filesToIndex.length === 0) {
    onProgress?.({
      phase: 'chunking',
      current: 0,
      total: 0,
      detail: '无文件需要重新分块',
    });
  } else {
    onProgress?.({
      phase: 'chunking',
      current: 0,
      total: filesToIndex.length,
      detail: `开始分块 ${filesToIndex.length} 个文件…`,
    });
  }

  for (let i = 0; i < filesToIndex.length; i++) {
    checkAborted(signal);
    const path = filesToIndex[i];
    const content = await readFileContent(ws, path, readOfficeText);
    if (!content) continue;

    const hash = await hashContent(content);
    const chunks = chunkFile(path, content, {
      chunkSize,
      chunkOverlap,
      strategy: chunkStrategy,
    });
    const chunkIds = chunks.map((c) => c.id);

    newFilesIndex[path] = { hash, mtime: Date.now(), chunkIds };
    newChunks.push(...chunks);

    onProgress?.({
      phase: 'chunking',
      current: i + 1,
      total: filesToIndex.length,
      currentFile: path,
      detail: `已生成 ${newChunks.length} 个片段`,
    });
  }

  for (const path of candidates) {
    if (!newFilesIndex[path] && existingFiles[path]) {
      newFilesIndex[path] = existingFiles[path];
    }
  }

  checkAborted(signal);

  onProgress?.({
    phase: 'embedding',
    current: 0,
    total: newChunks.length,
    detail:
      newChunks.length > 0
        ? `开始嵌入 ${newChunks.length} 个片段…`
        : '无需重新嵌入',
  });

  const batchSize = embeddingConfig.batchSize ?? 8;
  const newVectors: Float32Array[] = [];

  if (provider && newChunks.length > 0) {
    for (let i = 0; i < newChunks.length; i += batchSize) {
      checkAborted(signal);
      const batch = newChunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.text);
      const vectors = await provider.embed(texts);
      newVectors.push(...vectors);

      onProgress?.({
        phase: 'embedding',
        current: Math.min(i + batchSize, newChunks.length),
        total: newChunks.length,
        currentFile: batch[0]?.path,
      });
    }
  }

  checkAborted(signal);

  const saveSteps = 4;
  onProgress?.({
    phase: 'saving',
    current: 0,
    total: saveSteps,
    detail: '合并向量数据…',
  });

  const finalChunks: Record<string, StoredChunkMeta> = {};
  const allChunkTexts: { id: string; vector: Float32Array }[] = [];

  for (let i = 0; i < newChunks.length; i++) {
    const c = newChunks[i];
    finalChunks[c.id] = {
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      preview: c.text.slice(0, 80),
    };
    allChunkTexts.push({ id: c.id, vector: newVectors[i] });
  }

  if (unchangedChunkIds.length > 0 && reuseCache) {
    const oldManifest = existingManifest ?? (await loadManifestWs(ws));
    if (oldManifest) {
      if (oldManifest.vectorStorage === 'per-chunk') {
        for (const cid of unchangedChunkIds) {
          if (!existingChunks[cid]) continue;
          const vec = await loadChunkVectorWs(ws, cid, oldManifest.dim);
          if (!vec) continue;
          finalChunks[cid] = existingChunks[cid];
          allChunkTexts.push({ id: cid, vector: vec });
        }
      } else {
        const oldVectors = await loadVectorsWs(
          ws,
          oldManifest.totalChunks,
          oldManifest.dim,
        );
        const oldChunkOrder = getChunkIdsOrdered(existingChunks);

        if (oldVectors && oldChunkOrder.length === oldManifest.totalChunks) {
          for (const cid of unchangedChunkIds) {
            const idx = oldChunkOrder.indexOf(cid);
            if (idx >= 0 && existingChunks[cid]) {
              finalChunks[cid] = existingChunks[cid];
              const vec = oldVectors.slice(
                idx * oldManifest.dim,
                (idx + 1) * oldManifest.dim,
              );
              allChunkTexts.push({ id: cid, vector: new Float32Array(vec) });
            }
          }
        }
      }
    }
  }

  const vectorMap = new Map(allChunkTexts.map((v) => [v.id, v.vector]));
  const dim =
    provider?.dim ??
    existingManifest?.dim ??
    (await loadManifestWs(ws))?.dim ??
    0;
  if (!dim) {
    throw new Error('无法确定向量维度：缺少嵌入模型与既有索引');
  }
  const validChunks: Record<string, StoredChunkMeta> = {};

  for (const [cid, meta] of Object.entries(finalChunks)) {
    const vec = vectorMap.get(cid);
    if (vec && vec.length === dim) {
      validChunks[cid] = meta;
    }
  }

  const validCount = Object.keys(validChunks).length;

  if (force || hasDeletions) {
    const staleIds = Object.keys(existingChunks).filter((id) => !validChunks[id]);
    if (staleIds.length > 0) {
      await deleteChunkVectorsWs(ws, staleIds);
    }
  }

  onProgress?.({
    phase: 'saving',
    current: 1,
    total: saveSteps,
    detail: '写入 chunks.json…',
  });
  await saveChunksMetaWs(ws, validChunks);

  onProgress?.({
    phase: 'saving',
    current: 2,
    total: saveSteps,
    detail: '写入 files.json…',
  });
  await saveFilesIndexWs(ws, newFilesIndex);

  onProgress?.({
    phase: 'saving',
    current: 3,
    total: saveSteps,
    detail: '写入向量文件…',
  });
  // per-chunk 存储下复用向量已在磁盘；monolith 迁移或新 chunk 仍需写入
  const skipUnchangedVectors =
    reuseCache &&
    existingManifest?.vectorStorage === 'per-chunk' &&
    unchangedChunkIds.length > 0
      ? new Set(unchangedChunkIds)
      : null;
  for (const [cid, vec] of vectorMap.entries()) {
    if (!validChunks[cid]) continue;
    if (skipUnchangedVectors?.has(cid)) continue;
    await saveChunkVectorWs(ws, cid, vec);
  }

  const manifest: IndexManifest = {
    model: provider?.modelId ?? existingManifest?.model ?? expectedModel ?? 'unknown',
    dim,
    builtAt: Date.now(),
    chunkParams: { chunkSize, chunkOverlap },
    totalChunks: validCount,
    vectorStorage: 'per-chunk',
  };

  onProgress?.({
    phase: 'saving',
    current: 4,
    total: saveSteps,
    detail: '写入 manifest.json…',
  });
  await saveManifestWs(ws, manifest);

  if (useMerkle) {
    const merkleHashes: Record<string, string> = {};
    for (const path of candidates) {
      const fromIndex = newFilesIndex[path]?.hash;
      if (fromIndex) merkleHashes[path] = fromIndex;
    }
    const merkle = await buildMerkleSnapshot(candidates, merkleHashes);
    await saveMerkleWs(ws, merkle);
  }

  onProgress?.({
    phase: 'done',
    current: validCount,
    total: validCount,
    detail: `完成：${Object.keys(newFilesIndex).length} 个文件，${validCount} 个片段`,
  });

  return {
    totalChunks: validCount,
    filesIndexed: Object.keys(newFilesIndex).length,
  };
}
