/**
 * RAG 增量索引核心逻辑（主线程 / Worker 共用）
 */

import type { RagConfig } from '../config/constants';
import { isLikelyTextPath, matchesAnyGlob } from '../workspace/search';
import { chunkFile, hashContent } from './chunker';
import { buildMerkleSnapshot } from './merkle';
import { saveMerkleWs } from './merkleStore';
import { getEmbeddingProvider } from './embeddingProvider';
import { isOfficeFile } from './officeExtractor';
import type { IndexProgress, TextChunk } from './types';
import {
  deleteChunkVectorsWs,
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

export type IncrementalProgressCallback = (progress: IndexProgress) => void;

export interface IncrementalIndexCoreOptions {
  ws: IndexWorkspace;
  ragConfig: RagConfig;
  paths: readonly string[];
  signal?: AbortSignal;
  onProgress?: IncrementalProgressCallback;
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
    return readOfficeText ? readOfficeText(path) : null;
  }
  return ws.readFile(path);
}

async function migrateLegacyVectorsWs(ws: IndexWorkspace): Promise<boolean> {
  const manifest = await loadManifestWs(ws);
  if (!manifest || manifest.vectorStorage === 'per-chunk') {
    return false;
  }

  const chunksMeta = await loadChunksMetaWs(ws);
  const chunkIds = getChunkIdsOrdered(chunksMeta);
  if (chunkIds.length === 0) return false;

  const legacy = await loadVectorsWs(ws, manifest.totalChunks, manifest.dim);
  if (!legacy) return false;

  const dim = manifest.dim;
  for (let i = 0; i < chunkIds.length; i++) {
    const chunkId = chunkIds[i];
    const vec = legacy.subarray(i * dim, (i + 1) * dim);
    await saveChunkVectorWs(ws, chunkId, new Float32Array(vec));
  }

  await ws.deleteFile('.cottage/index/vectors.bin');
  await saveManifestWs(ws, { ...manifest, vectorStorage: 'per-chunk' });
  return true;
}

export async function incrementalIndexCore(
  options: IncrementalIndexCoreOptions,
): Promise<{ newChunks: number }> {
  const { ws, ragConfig, paths, signal, onProgress, readOfficeText } = options;
  const indexingConfig = ragConfig.indexing!;
  const embeddingConfig = ragConfig.embedding!;

  const chunkSize = indexingConfig.chunkSize ?? 1000;
  const chunkOverlap = indexingConfig.chunkOverlap ?? 0.15;
  const chunkStrategy = indexingConfig.chunkStrategy ?? 'char';

  checkAborted(signal);

  const manifest = await loadManifestWs(ws);
  if (!manifest) {
    return { newChunks: 0 };
  }

  let provider;
  try {
    provider = await getEmbeddingProvider(embeddingConfig, (detail) => {
      onProgress?.({
        phase: 'init',
        current: 0,
        total: 1,
        detail,
      });
    });
  } catch {
    return { newChunks: 0 };
  }

  if (provider.dim !== manifest.dim) {
    return { newChunks: 0 };
  }

  if (manifest.vectorStorage !== 'per-chunk') {
    await migrateLegacyVectorsWs(ws).catch(() => undefined);
  }

  const filesIndex = await loadFilesIndexWs(ws);
  const chunksMeta = await loadChunksMetaWs(ws);
  const newChunks: TextChunk[] = [];
  const removedChunkIds: string[] = [];

  onProgress?.({
    phase: 'scanning',
    current: 0,
    total: paths.length,
    detail: `处理 ${paths.length} 个变更文件`,
  });

  for (let i = 0; i < paths.length; i++) {
    checkAborted(signal);
    const path = paths[i];

    onProgress?.({
      phase: 'scanning',
      current: i + 1,
      total: paths.length,
      currentFile: path,
    });

    const oldEntry = filesIndex[path];
    if (oldEntry) {
      for (const cid of oldEntry.chunkIds) {
        removedChunkIds.push(cid);
        delete chunksMeta[cid];
      }
    }

    const exists = await ws.exists(path);
    if (!exists) {
      delete filesIndex[path];
      continue;
    }

    const content = await readFileContent(ws, path, readOfficeText);
    if (!content) {
      delete filesIndex[path];
      continue;
    }

    const hash = await hashContent(content);
    const chunks = chunkFile(path, content, {
      chunkSize,
      chunkOverlap,
      strategy: chunkStrategy,
    });
    const chunkIds = chunks.map((c) => c.id);

    filesIndex[path] = { hash, mtime: Date.now(), chunkIds };
    newChunks.push(...chunks);

    for (const c of chunks) {
      chunksMeta[c.id] = {
        path: c.path,
        startLine: c.startLine,
        endLine: c.endLine,
        preview: c.text.slice(0, 80),
      };
    }
  }

  if (newChunks.length === 0 && removedChunkIds.length === 0) {
    return { newChunks: 0 };
  }

  if (removedChunkIds.length > 0) {
    await deleteChunkVectorsWs(ws, removedChunkIds);
  }

  const batchSize = embeddingConfig.batchSize ?? 8;
  for (let i = 0; i < newChunks.length; i += batchSize) {
    checkAborted(signal);
    const batch = newChunks.slice(i, i + batchSize);
    const vectors = await provider.embed(batch.map((c) => c.text));
    for (let j = 0; j < batch.length; j++) {
      await saveChunkVectorWs(ws, batch[j].id, vectors[j]);
    }
    onProgress?.({
      phase: 'embedding',
      current: Math.min(i + batchSize, newChunks.length),
      total: newChunks.length,
      detail: `嵌入 ${newChunks.length} 个片段`,
    });
  }

  await saveChunksMetaWs(ws, chunksMeta);
  await saveFilesIndexWs(ws, filesIndex);

  const totalChunks = getChunkIdsOrdered(chunksMeta).length;
  await saveManifestWs(ws, {
    ...manifest,
    totalChunks,
    builtAt: Date.now(),
    vectorStorage: 'per-chunk',
  });

  if (indexingConfig.useMerkle !== false) {
    const merkleHashes = Object.fromEntries(
      Object.entries(filesIndex).map(([path, entry]) => [path, entry.hash]),
    );
    const merkle = await buildMerkleSnapshot(
      Object.keys(filesIndex),
      merkleHashes,
    );
    await saveMerkleWs(ws, merkle);
  }

  onProgress?.({
    phase: 'done',
    current: 1,
    total: 1,
    detail: `完成，新增 ${newChunks.length} 个片段`,
  });

  return { newChunks: newChunks.length };
}

/** 过滤出需要增量索引的路径 */
export function filterIncrementalPaths(
  changedPaths: readonly string[],
  ragConfig: RagConfig,
): string[] {
  const indexingConfig = ragConfig.indexing!;
  const ignoreGlobs = indexingConfig.ignoreGlobs ?? [];
  const indexOffice = indexingConfig.indexOfficeText !== false;

  return changedPaths.filter((p) => {
    if (matchesAnyGlob(p, ignoreGlobs)) return false;
    if (isLikelyTextPath(p)) return true;
    if (indexOffice && isOfficeFile(p)) return true;
    return false;
  });
}
