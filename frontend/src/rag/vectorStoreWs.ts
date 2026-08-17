/**
 * 向量存储（工作区 I/O 抽象版）
 */

import type { IndexedFileEntry, IndexManifest, StoredChunkMeta } from './types';
import type { IndexWorkspace } from './indexWorkspace';

const INDEX_DIR = '.cottage/index';
const MANIFEST_FILE = `${INDEX_DIR}/manifest.json`;
const FILES_FILE = `${INDEX_DIR}/files.json`;
const CHUNKS_FILE = `${INDEX_DIR}/chunks.json`;
const VECTORS_FILE = `${INDEX_DIR}/vectors.bin`;

export async function loadManifestWs(
  ws: IndexWorkspace,
): Promise<IndexManifest | null> {
  const content = await ws.readFile(MANIFEST_FILE);
  return content ? (JSON.parse(content) as IndexManifest) : null;
}

export async function saveManifestWs(
  ws: IndexWorkspace,
  manifest: IndexManifest,
): Promise<void> {
  await ws.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

export async function loadFilesIndexWs(
  ws: IndexWorkspace,
): Promise<Record<string, IndexedFileEntry>> {
  const content = await ws.readFile(FILES_FILE);
  return content ? (JSON.parse(content) as Record<string, IndexedFileEntry>) : {};
}

export async function saveFilesIndexWs(
  ws: IndexWorkspace,
  files: Record<string, IndexedFileEntry>,
): Promise<void> {
  await ws.writeFile(FILES_FILE, JSON.stringify(files));
}

export async function loadChunksMetaWs(
  ws: IndexWorkspace,
): Promise<Record<string, StoredChunkMeta>> {
  const content = await ws.readFile(CHUNKS_FILE);
  return content ? (JSON.parse(content) as Record<string, StoredChunkMeta>) : {};
}

export async function saveChunksMetaWs(
  ws: IndexWorkspace,
  chunks: Record<string, StoredChunkMeta>,
): Promise<void> {
  await ws.writeFile(CHUNKS_FILE, JSON.stringify(chunks));
}

export async function loadVectorsWs(
  ws: IndexWorkspace,
  totalChunks: number,
  dim: number,
): Promise<Float32Array | null> {
  const bytes = await ws.readFileBytes(VECTORS_FILE);
  if (!bytes || bytes.byteLength === 0) return null;
  const expected = totalChunks * dim * 4;
  if (bytes.byteLength !== expected) {
    console.warn(
      `[RAG] vectors.bin size mismatch: got ${bytes.byteLength}, expected ${expected}`,
    );
    return null;
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset, totalChunks * dim);
}

export async function saveVectorsWs(
  ws: IndexWorkspace,
  vectors: Float32Array,
): Promise<void> {
  const bytes = new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength);
  await ws.writeFileBytes(VECTORS_FILE, bytes);
}

export function getChunkIdsOrdered(
  chunksMeta: Record<string, StoredChunkMeta>,
): string[] {
  return Object.keys(chunksMeta);
}
