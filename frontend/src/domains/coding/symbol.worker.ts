/**
 * Symbol Index Worker：建库 / 增量 / 查询全部在独立线程执行。
 */

import { createFsAdapter } from '../../history/fsaGitAdapter';
import {
  createIndexWorkspaceFromFs,
  type IndexWorkspace,
} from '../../rag/indexWorkspace';
import {
  buildSymbolIndexCore,
  incrementalSymbolIndexCore,
  type SymbolIndexProgress,
} from './indexCore';
import { loadSymbolRefsWs, loadSymbolsWs } from './indexStoreWs';
import {
  analyzeSymbolImpactFrom,
  findSymbolReferencesFrom,
  searchSymbolDefinitionsFrom,
} from './queryCore';
import type { TreeSitterConfig } from './parsers/treeSitter';
import type { SymbolDef, SymbolRef } from './types';

let ws: IndexWorkspace | null = null;
let abortController: AbortController | null = null;
let requestChain: Promise<void> = Promise.resolve();

/** Worker 内缓存，避免每次查询都读盘 */
let symbolsCache: Record<string, SymbolDef> | null = null;
let refsCache: Record<string, SymbolRef[]> | null = null;

type SymbolWorkerRequest =
  | { type: 'buildIndex'; ignoreGlobs: string[]; parserConfig?: TreeSitterConfig }
  | {
      type: 'incrementalIndex';
      paths: string[];
      ignoreGlobs: string[];
      parserConfig?: TreeSitterConfig;
    }
  | { type: 'searchSymbol'; query: string }
  | { type: 'findReferences'; symbolName: string }
  | { type: 'analyzeImpact'; symbolName: string };

self.onmessage = (event: MessageEvent<unknown>) => {
  const message = event.data as
    | { type: 'init'; rootHandle: FileSystemDirectoryHandle }
    | { kind: 'request'; id: number; request: SymbolWorkerRequest }
    | { kind: 'abort' };

  if ('type' in message && message.type === 'init') {
    void (async () => {
      try {
        ws = createIndexWorkspaceFromFs(createFsAdapter(message.rootHandle));
        symbolsCache = null;
        refsCache = null;
        self.postMessage({ kind: 'init', init: 'done' });
      } catch (error) {
        self.postMessage({
          kind: 'init',
          init: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return;
  }

  if ('kind' in message && message.kind === 'abort') {
    abortController?.abort();
    return;
  }

  if ('kind' in message && message.kind === 'request') {
    // 串行执行，避免建库与查询并发踩缓存 / 落盘
    requestChain = requestChain
      .then(() => handleRequest(message.id, message.request))
      .catch(() => undefined);
  }
};

async function ensureCaches(): Promise<{
  symbols: Record<string, SymbolDef>;
  refs: Record<string, SymbolRef[]>;
}> {
  if (!ws) throw new Error('Symbol Worker 未初始化');
  if (!symbolsCache) symbolsCache = await loadSymbolsWs(ws);
  if (!refsCache) refsCache = await loadSymbolRefsWs(ws);
  return { symbols: symbolsCache, refs: refsCache };
}

function setCaches(
  symbols: Record<string, SymbolDef>,
  refs: Record<string, SymbolRef[]>,
): void {
  symbolsCache = symbols;
  refsCache = refs;
}

async function handleRequest(id: number, request: SymbolWorkerRequest): Promise<void> {
  if (!ws) {
    self.postMessage({
      kind: 'response',
      id,
      error: 'Symbol Worker 未初始化',
    });
    return;
  }

  try {
    if (request.type === 'buildIndex') {
      abortController?.abort();
      abortController = new AbortController();
      const signal = abortController.signal;
      try {
        const result = await buildSymbolIndexCore({
          ws,
          ignoreGlobs: request.ignoreGlobs,
          parserConfig: request.parserConfig,
          signal,
          onProgress: (progress: SymbolIndexProgress) => {
            self.postMessage({ kind: 'progress', id, progress });
          },
        });
        setCaches(result.symbols, result.refs);
        self.postMessage({
          kind: 'response',
          id,
          result: {
            totalFiles: result.totalFiles,
            totalSymbols: result.totalSymbols,
          },
        });
      } finally {
        if (abortController?.signal === signal) {
          abortController = null;
        }
      }
      return;
    }

    if (request.type === 'incrementalIndex') {
      abortController?.abort();
      abortController = new AbortController();
      const signal = abortController.signal;
      try {
        const result = await incrementalSymbolIndexCore({
          ws,
          ignoreGlobs: request.ignoreGlobs,
          changedPaths: request.paths,
          parserConfig: request.parserConfig,
          signal,
          onProgress: (progress: SymbolIndexProgress) => {
            self.postMessage({ kind: 'progress', id, progress });
          },
        });
        setCaches(result.symbols, result.refs);
        self.postMessage({
          kind: 'response',
          id,
          result: { touchedFiles: result.touchedFiles },
        });
      } finally {
        if (abortController?.signal === signal) {
          abortController = null;
        }
      }
      return;
    }

    if (request.type === 'searchSymbol') {
      const { symbols } = await ensureCaches();
      self.postMessage({
        kind: 'response',
        id,
        result: searchSymbolDefinitionsFrom(symbols, request.query),
      });
      return;
    }

    if (request.type === 'findReferences') {
      const { symbols, refs } = await ensureCaches();
      self.postMessage({
        kind: 'response',
        id,
        result: findSymbolReferencesFrom(symbols, refs, request.symbolName),
      });
      return;
    }

    if (request.type === 'analyzeImpact') {
      const { symbols, refs } = await ensureCaches();
      self.postMessage({
        kind: 'response',
        id,
        result: analyzeSymbolImpactFrom(symbols, refs, request.symbolName),
      });
      return;
    }
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === 'AbortError'
        ? '已取消'
        : error instanceof Error
          ? error.message
          : String(error);
    self.postMessage({ kind: 'response', id, error: message });
  }
}
