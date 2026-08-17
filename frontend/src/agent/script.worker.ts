import type { ApplyPatchesInput } from './patchFile';
import type {
  WorkerHostMessage,
  WorkerOutbound,
  WorkerRequest,
  WorkerRequestWithoutId,
  WorkerResponse,
} from './scriptWorkerProtocol';
import { serializeScriptResult } from './scriptWorkerProtocol';

export type {
  WorkerHostMessage,
  WorkerOutbound,
  WorkerRequest,
  WorkerRequestWithoutId,
  WorkerResponse,
} from './scriptWorkerProtocol';

const pending = new Map<number, (response: WorkerResponse) => void>();
let requestId = 0;

const callHost = <T,>(request: WorkerRequestWithoutId): Promise<T> =>
  new Promise((resolve, reject) => {
    const id = requestId + 1;
    requestId = id;
    pending.set(id, (response) => {
      if (response.ok) resolve(response.result as T);
      else reject(new Error(response.error));
    });
    self.postMessage({ ...request, id } satisfies WorkerRequest);
  });

const api = {
  listFiles: (prefix = '') =>
    callHost<string[]>({ type: 'listFiles', prefix }),
  readFile: (path: string) =>
    callHost<{ path: string; content: string }>({ type: 'readFile', path }),
  writeFile: (path: string, content: string) =>
    callHost<{ path: string; written: boolean }>({
      type: 'writeFile',
      path,
      content,
    }),
  createFile: (path: string, content = '') =>
    callHost<{ path: string; written: boolean }>({
      type: 'createFile',
      path,
      content,
    }),
  patchFile: (path: string, patches: ApplyPatchesInput) =>
    callHost<{
      path: string;
      written: boolean;
      lineEdits: number;
      columnEdits: number;
      regexReplacements: number;
    }>({ type: 'patchFile', path, patches }),
  exists: (path: string) => callHost<boolean>({ type: 'exists', path }),
  deleteFiles: (paths: string[]) =>
    callHost<{ deletedFiles: string[]; deletedDirs: string[] }>({
      type: 'deleteFiles',
      paths,
    }),
  mkdir: (path: string) =>
    callHost<{ path: string; created: boolean }>({ type: 'mkdir', path }),
  rename: (from: string, to: string) =>
    callHost<{ from: string; to: string; renamed: boolean }>({
      type: 'rename',
      from,
      to,
    }),
  compress: (paths: string[], outputPath: string) =>
    callHost<{
      outputPath: string;
      fileCount: number;
      files: string[];
    }>({ type: 'compress', paths, outputPath }),
  extract: (archivePath: string, targetDir = '') =>
    callHost<{
      archivePath: string;
      targetDir: string;
      written: string[];
      createdDirs: string[];
    }>({ type: 'extract', archivePath, targetDir }),
  log: (...args: unknown[]) => {
    self.postMessage({ type: 'log', args } satisfies WorkerOutbound);
  },
};

/**
 * agent 工具 SDK：cottage.<工具名>(args) → 经主线程桥执行对应 agent 工具。
 * 屏蔽 then/toJSON 等属性，避免 await cottage 时被当作 thenable 解包。
 */
const cottage = new Proxy(Object.create(null) as Record<string, unknown>, {
  get(_target, prop) {
    if (typeof prop !== 'string') return undefined;
    if (prop === 'then' || prop === 'toJSON') return undefined;
    return (args?: unknown) =>
      callHost<unknown>({ type: 'invokeTool', name: prop, args: args ?? {} });
  },
  has: () => true,
});

self.onmessage = async (event: MessageEvent<WorkerHostMessage>) => {
  const message = event.data;
  if ('id' in message && ('ok' in message || 'error' in message)) {
    pending.get(message.id)?.(message as WorkerResponse);
    pending.delete(message.id);
    return;
  }

  if (message.type !== 'run') return;

  try {
    const runner = new Function(
      'api',
      'cottage',
      `"use strict";\nreturn (async () => {\n${message.code}\n})();`,
    );
    const result = await runner(api, cottage);
    const serialized = serializeScriptResult(result);
    self.postMessage({ type: 'done', result: serialized } satisfies WorkerOutbound);
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerOutbound);
  }
};
