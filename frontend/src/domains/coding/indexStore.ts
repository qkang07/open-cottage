/**
 * 符号索引持久化（主线程 .cottage 路径便捷 API）。
 * Worker 路径请使用 indexStoreWs + IndexWorkspace。
 */

import { workspace } from '../../workspace/FileSystemWorkspace';
import type {
  SymbolDef,
  SymbolFileEntry,
  SymbolIndexManifest,
  SymbolRef,
} from './types';

const BASE = 'coding';
const MANIFEST = `${BASE}/manifest.json`;
const FILES = `${BASE}/files.json`;
const SYMBOLS = `${BASE}/symbols.json`;
const REFS = `${BASE}/refs.json`;

export const saveSymbolManifest = async (
  manifest: SymbolIndexManifest,
): Promise<void> => {
  await workspace.writeCottagePath(MANIFEST, manifest);
};

export const loadSymbolManifest = async (): Promise<SymbolIndexManifest | null> =>
  workspace.readCottagePath<SymbolIndexManifest>(MANIFEST);

export const saveSymbolFiles = async (
  files: Record<string, SymbolFileEntry>,
): Promise<void> => {
  await workspace.writeCottagePath(FILES, files);
};

export const loadSymbolFiles = async (): Promise<Record<string, SymbolFileEntry>> =>
  (await workspace.readCottagePath<Record<string, SymbolFileEntry>>(FILES)) ?? {};

export const saveSymbols = async (
  symbols: Record<string, SymbolDef>,
): Promise<void> => {
  await workspace.writeCottagePath(SYMBOLS, symbols);
};

export const loadSymbols = async (): Promise<Record<string, SymbolDef>> =>
  (await workspace.readCottagePath<Record<string, SymbolDef>>(SYMBOLS)) ?? {};

export const saveSymbolRefs = async (
  refs: Record<string, SymbolRef[]>,
): Promise<void> => {
  await workspace.writeCottagePath(REFS, refs);
};

export const loadSymbolRefs = async (): Promise<Record<string, SymbolRef[]>> =>
  (await workspace.readCottagePath<Record<string, SymbolRef[]>>(REFS)) ?? {};
