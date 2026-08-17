/**
 * 按 chunk 持久化向量（.cottage/index/vectors/{encodedId}.bin）
 */

import { workspace } from '../workspace/FileSystemWorkspace';
import type { IndexWorkspace } from './indexWorkspace';
import { loadManifest, loadVectors } from './vectorStore';
import { getChunkIdsOrdered, loadChunksMeta } from './vectorStore';

const VECTORS_DIR = '.cottage/index/vectors';
const LEGACY_VECTORS_FILE = '.cottage/index/vectors.bin';

/** chunkId 含路径分隔符，编码为安全文件名 */
export const encodeChunkVectorName = (chunkId: string): string =>
  chunkId
    .replace(/\\/g, '/')
    .replace(/\//g, '__')
    .replace(/:/g, '_');

export const chunkVectorPath = (chunkId: string): string =>
  `${VECTORS_DIR}/${encodeChunkVectorName(chunkId)}.bin`;

const wsChunkVectorPath = (chunkId: string): string => chunkVectorPath(chunkId);

export async function saveChunkVector(
  chunkId: string,
  vector: Float32Array,
): Promise<void> {
  const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
  await workspace.writeFileBytes(wsChunkVectorPath(chunkId), bytes);
}

export async function saveChunkVectorWs(
  ws: IndexWorkspace,
  chunkId: string,
  vector: Float32Array,
): Promise<void> {
  const bytes = new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
  await ws.writeFileBytes(wsChunkVectorPath(chunkId), bytes);
}

export async function deleteChunkVector(chunkId: string): Promise<void> {
  try {
    await workspace.deleteFile(wsChunkVectorPath(chunkId));
  } catch {
    // ignore
  }
}

export async function deleteChunkVectorWs(
  ws: IndexWorkspace,
  chunkId: string,
): Promise<void> {
  await ws.deleteFile(wsChunkVectorPath(chunkId));
}

export async function loadChunkVector(
  chunkId: string,
  dim: number,
): Promise<Float32Array | null> {
  try {
    const bytes = await workspace.readFileBytes(wsChunkVectorPath(chunkId));
    if (!bytes || bytes.byteLength !== dim * 4) return null;
    return new Float32Array(bytes.buffer, bytes.byteOffset, dim);
  } catch {
    return null;
  }
}

export async function loadChunkVectorWs(
  ws: IndexWorkspace,
  chunkId: string,
  dim: number,
): Promise<Float32Array | null> {
  const bytes = await ws.readFileBytes(wsChunkVectorPath(chunkId));
  if (!bytes || bytes.byteLength !== dim * 4) return null;
  return new Float32Array(bytes.buffer, bytes.byteOffset, dim);
}

/** 按 chunkIds 顺序加载并打包为连续 Float32Array（检索用） */
export async function loadVectorsPacked(
  chunkIds: readonly string[],
  dim: number,
): Promise<Float32Array | null> {
  if (chunkIds.length === 0) return new Float32Array(0);
  const packed = new Float32Array(chunkIds.length * dim);
  let offset = 0;
  for (const chunkId of chunkIds) {
    const vec = await loadChunkVector(chunkId, dim);
    if (!vec) return null;
    packed.set(vec, offset);
    offset += dim;
  }
  return packed;
}

export async function loadVectorsPackedWs(
  ws: IndexWorkspace,
  chunkIds: readonly string[],
  dim: number,
): Promise<Float32Array | null> {
  if (chunkIds.length === 0) return new Float32Array(0);
  const packed = new Float32Array(chunkIds.length * dim);
  let offset = 0;
  for (const chunkId of chunkIds) {
    const vec = await loadChunkVectorWs(ws, chunkId, dim);
    if (!vec) return null;
    packed.set(vec, offset);
    offset += dim;
  }
  return packed;
}

/**
 * 将旧版 vectors.bin 拆分为 per-chunk 文件。
 * @returns 是否执行了迁移
 */
export async function migrateLegacyVectors(): Promise<boolean> {
  const manifest = await loadManifest();
  if (!manifest || manifest.vectorStorage === 'per-chunk') {
    return false;
  }

  const chunksMeta = await loadChunksMeta();
  const chunkIds = getChunkIdsOrdered(chunksMeta);
  if (chunkIds.length === 0) return false;

  const legacy = await loadVectors(manifest.totalChunks, manifest.dim);
  if (!legacy) return false;

  const dim = manifest.dim;
  for (let i = 0; i < chunkIds.length; i++) {
    const chunkId = chunkIds[i];
    const vec = legacy.subarray(i * dim, (i + 1) * dim);
    await saveChunkVector(chunkId, new Float32Array(vec));
  }

  try {
    await workspace.deleteFile(LEGACY_VECTORS_FILE);
  } catch {
    // ignore
  }

  const { saveManifest } = await import('./vectorStore');
  await saveManifest({ ...manifest, vectorStorage: 'per-chunk' });
  return true;
}

export async function deleteChunkVectors(chunkIds: Iterable<string>): Promise<void> {
  for (const chunkId of chunkIds) {
    await deleteChunkVector(chunkId);
  }
}

export async function deleteChunkVectorsWs(
  ws: IndexWorkspace,
  chunkIds: Iterable<string>,
): Promise<void> {
  for (const chunkId of chunkIds) {
    await deleteChunkVectorWs(ws, chunkId);
  }
}
