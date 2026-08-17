/**
 * AST 编辑 Worker：在独立线程执行 babel 解析与 patch apply，避免大文件 dryRun 阻塞主线程。
 */

import { applyAstOperations } from './astApplyCore';
import { loadAstOpsByAdapterId } from './astWorkerLoadOps';
import type { AstOperation } from './types';

type AstWorkerRequest = {
  type: 'apply';
  id: number;
  adapterId: string;
  content: string;
  operations: AstOperation[];
};

type AstWorkerResponse =
  | { type: 'result'; id: number; outcome: ReturnType<typeof applyAstOperations> }
  | { type: 'error'; id: number; error: string };

self.onmessage = async (event: MessageEvent<AstWorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'apply') return;

  try {
    const ops = await loadAstOpsByAdapterId(message.adapterId);
    const outcome = applyAstOperations(ops, message.content, message.operations);
    self.postMessage({
      type: 'result',
      id: message.id,
      outcome,
    } satisfies AstWorkerResponse);
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies AstWorkerResponse);
  }
};
