/**
 * Diff Worker 主机：复用单 Worker 实例，主线程仅收发结果。
 */

import { diffLines } from '../domains/coding/ast/diff';

import DiffWorker from './diff.worker?worker';

type Pending = {
  resolve: (diff: string) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

const ensureWorker = (): Worker => {
  if (worker) return worker;

  const instance = new DiffWorker();
  instance.onmessage = (event: MessageEvent<{ type: string; id: number; diff?: string; error?: string }>) => {
    const message = event.data;
    const req = pending.get(message.id);
    if (!req) return;
    pending.delete(message.id);

    if (message.type === 'error') {
      req.reject(new Error(message.error ?? 'Diff Worker 失败'));
      return;
    }
    req.resolve(message.diff ?? '');
  };

  instance.onerror = (event) => {
    console.error('[DiffWorker] error:', event);
    terminateDiffWorker();
  };

  worker = instance;
  return instance;
};

export const terminateDiffWorker = (): void => {
  worker?.terminate();
  worker = null;
  for (const req of pending.values()) {
    req.reject(new Error('Diff Worker 已终止'));
  }
  pending.clear();
};

export const getDiffWorkerStatus = (): {
  alive: boolean;
  pendingRequests: number;
} => ({
  alive: worker !== null,
  pendingRequests: pending.size,
});

export const computeDiffInWorker = (
  before: string,
  after: string,
  signal?: AbortSignal,
): Promise<string> => {
  if (before === after) return Promise.resolve('');

  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Diff 计算已取消', 'AbortError'));
      return;
    }

    const id = ++nextId;
    const onAbort = () => {
      pending.delete(id);
      reject(new DOMException('Diff 计算已取消', 'AbortError'));
    };

    pending.set(id, {
      resolve: (diff) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(diff);
      },
      reject: (error) => {
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    });

    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      ensureWorker().postMessage({ type: 'computeDiff', id, before, after });
    } catch (error) {
      pending.delete(id);
      signal?.removeEventListener('abort', onAbort);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  }).catch((error) => {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    console.warn('[DiffWorker] 回退主线程 diff:', error);
    return diffLines(before, after);
  });
};
