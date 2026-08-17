/**
 * 向量存储：管理 .cottage/index/ 下的索引文件读写
 * - manifest.json: 索引元数据
 * - files.json: path → { hash, mtime, chunkIds[] }
 * - chunks.json: chunkId → { path, startLine, endLine, preview }
 * - vectors.bin: Float32Array 紧凑存储
 */

import { workspace } from '../workspace/FileSystemWorkspace';
import type { IndexedFileEntry, IndexManifest, StoredChunkMeta } from './types';

const INDEX_DIR = '.cottage/index';
const MANIFEST_FILE = `${INDEX_DIR}/manifest.json`;
const FILES_FILE = `${INDEX_DIR}/files.json`;
const CHUNKS_FILE = `${INDEX_DIR}/chunks.json`;
const VECTORS_FILE = `${INDEX_DIR}/vectors.bin`;

/** 读取 manifest */
export async function loadManifest(): Promise<IndexManifest | null> {
  try {
    const { content } = await workspace.readFile(MANIFEST_FILE);
    return content ? (JSON.parse(content) as IndexManifest) : null;
  } catch {
    return null;
  }
}

/** 写入 manifest */
export async function saveManifest(manifest: IndexManifest): Promise<void> {
  await workspace.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

/** 读取文件索引 */
export async function loadFilesIndex(): Promise<Record<string, IndexedFileEntry>> {
  try {
    const { content } = await workspace.readFile(FILES_FILE);
    return content ? (JSON.parse(content) as Record<string, IndexedFileEntry>) : {};
  } catch {
    return {};
  }
}

/** 写入文件索引 */
export async function saveFilesIndex(
  files: Record<string, IndexedFileEntry>,
): Promise<void> {
  await workspace.writeFile(FILES_FILE, JSON.stringify(files));
}

/** 读取 chunks 元数据 */
export async function loadChunksMeta(): Promise<Record<string, StoredChunkMeta>> {
  try {
    const { content } = await workspace.readFile(CHUNKS_FILE);
    return content ? (JSON.parse(content) as Record<string, StoredChunkMeta>) : {};
  } catch {
    return {};
  }
}

/** 写入 chunks 元数据 */
export async function saveChunksMeta(
  chunks: Record<string, StoredChunkMeta>,
): Promise<void> {
  await workspace.writeFile(CHUNKS_FILE, JSON.stringify(chunks));
}

/** 读取向量数据 (Float32Array 紧凑格式) */
export async function loadVectors(
  totalChunks: number,
  dim: number,
): Promise<Float32Array | null> {
  try {
    const bytes = await workspace.readFileBytes(`${INDEX_DIR}/vectors.bin`);
    if (!bytes || bytes.byteLength === 0) return null;
    const expected = totalChunks * dim * 4; // Float32 = 4 bytes
    if (bytes.byteLength !== expected) {
      console.warn(
        `[RAG] vectors.bin size mismatch: got ${bytes.byteLength}, expected ${expected}`,
      );
      return null;
    }
    return new Float32Array(bytes.buffer, bytes.byteOffset, totalChunks * dim);
  } catch {
    return null;
  }
}

/** 写入向量数据 */
export async function saveVectors(vectors: Float32Array): Promise<void> {
  const bytes = new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength);
  await workspace.writeFileBytes(VECTORS_FILE, bytes);
}

/**
 * 有序 chunk ID 列表：决定 vectors.bin 中的偏移
 * 使用 chunks.json 的 key 顺序
 */
export function getChunkIdsOrdered(
  chunksMeta: Record<string, StoredChunkMeta>,
): string[] {
  return Object.keys(chunksMeta);
}

/** 清空索引 */
export async function clearIndex(): Promise<void> {
  try { await workspace.deleteFile(MANIFEST_FILE); } catch { /* ignore */ }
  try { await workspace.deleteFile(FILES_FILE); } catch { /* ignore */ }
  try { await workspace.deleteFile(CHUNKS_FILE); } catch { /* ignore */ }
  try { await workspace.deleteFile(VECTORS_FILE); } catch { /* ignore */ }
}
