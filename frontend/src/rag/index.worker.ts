/**
 * RAG 索引 Worker：在独立线程执行扫描 / 分块 / 嵌入 / 落盘，避免阻塞主线程 UI。
 */

import { createFsAdapter } from '../history/fsaGitAdapter';
import type { RagConfig } from '../config/constants';
import { buildIndexCore } from './indexCore';
import { incrementalIndexCore } from './incrementalIndexCore';
import { createIndexWorkspaceFromFs } from './indexWorkspace';
import type { IndexProgress } from './types';

let rootHandle: FileSystemDirectoryHandle | null = null;
let ws: ReturnType<typeof createIndexWorkspaceFromFs> | null = null;
let abortController: AbortController | null = null;

type IndexWorkerRequest =
  | { type: 'buildIndex'; force?: boolean; ragConfig: RagConfig }
  | { type: 'incrementalIndex'; paths: string[]; ragConfig: RagConfig };

type HostRequest =
  | { type: 'readOfficeText'; path: string };

let hostRequestId = 0;
const hostPending = new Map<
  number,
  { resolve: (value: string | null) => void; reject: (error: Error) => void }
>();

const callHost = (request: HostRequest): Promise<string | null> =>
  new Promise((resolve, reject) => {
    const id = ++hostRequestId;
    hostPending.set(id, { resolve, reject });
    self.postMessage({ kind: 'host_request', id, request });
  });

self.onmessage = async (event: MessageEvent<unknown>) => {
  const message = event.data as
    | { type: 'init'; rootHandle: FileSystemDirectoryHandle }
    | { kind: 'request'; id: number; request: IndexWorkerRequest }
    | { kind: 'abort' }
    | { kind: 'host_response'; id: number; result?: string | null; error?: string };

  if ('type' in message && message.type === 'init') {
    try {
      rootHandle = message.rootHandle;
      ws = createIndexWorkspaceFromFs(createFsAdapter(rootHandle));
      self.postMessage({ kind: 'init', init: 'done' });
    } catch (error) {
      self.postMessage({
        kind: 'init',
        init: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if ('kind' in message && message.kind === 'host_response') {
    const pending = hostPending.get(message.id);
    if (!pending) return;
    hostPending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error));
    } else {
      pending.resolve(message.result ?? null);
    }
    return;
  }

  if ('kind' in message && message.kind === 'abort') {
    abortController?.abort();
    return;
  }

  if ('kind' in message && message.kind === 'request') {
    await handleRequest(message.id, message.request);
  }
};

async function handleRequest(id: number, request: IndexWorkerRequest): Promise<void> {
  if (!ws) {
    self.postMessage({
      kind: 'response',
      id,
      error: 'Index Worker 未初始化',
    });
    return;
  }

  if (request.type === 'buildIndex') {
    abortController?.abort();
    abortController = new AbortController();
    const signal = abortController.signal;

    try {
      const result = await buildIndexCore({
        ws,
        ragConfig: request.ragConfig,
        force: request.force,
        signal,
        onProgress: (progress: IndexProgress) => {
          self.postMessage({ kind: 'progress', id, progress });
        },
        readOfficeText: (path) => callHost({ type: 'readOfficeText', path }),
      });
      self.postMessage({ kind: 'response', id, result });
    } catch (error) {
      self.postMessage({
        kind: 'response',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (abortController?.signal === signal) {
        abortController = null;
      }
    }
    return;
  }

  if (request.type === 'incrementalIndex') {
    try {
      const result = await incrementalIndexCore({
        ws,
        ragConfig: request.ragConfig,
        paths: request.paths,
        onProgress: (progress: IndexProgress) => {
          self.postMessage({ kind: 'progress', id, progress });
        },
        readOfficeText: (path) => callHost({ type: 'readOfficeText', path }),
      });
      self.postMessage({ kind: 'response', id, result });
    } catch (error) {
      self.postMessage({
        kind: 'response',
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
