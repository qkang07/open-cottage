/**
 * 符号索引构建核心：主线程回退与 Symbol Worker 共用。
 */

import type { IndexWorkspace } from '../../rag/indexWorkspace';
import { isLikelyTextPath, matchesAnyGlob } from '../../workspace/search';
import {
  loadSymbolFilesWs,
  loadSymbolManifestWs,
  loadSymbolRefsWs,
  loadSymbolsWs,
  saveSymbolFilesWs,
  saveSymbolManifestWs,
  saveSymbolRefsWs,
  saveSymbolsWs,
} from './indexStoreWs';
import { resolveAdapterForPath } from './parsers/adapterRegistry';
import { ensureTreeSitterReady, type TreeSitterConfig } from './parsers/treeSitter';
import type { SymbolDef, SymbolRef } from './types';

export type SymbolIndexProgress = {
  phase: 'scan' | 'parse' | 'save';
  current: number;
  total: number;
  detail?: string;
};

export type SymbolIndexProgressCallback = (progress: SymbolIndexProgress) => void;

async function hashContent(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 单次扫描全文收集符号引用 */
export const scanSymbolRefs = (
  content: string,
  symbols: SymbolDef[],
  path: string,
): SymbolRef[] => {
  if (!symbols.length || !content) return [];

  const byName = new Map<string, SymbolDef[]>();
  for (const symbol of symbols) {
    if (!symbol.name) continue;
    const list = byName.get(symbol.name);
    if (list) list.push(symbol);
    else byName.set(symbol.name, [symbol]);
  }
  const names = [...byName.keys()];
  if (!names.length) return [];

  const pattern = new RegExp(`\\b(?:${names.map(escapeRegExp).join('|')})\\b`, 'g');
  const refs: SymbolRef[] = [];
  let line = 1;
  let lineStart = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    for (let i = cursor; i < match.index; i += 1) {
      if (content.charCodeAt(i) === 10) {
        line += 1;
        lineStart = i + 1;
      }
    }
    cursor = match.index;

    const defs = byName.get(match[0]);
    if (!defs) continue;
    const column = match.index - lineStart + 1;
    for (const symbol of defs) {
      refs.push({
        symbolId: symbol.id,
        symbolName: symbol.name,
        path,
        line,
        column,
      });
    }
  }
  return refs;
};

const groupRefsBySymbol = (
  symbols: SymbolDef[],
  refs: SymbolRef[],
): Record<string, SymbolRef[]> => {
  const grouped: Record<string, SymbolRef[]> = {};
  for (const symbol of symbols) {
    grouped[symbol.id] = [];
  }
  for (const ref of refs) {
    const bucket = grouped[ref.symbolId];
    if (bucket) bucket.push(ref);
  }
  return grouped;
};

export const eligibleForSymbolIndex = (
  path: string,
  ignoreGlobs: string[],
): boolean => {
  if (matchesAnyGlob(path, ignoreGlobs)) return false;
  if (!isLikelyTextPath(path)) return false;
  return resolveAdapterForPath(path) !== undefined;
};

export interface BuildSymbolIndexCoreOptions {
  ws: IndexWorkspace;
  ignoreGlobs: string[];
  /** tree-sitter 解析配置；缺省不启用精确解析（用正则） */
  parserConfig?: TreeSitterConfig;
  onProgress?: SymbolIndexProgressCallback;
  signal?: AbortSignal;
}

export interface BuildSymbolIndexCoreResult {
  totalFiles: number;
  totalSymbols: number;
  symbols: Record<string, SymbolDef>;
  refs: Record<string, SymbolRef[]>;
}

