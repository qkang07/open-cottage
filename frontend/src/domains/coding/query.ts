/**
 * 符号查询公开 API：默认走 Worker；失败时回退主线程读盘。
 */

import {
  createIndexWorkspaceFromFileSystem,
} from '../../rag/indexWorkspace';
import { workspace } from '../../workspace/FileSystemWorkspace';
import { loadSymbolRefsWs, loadSymbolsWs } from './indexStoreWs';
import {
  analyzeSymbolImpactFrom,
  findSymbolReferencesFrom,
  searchSymbolDefinitionsFrom,
  type ImpactAnalysisResult,
  type SearchSymbolResult,
  type SymbolReferencesResult,
} from './queryCore';
import {
  analyzeImpactInWorker,
  findReferencesInWorker,
  searchSymbolInWorker,
  terminateSymbolWorker,
} from './symbolWorkerHost';

export type {
  ImpactAnalysisResult,
  ImpactFileGroup,
  SearchSymbolResult,
  SymbolReferencesResult,
} from './queryCore';

async function runQueryWithFallback<T>(
  viaWorker: () => Promise<T>,
  viaMain: () => Promise<T>,
): Promise<T> {
  if (workspace.isOpen) {
    try {
      return await viaWorker();
    } catch (error) {
      console.warn('[SymbolIndex] 查询 Worker 失败，回退主线程:', error);
      terminateSymbolWorker();
    }
  }
  return viaMain();
}

export const searchSymbolDefinitions = async (
  query: string,
): Promise<SearchSymbolResult> =>
  runQueryWithFallback(
    () => searchSymbolInWorker(query),
    async () => {
      const ws = createIndexWorkspaceFromFileSystem(workspace);
      const symbols = await loadSymbolsWs(ws);
      return searchSymbolDefinitionsFrom(symbols, query);
    },
  );

export const findSymbolReferences = async (
  symbolName: string,
): Promise<SymbolReferencesResult> =>
  runQueryWithFallback(
    () => findReferencesInWorker(symbolName),
    async () => {
      const ws = createIndexWorkspaceFromFileSystem(workspace);
      const symbols = await loadSymbolsWs(ws);
      const refs = await loadSymbolRefsWs(ws);
      return findSymbolReferencesFrom(symbols, refs, symbolName);
    },
  );

/**
 * 改前影响分析：定位符号定义，按文件聚合其全部引用点，
 * 输出受影响文件数与调用点总数，作为"是否需要提交计划 / 改动范围"的依据。
 */
export const analyzeSymbolImpact = async (
  symbolName: string,
): Promise<ImpactAnalysisResult> =>
  runQueryWithFallback(
    () => analyzeImpactInWorker(symbolName),
    async () => {
      const ws = createIndexWorkspaceFromFileSystem(workspace);
      const symbols = await loadSymbolsWs(ws);
      const refs = await loadSymbolRefsWs(ws);
      return analyzeSymbolImpactFrom(symbols, refs, symbolName);
    },
  );
