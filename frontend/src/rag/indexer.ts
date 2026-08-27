/**
 * RAG 索引器：全量 / 增量建库
 * 全量与增量默认在 Web Worker 中执行；失败时回退主线程。
 */

import { workspace } from '../workspace/FileSystemWorkspace';
import { getCottageConfig } from '../config/store';
import { extractOfficeText } from './officeExtractor';
import { buildIndexCore, type ProgressCallback } from './indexCore';
import {
  filterIncrementalPaths,
  incrementalIndexCore,
} from './incrementalIndexCore';
import {
  abortIndexWorker,
  buildIndexInWorker,
  incrementalIndexInWorker,
  isIndexWorkerRunning,
  terminateIndexWorker,
} from './indexWorkerHost';
import { createIndexWorkspaceFromFileSystem } from './indexWorkspace';

export type { ProgressCallback };

let abortController: AbortController | null = null;
let incrementalActive = false;
let incrementalDetail: string | null = null;

type IndexActivityListener = () => void;
const activityListeners = new Set<IndexActivityListener>();

function notifyIndexActivity(): void {
  for (const listener of activityListeners) {
    listener();
  }
}

export function subscribeIndexActivity(listener: IndexActivityListener): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function isMainThreadFullIndexing(): boolean {
  return abortController !== null;
}

export function isIncrementalIndexing(): boolean {
  return incrementalActive;
}

export function getIncrementalIndexDetail(): string | null {
  return incrementalDetail;
}

/** 是否正在建库（含 Worker 中的全量 / 增量） */
export function isIndexing(): boolean {
  return abortController !== null || isIndexWorkerRunning() || incrementalActive;
}

/** 中断正在进行的建库 */
export function abortIndexing(): void {
  abortController?.abort();
  abortController = null;
  abortIndexWorker();
}

/** 工作区切换时释放 Worker */
export function resetIndexWorker(): void {
  abortIndexing();
  terminateIndexWorker();
}

function beginIncrementalActivity(paths: readonly string[]): void {
  incrementalActive = true;
  incrementalDetail = `${paths.length} 个文件`;
  notifyIndexActivity();
}

function endIncrementalActivity(): void {
  incrementalActive = false;
  incrementalDetail = null;
  notifyIndexActivity();
}

/**
 * 全量或增量建库（默认 Worker；可配置 rag.indexing.useWorker=false 走主线程）
 */
export async function buildIndex(
  onProgress?: ProgressCallback,
  force = false,
): Promise<{ totalChunks: number; filesIndexed: number }> {
  if (isIndexing()) {
    throw new Error('索引正在构建中');
  }

  const config = getCottageConfig();
  const ragConfig = config.rag;
  if (!ragConfig?.indexing || !ragConfig.embedding) {
    throw new Error('RAG 配置不完整');
  }

  const useWorker =
    ragConfig.indexing.useWorker !== false && workspace.supportsHandleWorkers;

  if (useWorker) {
    try {
      return await buildIndexInWorker(onProgress, force);
    } catch (error) {
      if (error instanceof Error && error.message === '已取消') {
        throw error;
      }
      console.warn('[RAG] Index Worker 失败，回退主线程:', error);
      terminateIndexWorker();
    }
  }

  abortController = new AbortController();
  const signal = abortController.signal;
  notifyIndexActivity();

  try {
    const ws = createIndexWorkspaceFromFileSystem(workspace);
    return await buildIndexCore({
      ws,
      ragConfig,
      force,
      signal,
      onProgress,
      readOfficeText: extractOfficeText,
    });
  } finally {
    abortController = null;
    notifyIndexActivity();
  }
}

async function incrementalIndexOnMainThread(
  paths: readonly string[],
  ragConfig: NonNullable<ReturnType<typeof getCottageConfig>['rag']>,
  onProgress?: ProgressCallback,
): Promise<{ newChunks: number }> {
  const ws = createIndexWorkspaceFromFileSystem(workspace);
  return incrementalIndexCore({
    ws,
    ragConfig,
    paths,
    onProgress,
    readOfficeText: extractOfficeText,
  });
}

/**
 * 增量索引：仅处理指定的变更文件
 * 用于 assistantComplete 后对变更文件增量更新
 */
export async function incrementalIndex(
  changedPaths: string[],
  onProgress?: ProgressCallback,
): Promise<{ newChunks: number }> {
  const config = getCottageConfig();
  const ragConfig = config.rag;
  if (!ragConfig?.indexing || !ragConfig.embedding) {
    return { newChunks: 0 };
  }

  const paths = filterIncrementalPaths(changedPaths, ragConfig);
  if (paths.length === 0) return { newChunks: 0 };

  const useWorker =
    ragConfig.indexing.useWorker !== false && workspace.supportsHandleWorkers;

  beginIncrementalActivity(paths);

  try {
    if (useWorker) {
      try {
        return await incrementalIndexInWorker(paths, ragConfig, onProgress);
      } catch (error) {
        if (error instanceof Error && error.message === '已取消') {
          throw error;
        }
        console.warn('[RAG] Incremental Worker 失败，回退主线程:', error);
        terminateIndexWorker();
      }
    }

    return await incrementalIndexOnMainThread(paths, ragConfig, onProgress);
  } finally {
    endIncrementalActivity();
  }
}