export const buildSymbolIndexCore = async (
  options: BuildSymbolIndexCoreOptions,
): Promise<BuildSymbolIndexCoreResult> => {
  const { ws, ignoreGlobs, onProgress, signal } = options;
  const allFiles = await ws.listFiles({ ignoreGlobs });
  const files = allFiles.filter((path) => eligibleForSymbolIndex(path, ignoreGlobs));

  onProgress?.({
    phase: 'scan',
    current: 0,
    total: files.length,
    detail: `发现 ${files.length} 个可索引文件，正在比对缓存…`,
  });

  const existingFiles = await loadSymbolFilesWs(ws);
  const existingManifest = await loadSymbolManifestWs(ws);
  const contentByPath = new Map<string, string>();
  const hashByPath = new Map<string, string>();
  const toParse: string[] = [];
  const reusablePaths = new Set<string>();

  for (let i = 0; i < files.length; i += 1) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const path = files[i]!;
    onProgress?.({
      phase: 'scan',
      current: i + 1,
      total: files.length,
      detail: path,
    });

    const content = await ws.readFile(path);
    if (!content) continue;

    const hash = await hashContent(content);
    hashByPath.set(path, hash);
    const old = existingFiles[path];
    if (old && old.hash === hash) {
      reusablePaths.add(path);
      continue;
    }

    toParse.push(path);
    contentByPath.set(path, content);
  }

  const fileSet = new Set(files);
  const deletedPaths = Object.keys(existingFiles).filter((path) => !fileSet.has(path));
  const unchanged =
    toParse.length === 0 &&
    deletedPaths.length === 0 &&
    reusablePaths.size === Object.keys(existingFiles).length &&
    existingManifest !== null;

  if (unchanged && existingManifest) {
    const symbols = await loadSymbolsWs(ws);
    const refs = await loadSymbolRefsWs(ws);
    onProgress?.({
      phase: 'save',
      current: files.length,
      total: files.length,
      detail: `符号索引未变更，已复用缓存（${existingManifest.totalFiles} 个文件，${existingManifest.symbolCount} 个符号）`,
    });
    return {
      totalFiles: existingManifest.totalFiles,
      totalSymbols: existingManifest.symbolCount,
      symbols,
      refs,
    };
  }

  const symbolFiles: Record<string, { hash: string; symbolIds: string[] }> = {
    ...Object.fromEntries(
      [...reusablePaths].map((path) => [path, existingFiles[path]!]),
    ),
  };
  const symbols = await loadSymbolsWs(ws);
  const refsBySymbol = await loadSymbolRefsWs(ws);

  // 删除已不存在或待重解析文件上的旧符号/引用
  const purgePaths = [...deletedPaths, ...toParse];
  for (const path of purgePaths) {
    const old = existingFiles[path];
    if (!old?.symbolIds?.length) continue;
    for (const id of old.symbolIds) {
      delete symbols[id];
      delete refsBySymbol[id];
    }
  }

  onProgress?.({
    phase: 'parse',
    current: 0,
    total: toParse.length,
    detail:
      toParse.length > 0
        ? `待解析 ${toParse.length} 个变更文件`
        : '仅清理已删除文件',
  });

  // 解析前确保 tree-sitter 就绪（异步加载语法包）；失败则解析器自动回退正则
  if (options.parserConfig && toParse.length > 0) {
    await ensureTreeSitterReady(options.parserConfig);
  }

  for (let i = 0; i < toParse.length; i += 1) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const path = toParse[i]!;
    onProgress?.({
      phase: 'parse',
      current: i + 1,
      total: toParse.length,
      detail: path,
    });

    const content = contentByPath.get(path);
    if (!content) continue;
    const adapter = resolveAdapterForPath(path);
    if (!adapter) continue;
    const result = adapter.parse(path, content);
    if (!result.symbols.length) continue;

    for (const symbol of result.symbols) {
      symbols[symbol.id] = symbol;
    }
    const refs = scanSymbolRefs(content, result.symbols, path);
    const grouped = groupRefsBySymbol(result.symbols, refs);
    for (const [symbolId, pathRefs] of Object.entries(grouped)) {
      refsBySymbol[symbolId] = pathRefs;
    }
    symbolFiles[path] = {
      hash: hashByPath.get(path) ?? (await hashContent(content)),
      symbolIds: result.symbols.map((item) => item.id),
    };
  }

  const languages = new Set(
    Object.values(symbols).map((symbol) => symbol.language),
  );

  onProgress?.({
    phase: 'save',
    current: files.length,
    total: files.length,
    detail: '写入符号索引…',
  });

  await saveSymbolFilesWs(ws, symbolFiles);
  await saveSymbolsWs(ws, symbols);
  await saveSymbolRefsWs(ws, refsBySymbol);
  await saveSymbolManifestWs(ws, {
    builtAt: Date.now(),
    symbolCount: Object.keys(symbols).length,
    languages: [...languages],
    totalFiles: Object.keys(symbolFiles).length,
  });

  return {
    totalFiles: Object.keys(symbolFiles).length,
    totalSymbols: Object.keys(symbols).length,
    symbols,
    refs: refsBySymbol,
  };
};

