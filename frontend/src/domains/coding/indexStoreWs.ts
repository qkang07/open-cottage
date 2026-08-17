/**
 * 符号索引持久化（IndexWorkspace 版）：主线程 / Worker 共用。
 * 路径与 writeCottagePath('coding/...') 一致 → .cottage/coding/...
 */

import type { IndexWorkspace } from '../../rag/indexWorkspace';
import type {
  SymbolDef,
  SymbolFileEntry,
  SymbolIndexManifest,
  SymbolRef,
} from './types';

const INDEX_DIR = '.cottage/coding';
const MANIFEST = `${INDEX_DIR}/manifest.json`;
const FILES = `${INDEX_DIR}/files.json`;
const SYMBOLS = `${INDEX_DIR}/symbols.json`;
const REFS = `${INDEX_DIR}/refs.json`;

async function readJson<T>(ws: IndexWorkspace, path: string): Promise<T | null> {
  const content = await ws.readFile(path);
  if (!content?.trim()) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function writeJson(ws: IndexWorkspace, path: string, data: unknown): Promise<void> {
  await ws.writeFile(path, JSON.stringify(data, null, 2));
}

export const loadSymbolManifestWs = (
  ws: IndexWorkspace,
): Promise<SymbolIndexManifest | null> => readJson<SymbolIndexManifest>(ws, MANIFEST);

export const saveSymbolManifestWs = (
  ws: IndexWorkspace,
  manifest: SymbolIndexManifest,
): Promise<void> => writeJson(ws, MANIFEST, manifest);

export const loadSymbolFilesWs = async (
  ws: IndexWorkspace,
): Promise<Record<string, SymbolFileEntry>> =>
  (await readJson<Record<string, SymbolFileEntry>>(ws, FILES)) ?? {};

export const saveSymbolFilesWs = (
  ws: IndexWorkspace,
  files: Record<string, SymbolFileEntry>,
): Promise<void> => writeJson(ws, FILES, files);

export const loadSymbolsWs = async (
  ws: IndexWorkspace,
): Promise<Record<string, SymbolDef>> =>
  (await readJson<Record<string, SymbolDef>>(ws, SYMBOLS)) ?? {};

export const saveSymbolsWs = (
  ws: IndexWorkspace,
  symbols: Record<string, SymbolDef>,
): Promise<void> => writeJson(ws, SYMBOLS, symbols);

export const loadSymbolRefsWs = async (
  ws: IndexWorkspace,
): Promise<Record<string, SymbolRef[]>> =>
  (await readJson<Record<string, SymbolRef[]>>(ws, REFS)) ?? {};

export const saveSymbolRefsWs = (
  ws: IndexWorkspace,
  refs: Record<string, SymbolRef[]>,
): Promise<void> => writeJson(ws, REFS, refs);
