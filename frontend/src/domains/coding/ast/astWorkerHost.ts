/**
 * AST Worker 主机：复用单 Worker，失败时回退主线程。
 */

import { applyAstOperations, type AstApplyOutcome } from './astApplyCore';
import { listAstEditAdapters, loadAstOps, resolveAstAdapter } from './adapterRegistry';
import type { AstOperation } from './types';

import AstWorker from './ast.worker?worker';

type Pending = {
  resolve: (outcome: AstApplyOutcome) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

const ensureWorker = (): Worker => {
  if (worker) return worker;

  const instance = new AstWorker();
  instance.onmessage = (
    event: MessageEvent<{
      type: string;
      id: number;
      outcome?: AstApplyOutcome;
      error?: string;
    }>,
  ) => {
    const message = event.data;
    const req = pending.get(message.id);
    if (!req) return;
    pending.delete(message.id);

    if (message.type === 'error') {
      req.reject(new Error(message.error ?? 'AST Worker 失败'));
      return;
    }
    req.resolve(message.outcome!);
  };

  instance.onerror = (event) => {
    console.error('[AstWorker] error:', event);
    terminateAstWorker();
  };

  worker = instance;
  return instance;
};

export const terminateAstWorker = (): void => {
  worker?.terminate();
  worker = null;
  for (const req of pending.values()) {
    req.reject(new Error('AST Worker 已终止'));
  }
  pending.clear();
};

export const getAstWorkerStatus = (): {
  alive: boolean;
  pendingRequests: number;
} => ({
  alive: worker !== null,
  pendingRequests: pending.size,
});

export const applyAstOperationsInWorker = (
  adapterId: string,
  content: string,
  operations: AstOperation[],
  signal?: AbortSignal,
): Promise<AstApplyOutcome> =>
  new Promise<AstApplyOutcome>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('AST 编辑已取消', 'AbortError'));
      return;
    }

    const id = ++nextId;
    const onAbort = () => {
      pending.delete(id);
      reject(new DOMException('AST 编辑已取消', 'AbortError'));
    };

    pending.set(id, {
      resolve: (outcome) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(outcome);
      },
      reject: (error) => {
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    });

    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      ensureWorker().postMessage({
        type: 'apply',
        id,
        adapterId,
        content,
        operations,
      });
    } catch (error) {
      pending.delete(id);
      signal?.removeEventListener('abort', onAbort);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  }).catch(async (error) => {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    console.warn('[AstWorker] 回退主线程 apply:', error);
    const adapter = listAstEditAdapters().find((a) => a.id === adapterId);
    if (!adapter) throw error;
    const ops = await loadAstOps(adapter);
    return applyAstOperations(ops, content, operations);
  });

/** 按路径在 Worker 中执行 AST 操作（dryRun 与落盘前均可用） */
export const applyAstForPath = async (
  path: string,
  content: string,
  operations: AstOperation[],
  signal?: AbortSignal,
): Promise<AstApplyOutcome> => {
  const adapter = resolveAstAdapter(path);
  if (!adapter) {
    throw new Error('无 AST adapter');
  }
  return applyAstOperationsInWorker(adapter.id, content, operations, signal);
};
