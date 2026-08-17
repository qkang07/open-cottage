/**
 * 符号查询纯逻辑（不碰 I/O / 主线程全局），供 Worker 与主线程回退共用。
 */

import type { SymbolDef, SymbolRef } from './types';

export interface SearchSymbolResult {
  symbols: SymbolDef[];
}

export interface SymbolReferencesResult {
  symbol: SymbolDef | null;
  references: SymbolRef[];
}

export interface ImpactFileGroup {
  path: string;
  referenceCount: number;
  references: SymbolRef[];
}

export interface ImpactAnalysisResult {
  symbol: SymbolDef | null;
  files: ImpactFileGroup[];
  fileCount: number;
  referenceCount: number;
  /** 引用为 0 时为 true，提示改动相对局部 */
  isolated: boolean;
}

export const searchSymbolDefinitionsFrom = (
  symbols: Record<string, SymbolDef>,
  query: string,
): SearchSymbolResult => {
  const q = query.trim().toLowerCase();
  if (!q) return { symbols: [] };
  const list = Object.values(symbols).filter((item) =>
    item.name.toLowerCase().includes(q),
  );
  return { symbols: list.slice(0, 100) };
};

export const findSymbolReferencesFrom = (
  symbols: Record<string, SymbolDef>,
  refs: Record<string, SymbolRef[]>,
  symbolName: string,
): SymbolReferencesResult => {
  const name = symbolName.trim().toLowerCase();
  if (!name) return { symbol: null, references: [] };

  const match =
    Object.values(symbols).find((item) => item.name.toLowerCase() === name) ??
    Object.values(symbols).find((item) => item.name.toLowerCase().includes(name)) ??
    null;
  if (!match) return { symbol: null, references: [] };
  return {
    symbol: match,
    references: refs[match.id] ?? [],
  };
};

export const analyzeSymbolImpactFrom = (
  symbols: Record<string, SymbolDef>,
  refs: Record<string, SymbolRef[]>,
  symbolName: string,
): ImpactAnalysisResult => {
  const { symbol, references } = findSymbolReferencesFrom(symbols, refs, symbolName);
  if (!symbol) {
    return { symbol: null, files: [], fileCount: 0, referenceCount: 0, isolated: false };
  }

  const byPath = new Map<string, SymbolRef[]>();
  for (const ref of references) {
    const list = byPath.get(ref.path) ?? [];
    list.push(ref);
    byPath.set(ref.path, list);
  }

  const files: ImpactFileGroup[] = [...byPath.entries()]
    .map(([path, pathRefs]) => ({
      path,
      referenceCount: pathRefs.length,
      references: pathRefs,
    }))
    .sort((a, b) => b.referenceCount - a.referenceCount);

  return {
    symbol,
    files,
    fileCount: files.length,
    referenceCount: references.length,
    isolated: references.length === 0,
  };
};
