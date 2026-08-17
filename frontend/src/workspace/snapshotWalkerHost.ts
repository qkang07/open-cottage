/**
 * Workspace Walker 主机：管理单例 Worker，转发 snapshot / listDir 请求与进度。
 * Worker 不可用时回退主线程（保留 maybeYield 让出 UI）。
 */

import { maybeYield } from '../util/yield';
import { listDirectoryContentsCore } from './listDirectoryContentsCore';
import { walkWorkspaceCore, type WalkOptions, type WalkResult } from './walkWorkspaceCore';
import type { ExplorerEntry } from './explorerTypes';

export interface SnapshotProgress {
  iteration: number;
}

let worker: Worker | null = null;
let initPromise: Promise<Worker | null> | null = null;
let initResolve: ((value: Worker | null) => void) | null = null;
let initReject: ((reason: Error) => void) | null = null;
let boundHandle: FileSystemDirectoryHandle | null = null;
let requestId = 0;

interface PendingRequest {
  resolve: (value: WalkResult | ExplorerEntry[]) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: SnapshotProgress) => void;
}
const pending = new Map<number, PendingRequest>();

function ensureWorker(
  rootHandle: FileSystemDirectoryHandle,
): Promise<Worker | null> {
  if (worker && boundHandle === rootHandle) return Promise.resolve(worker);
  if (initPromise && boundHandle === rootHandle) return initPromise;

  terminateSnapshotWorker();

  initPromise = new Promise<Worker | null>((resolve, reject) => {
    initResolve = resolve;
    initReject = reject;
  });

  try {
    const nextWorker = new Worker(
      new URL('./snapshotWalker.worker.ts', import.meta.url),
      { type: 'module' },
    );

    nextWorker.onmessage = (event: MessageEvent<unknown>) => {
      handleWorkerMessage(event.data);
    };
    nextWorker.onerror = (event) => {
      console.error('[WalkerWorker] error:', event);
      initReject?.(new Error('Walker Worker 初始化失败'));
      terminateSnapshotWorker();
    };

    boundHandle = rootHandle;
    // FileSystemHandle 可 structured clone，但不能放进 transfer list（会 DataCloneError）
    nextWorker.postMessage({ type: 'init', rootHandle });
    worker = nextWorker;
  } catch (error) {
    console.warn('[WalkerWorker] 不可用，回退主线程:', error);
    worker = null;
    boundHandle = null;
    initResolve?.(null);
    initResolve = null;
    initReject = null;
    initPromise = Promise.resolve(null);
  }

  return initPromise;
}

function handleWorkerMessage(message: unknown): void {
  if (!message || typeof message !== 'object') return;
  const msg = message as {
    kind?: string;
    id?: number;
    init?: 'done' | 'error';
    error?: string;
    result?: WalkResult | ExplorerEntry[];
    progress?: SnapshotProgress;
  };

  if (msg.kind === 'init') {
    if (msg.init === 'done') {
      initResolve?.(worker);
    } else {
      initReject?.(new Error(msg.error ?? 'Walker Worker 初始化失败'));
      terminateSnapshotWorker();
    }
    initResolve = null;
    initReject = null;
    return;
  }

  if (msg.kind === 'progress' && msg.id !== undefined && msg.progress) {
    pending.get(msg.id)?.onProgress?.(msg.progress);
    return;
  }

  if (msg.kind !== 'response') return;
  const req = pending.get(msg.id ?? -1);
  if (!req) return;
  pending.delete(msg.id ?? -1);
  if (msg.error) {
    req.reject(new Error(msg.error));
  } else if (msg.result) {
    req.resolve(msg.result);
  } else {
    req.reject(new Error('Walker Worker 返回空结果'));
  }
}

function runRequest(
  w: Worker,
  request: unknown,
  onProgress?: (progress: SnapshotProgress) => void,
): Promise<WalkResult | ExplorerEntry[]> {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ kind: 'request', id, request });
  });
}

/** 在 Worker 中遍历整树；Worker 不可用时回退主线程（带 maybeYield） */
export async function walkWorkspaceInWorker(
  rootHandle: FileSystemDirectoryHandle,
  rootName: string,
  options: WalkOptions = {},
  onProgress?: (progress: SnapshotProgress) => void,
): Promise<WalkResult> {
  const w = await ensureWorker(rootHandle);
  if (!w) {
    return walkWorkspaceCore(rootHandle, rootName, {
      ...options,
      yieldFn: async (iteration: number) => {
        await maybeYield(iteration);
      },
    });
  }
  return (await runRequest(w, { type: 'snapshot' }, onProgress)) as WalkResult;
}

/** 在 Worker 中列单层目录；Worker 不可用时回退主线程（带 maybeYield） */
export async function listDirectoryContentsInWorker(
  rootHandle: FileSystemDirectoryHandle,
  dirPath: string,
  options: { signal?: AbortSignal; includeFileMetadata?: boolean } = {},
  onProgress?: (progress: SnapshotProgress) => void,
): Promise<ExplorerEntry[]> {
  const w = await ensureWorker(rootHandle);
  const includeFileMetadata = options.includeFileMetadata ?? true;
  if (!w) {
    return listDirectoryContentsCore(rootHandle, dirPath, {
      signal: options.signal,
      includeFileMetadata,
      yieldFn: async (iteration: number) => {
        await maybeYield(iteration);
      },
    });
  }
  return (await runRequest(
    w,
    { type: 'listDir', path: dirPath, includeFileMetadata },
    onProgress,
  )) as ExplorerEntry[];
}

export function abortSnapshotWorker(): void {
  worker?.postMessage({ kind: 'abort' });
}

export function terminateSnapshotWorker(): void {
  worker?.terminate();
  worker = null;
  initPromise = null;
  initResolve = null;
  initReject = null;
  boundHandle = null;
  for (const req of pending.values()) {
    req.reject(new Error('Walker Worker 已终止'));
  }
  pending.clear();
}

export function getSnapshotWalkerStatus(): {
  alive: boolean;
  pendingRequests: number;
} {
  return {
    alive: worker !== null,
    pendingRequests: pending.size,
  };
}