export interface IncrementalSymbolIndexCoreOptions {
  ws: IndexWorkspace;
  ignoreGlobs: string[];
  changedPaths: string[];
  /** tree-sitter 解析配置；缺省不启用精确解析（用正则） */
  parserConfig?: TreeSitterConfig;
  onProgress?: SymbolIndexProgressCallback;
  signal?: AbortSignal;
}

export interface IncrementalSymbolIndexCoreResult {
  touchedFiles: number;
  symbols: Record<string, SymbolDef>;
  refs: Record<string, SymbolRef[]>;
}

export const incrementalSymbolIndexCore = async (
  options: IncrementalSymbolIndexCoreOptions,
): Promise<IncrementalSymbolIndexCoreResult> => {
  const { ws, ignoreGlobs, changedPaths, onProgress, signal } = options;
  const paths = changedPaths.filter((path) => eligibleForSymbolIndex(path, ignoreGlobs));
  if (paths.length === 0) {
    const symbols = await loadSymbolsWs(ws);
    const refs = await loadSymbolRefsWs(ws);
    return { touchedFiles: 0, symbols, refs };
  }

  const files = await loadSymbolFilesWs(ws);
  const symbols = await loadSymbolsWs(ws);
  const refs = await loadSymbolRefsWs(ws);

  // 解析前确保 tree-sitter 就绪；失败则回退正则
  if (options.parserConfig) {
    await ensureTreeSitterReady(options.parserConfig);
  }

  let touched = 0;
  for (let i = 0; i < paths.length; i += 1) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const path = paths[i]!;
    onProgress?.({
      phase: 'parse',
      current: i + 1,
      total: paths.length,
      detail: path,
    });

    const adapter = resolveAdapterForPath(path);
    if (!adapter) continue;

    const exists = await ws.exists(path);
    const old = files[path];
    if (old?.symbolIds?.length) {
      for (const id of old.symbolIds) {
        delete symbols[id];
        delete refs[id];
      }
    }
    if (!exists) {
      delete files[path];
      touched += 1;
      continue;
    }

    const content = await ws.readFile(path);
    if (!content) {
      delete files[path];
      touched += 1;
      continue;
    }
    const parsed = adapter.parse(path, content);
    const symbolIds: string[] = [];
    for (const symbol of parsed.symbols) {
      symbols[symbol.id] = symbol;
      symbolIds.push(symbol.id);
    }
    const pathRefs = scanSymbolRefs(content, parsed.symbols, path);
    const grouped = groupRefsBySymbol(parsed.symbols, pathRefs);
    for (const symbolId of symbolIds) {
      refs[symbolId] = grouped[symbolId] ?? [];
    }
    files[path] = { hash: await hashContent(content), symbolIds };
    touched += 1;
  }

  const manifest = await loadSymbolManifestWs(ws);
  const languages = new Set(Object.values(symbols).map((s) => s.language));

  onProgress?.({
    phase: 'save',
    current: paths.length,
    total: paths.length,
    detail: '写入符号索引…',
  });

  await saveSymbolFilesWs(ws, files);
  await saveSymbolsWs(ws, symbols);
  await saveSymbolRefsWs(ws, refs);
  await saveSymbolManifestWs(ws, {
    ...(manifest ?? {}),
    builtAt: Date.now(),
    symbolCount: Object.keys(symbols).length,
    languages: [...languages],
    totalFiles: Object.keys(files).length,
  });

  return { touchedFiles: touched, symbols, refs };
};
