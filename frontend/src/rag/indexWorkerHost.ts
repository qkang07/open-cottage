/**
 * RAG 索引 Worker 主机：创建 Worker、传递 FSA 句柄、转发进度与 Office RPC。
 */

import { workspace } from '../workspace/FileSystemWorkspace';
import { getCottageConfig } from '../config/store';
import type { RagConfig } from '../config/constants';
import { extractOfficeText } from './officeExtractor';
import type { IndexProgress } from './types';

type BuildIndexResult = { totalChunks: number; filesIndexed: number };
type IncrementalIndexResult = { newChunks: number };

type IndexWorkerRequestKind = 'buildIndex' | 'incrementalIndex';

interface PendingRequest<T = unknown> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  onProgress?: (progress: IndexProgress) => void;
  kind?: IndexWorkerRequestKind;
}

let worker: Worker | null = null;
let initPromise: Promise<Worker | null> | null = null;
let initResolve: ((value: Worker | null) => void) | null = null;
let initReject: ((reason: Error) => void) | null = null;
let requestId = 0;
const pending = new Map<number, PendingRequest>();
const hostPending = new Map<
  number,
  { resolve: (value: string | null) => void; reject: (error: Error) => void }
>();
let lastWorkerProgress: IndexProgress | null = null;
let activeRequestKind: IndexWorkerRequestKind | null = null;

export function getIndexWorkerActiveRequestKind(): IndexWorkerRequestKind | null {
  return activeRequestKind;
}

export function getIndexWorkerLastProgress(): IndexProgress | null {
  return lastWorkerProgress;
}

export function isIndexWorkerRunning(): boolean {
  return pending.size > 0;
}

export async function ensureIndexWorker(): Promise<Worker | null> {
  if (worker) return worker;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const rootHandle = workspace.rootHandle;
    if (!rootHandle) return null;

    const nextWorker = new Worker(
      new URL('./index.worker.ts', import.meta.url),
      { type: 'module' },
    );

    const initResponsePromise = new Promise<Worker | null>((resolve, reject) => {
      initResolve = resolve;
      initReject = reject;
    });

    nextWorker.onmessage = (event: MessageEvent<unknown>) => {
      handleWorkerMessage(event.data);
    };

    nextWorker.onerror = (event) => {
      console.error('[IndexWorker] error:', event);
      terminateIndexWorker();
    };

    // FileSystemHandle 可 structured clone，但不能放进 transfer list（会 DataCloneError）
    nextWorker.postMessage({ type: 'init', rootHandle });

    worker = nextWorker;
    return await initResponsePromise;
  })();

  return initPromise;
}

export function getIndexWorkerStatus(): {
  alive: boolean;
  initializing: boolean;
  pendingRequests: number;
  busy: boolean;
  lastProgress: IndexProgress | null;
} {
  return {
    alive: worker !== null,
    initializing: initPromise !== null && initResolve !== null,
    pendingRequests: pending.size,
    busy: pending.size > 0,
    lastProgress: lastWorkerProgress,
  };
}

export function terminateIndexWorker(): void {
  worker?.terminate();
  worker = null;
  initPromise = null;
  initResolve = null;
  initReject = null;
  for (const req of pending.values()) {
    req.reject(new Error('Index Worker 已终止'));
  }
  pending.clear();
  for (const req of hostPending.values()) {
    req.reject(new Error('Index Worker 已终止'));
  }
  hostPending.clear();
  lastWorkerProgress = null;
  activeRequestKind = null;
}

export function abortIndexWorker(): void {
  worker?.postMessage({ kind: 'abort' });
}

export async function buildIndexInWorker(
  onProgress?: (progress: IndexProgress) => void,
  force = false,
): Promise<BuildIndexResult> {
  const config = getCottageConfig();
  const ragConfig = config.rag;
  if (!ragConfig?.indexing || !ragConfig.embedding) {
    throw new Error('RAG 配置不完整');
  }

  const w = await ensureIndexWorker();
  if (!w) {
    throw new Error('Index Worker 初始化失败：工作区未打开');
  }

  return new Promise<BuildIndexResult>((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      onProgress,
      kind: 'buildIndex',
    });
    activeRequestKind = 'buildIndex';
    w.postMessage({
      kind: 'request',
      id,
      request: {
        type: 'buildIndex',
        force,
        ragConfig: structuredClone(ragConfig) as RagConfig,
      },
    });
  });
}

export async function incrementalIndexInWorker(
  paths: readonly string[],
  ragConfig: RagConfig,
  onProgress?: (progress: IndexProgress) => void,
): Promise<IncrementalIndexResult> {
  if (!ragConfig.indexing || !ragConfig.embedding) {
    throw new Error('RAG 配置不完整');
  }

  const w = await ensureIndexWorker();
  if (!w) {
    throw new Error('Index Worker 初始化失败：工作区未打开');
  }

  return new Promise<IncrementalIndexResult>((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
      onProgress,
      kind: 'incrementalIndex',
    });
    activeRequestKind = 'incrementalIndex';
    w.postMessage({
      kind: 'request',
      id,
      request: {
        type: 'incrementalIndex',
        paths: [...paths],
        ragConfig: structuredClone(ragConfig) as RagConfig,
      },
    });
  });
}

function handleWorkerMessage(message: unknown): void {
  if (!message || typeof message !== 'object') return;
  const msg = message as {
    kind?: string;
    id?: number;
    result?: BuildIndexResult | IncrementalIndexResult;
    error?: string;
    init?: 'done' | 'error';
    progress?: IndexProgress;
    request?: { type: 'readOfficeText'; path: string };
  };

  if (msg.kind === 'init') {
    if (msg.init === 'done') {
      initResolve?.(worker);
    } else {
      initReject?.(new Error(msg.error ?? 'Index Worker 初始化失败'));
      terminateIndexWorker();
    }
    initResolve = null;
    initReject = null;
    return;
  }

  if (msg.kind === 'host_request' && msg.id !== undefined && msg.request) {
    void handleHostRequest(msg.id, msg.request);
    return;
  }

  if (msg.kind === 'progress' && msg.id !== undefined && msg.progress) {
    lastWorkerProgress = msg.progress;
    pending.get(msg.id)?.onProgress?.(msg.progress);
    return;
  }

  if (msg.kind !== 'response') return;

  const req = pending.get(msg.id ?? -1);
  if (!req) return;
  pending.delete(msg.id ?? -1);
  lastWorkerProgress = null;
  if (pending.size === 0) {
    activeRequestKind = null;
  } else {
    const next = pending.values().next().value;
    activeRequestKind = next?.kind ?? null;
  }

  if (msg.error) {
    req.reject(new Error(msg.error));
  } else {
    req.resolve(msg.result);
  }
}

async function handleHostRequest(
  id: number,
  request: { type: 'readOfficeText'; path: string },
): Promise<void> {
  try {
    let result: string | null = null;
    if (request.type === 'readOfficeText') {
      result = await extractOfficeText(request.path);
    }
    worker?.postMessage({ kind: 'host_response', id, result });
  } catch (error) {
    worker?.postMessage({
      kind: 'host_response',
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
