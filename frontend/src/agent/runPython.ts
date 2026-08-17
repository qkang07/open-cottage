/**
 * runPython - 在 Web Worker 中通过 Pyodide 执行 Python 代码
 *
 * 懒初始化 Worker（首次调用时创建），支持超时和中断。
 */

import { getCottageConfig } from '../config/store';
import type { WorkerRequest, WorkerResponse } from './pyodide.worker';

export interface PythonResult {
  result: string;
  stdout: string;
  stderr: string;
}

let worker: Worker | null = null;
let initialized = false;
let initializing: Promise<void> | null = null;

/**
 * 懒初始化 Pyodide Worker
 */
const ensureWorker = async (): Promise<Worker> => {
  if (worker && initialized) return worker;

  if (initializing) {
    await initializing;
    return worker!;
  }

  const config = getCottageConfig();
  const cdnBaseUrl = config.python?.cdnBaseUrl;

  initializing = new Promise<void>((resolve, reject) => {
    // 使用 Vite 的 Worker 导入语法
    worker = new Worker(
      new URL('./pyodide.worker.ts', import.meta.url),
      { type: 'module' },
    );

    const initMsg: WorkerRequest = { type: 'init', cdnBaseUrl };
    worker.postMessage(initMsg);

    const handler = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'init-ok') {
        initialized = true;
        worker!.removeEventListener('message', handler);
        resolve();
      } else if (msg.type === 'init-error') {
        worker!.removeEventListener('message', handler);
        reject(new Error(`Pyodide init failed: ${msg.error}`));
      }
    };

    worker.addEventListener('message', handler);
    worker.addEventListener('error', (err) => {
      reject(new Error(`Worker error: ${err.message}`));
    });
  });

  try {
    await initializing;
  } finally {
    initializing = null;
  }

  return worker!;
};

/**
 * 在 Pyodide Worker 中执行 Python 代码
 */
export const runPythonInWorker = async (
  code: string,
  signal?: AbortSignal,
): Promise<PythonResult> => {
  const config = getCottageConfig();
  const timeoutMs = config.python?.timeoutMs ?? 120_000;

  const w = await ensureWorker();
  const id = crypto.randomUUID();

  return new Promise<PythonResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let abortHandler: (() => void) | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (abortHandler && signal) {
        signal.removeEventListener('abort', abortHandler);
      }
      w.removeEventListener('message', handler);
    };

    const handler = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === 'result' && msg.id === id) {
        cleanup();
        resolve({ result: msg.result, stdout: msg.stdout, stderr: msg.stderr });
      } else if (msg.type === 'error' && msg.id === id) {
        cleanup();
        reject(new PythonExecutionError(msg.error, msg.stdout, msg.stderr));
      }
    };

    w.addEventListener('message', handler);

    // 超时处理
    timer = setTimeout(() => {
      cleanup();
      terminateWorker();
      reject(new PythonExecutionError(
        `Python execution timed out after ${timeoutMs}ms`,
        '',
        '',
      ));
    }, timeoutMs);

    // Abort 信号处理
    if (signal) {
      abortHandler = () => {
        cleanup();
        terminateWorker();
        reject(new PythonExecutionError('Python execution aborted', '', ''));
      };
      signal.addEventListener('abort', abortHandler);
    }

    // 发送执行请求
    const req: WorkerRequest = { type: 'execute', id, code };
    w.postMessage(req);
  });
};

/**
 * 终止 Worker（超时或中断时使用，下次调用会重新创建）
 */
const terminateWorker = () => {
  if (worker) {
    worker.terminate();
    worker = null;
    initialized = false;
  }
};

/**
 * 手动释放 Worker 资源
 */
export const disposePythonWorker = () => {
  terminateWorker();
};

export class PythonExecutionError extends Error {
  stdout: string;
  stderr: string;

  constructor(message: string, stdout: string, stderr: string) {
    super(message);
    this.name = 'PythonExecutionError';
    this.stdout = stdout;
    this.stderr = stderr;
  }
}
