/**
 * Workspace Walker Worker：在独立线程执行 FSA 遍历，
 * 支持整树 snapshot 与单层 listDir，避免主线程被 FSA IO 占满导致 UI 卡顿。
 */

import { listDirectoryContentsCore } from './listDirectoryContentsCore';
import { walkWorkspaceCore, type WalkResult } from './walkWorkspaceCore';
import type { ExplorerEntry } from './explorerTypes';

let rootHandle: FileSystemDirectoryHandle | null = null;
let rootName = '';
let abortController: AbortController | null = null;

type WalkerRequest =
  | { type: 'snapshot' }
  | { type: 'listDir'; path: string; includeFileMetadata: boolean };

self.onmessage = async (event: MessageEvent<unknown>) => {
  const message = event.data as
    | { type: 'init'; rootHandle: FileSystemDirectoryHandle }
    | { kind: 'request'; id: number; request: WalkerRequest }
    | { kind: 'abort' };

  if (message && 'type' in message && message.type === 'init') {
    rootHandle = message.rootHandle;
    rootName = rootHandle?.name ?? '';
    self.postMessage({ kind: 'init', init: 'done' });
    return;
  }

  if (message && 'kind' in message && message.kind === 'abort') {
    abortController?.abort();
    return;
  }

  if (message && 'kind' in message && message.kind === 'request') {
    await handleRequest(message.id, message.request);
  }
};

function makeProgressFn(id: number): (iteration: number) => void {
  let lastReport = 0;
  return (iteration: number) => {
    if (iteration - lastReport >= 256) {
      lastReport = iteration;
      self.postMessage({ kind: 'progress', id, progress: { iteration } });
    }
  };
}

async function handleRequest(id: number, request: WalkerRequest): Promise<void> {
  if (!rootHandle) {
    self.postMessage({ kind: 'response', id, error: 'Walker Worker 未初始化' });
    return;
  }
  abortController = new AbortController();
  const progressFn = makeProgressFn(id);

  try {
    let result: WalkResult | ExplorerEntry[];
    if (request.type === 'snapshot') {
      result = await walkWorkspaceCore(rootHandle, rootName, {
        signal: abortController.signal,
        yieldFn: progressFn,
      });
    } else {
      result = await listDirectoryContentsCore(rootHandle, request.path, {
        signal: abortController.signal,
        includeFileMetadata: request.includeFileMetadata,
        yieldFn: progressFn,
      });
    }
    self.postMessage({ kind: 'response', id, result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    self.postMessage({ kind: 'response', id, error: msg });
  } finally {
    abortController = null;
  }
}
