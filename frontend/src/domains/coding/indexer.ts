/**
 * 符号索引公开 API：默认走 Worker；失败时回退主线程。
 */

import { DEFAULT_IGNORE_GLOBS } from '../../config/constants';
import { getCottageConfig } from '../../config/store';
import {
  createIndexWorkspaceFromFileSystem,
} from '../../rag/indexWorkspace';
import { workspace } from '../../workspace/FileSystemWorkspace';
import {
  buildSymbolIndexCore,
  incrementalSymbolIndexCore,
  type SymbolIndexProgressCallback,
} from './indexCore';
import {
  DEFAULT_TREE_SITTER_BASE_URL,
  type TreeSitterConfig,
} from './parsers/treeSitter';
import {
  abortSymbolWorker,
  buildSymbolIndexInWorker,
  incrementalSymbolIndexInWorker,
  isSymbolWorkerRunning,
  terminateSymbolWorker,
} from './symbolWorkerHost';

export type { SymbolIndexProgress, SymbolIndexProgressCallback } from './indexCore';

/** 把历史上仅匹配仓库根的目录模式升级为任意嵌套 */
function normalizeIgnoreGlob(glob: string): string {
  const trimmed = glob.trim();
  if (!trimmed) return trimmed;
  if (/^(node_modules|dist|build|coverage|\.git|\.next)\/\*\*$/.test(trimmed)) {
    return `**/${trimmed}`;
  }
  if (trimmed === '.cottage/history/**') return '**/.cottage/history/**';
  if (trimmed === '.cottage/index/**') return '**/.cottage/index/**';
  if (trimmed === '.cottage/coding/**') return '**/.cottage/coding/**';
  return trimmed;
}

/** 缺省或空数组时回退 DEFAULT_IGNORE_GLOBS，并规范化目录模式 */
export function resolveSymbolIgnoreGlobs(): string[] {
  const config = getCottageConfig();
  const configured =
    config.codingIndex?.ignoreGlobs ?? config.rag?.indexing?.ignoreGlobs;
  const source = configured?.length ? configured : DEFAULT_IGNORE_GLOBS;
  return [...new Set(source.map(normalizeIgnoreGlob).filter(Boolean))];
}

/** 从配置解析 tree-sitter 精确解析参数；关闭时返回 disabled 配置 */
export function resolveTreeSitterConfig(): TreeSitterConfig {
  const parser = getCottageConfig().codingIndex?.parser;
  return {
    enabled: parser?.treeSitter !== false,
    wasmBaseUrl: parser?.wasmBaseUrl || DEFAULT_TREE_SITTER_BASE_URL,
    runtimeWasmUrl: parser?.runtimeWasmUrl,
  };
}

/** 工作区切换时释放 Worker */
export function resetSymbolWorker(): void {
  abortSymbolWorker();
  terminateSymbolWorker();
}

export function isSymbolIndexing(): boolean {
  return isSymbolWorkerRunning();
}

export const buildSymbolIndex = async (
  onProgress?: SymbolIndexProgressCallback,
): Promise<{ totalFiles: number; totalSymbols: number }> => {
  const ignoreGlobs = resolveSymbolIgnoreGlobs();
  const parserConfig = resolveTreeSitterConfig();
  const useWorker = workspace.supportsHandleWorkers;

  if (useWorker) {
    try {
      return await buildSymbolIndexInWorker(ignoreGlobs, parserConfig, onProgress);
    } catch (error) {
      if (error instanceof Error && error.message === '已取消') {
        throw error;
      }
      console.warn('[SymbolIndex] Worker 失败，回退主线程:', error);
      terminateSymbolWorker();
    }
  }

  const ws = createIndexWorkspaceFromFileSystem(workspace);
  const result = await buildSymbolIndexCore({ ws, ignoreGlobs, parserConfig, onProgress });
  return {
    totalFiles: result.totalFiles,
    totalSymbols: result.totalSymbols,
  };
};

export const incrementalSymbolIndex = async (
  changedPaths: string[],
  onProgress?: SymbolIndexProgressCallback,
): Promise<{ touchedFiles: number }> => {
  const ignoreGlobs = resolveSymbolIgnoreGlobs();
  const parserConfig = resolveTreeSitterConfig();
  const useWorker = workspace.supportsHandleWorkers;

  if (useWorker) {
    try {
      return await incrementalSymbolIndexInWorker(
        changedPaths,
        ignoreGlobs,
        parserConfig,
        onProgress,
      );
    } catch (error) {
      if (error instanceof Error && error.message === '已取消') {
        throw error;
      }
      console.warn('[SymbolIndex] Worker 增量失败，回退主线程:', error);
      terminateSymbolWorker();
    }
  }

  const ws = createIndexWorkspaceFromFileSystem(workspace);
  const result = await incrementalSymbolIndexCore({
    ws,
    ignoreGlobs,
    changedPaths,
    parserConfig,
    onProgress,
  });
  return { touchedFiles: result.touchedFiles };
};
