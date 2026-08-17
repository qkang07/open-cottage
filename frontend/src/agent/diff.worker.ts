/**
 * Diff Worker：在独立线程计算 unified diff，避免大文件 before/after 阻塞主线程 UI。
 */

import { diffLines } from '../domains/coding/ast/diff';

type DiffWorkerRequest = {
  type: 'computeDiff';
  id: number;
  before: string;
  after: string;
};

type DiffWorkerResponse =
  | { type: 'result'; id: number; diff: string }
  | { type: 'error'; id: number; error: string };

self.onmessage = (event: MessageEvent<DiffWorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'computeDiff') return;

  try {
    const diff =
      message.before === message.after
        ? ''
        : diffLines(message.before, message.after);
    self.postMessage({
      type: 'result',
      id: message.id,
      diff,
    } satisfies DiffWorkerResponse);
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies DiffWorkerResponse);
  }
};
