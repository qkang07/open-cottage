/**
 * Pyodide Web Worker
 *
 * 在独立线程中加载和运行 Python 代码。
 * 通过 postMessage RPC 与主线程通信。
 */

/// <reference lib="webworker" />

declare const self: DedicatedWorkerGlobalScope;

// Pyodide 类型（简化，运行时从 CDN 加载）
interface PyodideInterface {
  runPythonAsync(code: string): Promise<unknown>;
  loadPackagesFromImports(code: string): Promise<void>;
  setStdout(options: { batched: (text: string) => void }): void;
  setStderr(options: { batched: (text: string) => void }): void;
}

declare function loadPyodide(options?: {
  indexURL?: string;
}): Promise<PyodideInterface>;

export type WorkerRequest =
  | { type: 'init'; cdnBaseUrl?: string }
  | { type: 'execute'; id: string; code: string };

export type WorkerResponse =
  | { type: 'init-ok' }
  | { type: 'init-error'; error: string }
  | { type: 'result'; id: string; result: string; stdout: string; stderr: string }
  | { type: 'error'; id: string; error: string; stdout: string; stderr: string };

let pyodide: PyodideInterface | null = null;

const DEFAULT_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

async function initPyodide(cdnBaseUrl?: string): Promise<void> {
  if (pyodide) return;

  const indexURL = cdnBaseUrl || DEFAULT_CDN;

  // 动态导入 pyodide loader
  importScripts(`${indexURL}pyodide.js`);

  pyodide = await loadPyodide({ indexURL });
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      await initPyodide(msg.cdnBaseUrl);
      self.postMessage({ type: 'init-ok' } satisfies WorkerResponse);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      self.postMessage({ type: 'init-error', error } satisfies WorkerResponse);
    }
    return;
  }

  if (msg.type === 'execute') {
    let stdout = '';
    let stderr = '';

    if (!pyodide) {
      self.postMessage({
        type: 'error',
        id: msg.id,
        error: 'Pyodide not initialized',
        stdout: '',
        stderr: '',
      } satisfies WorkerResponse);
      return;
    }

    // 重定向 stdout / stderr
    pyodide.setStdout({ batched: (text) => { stdout += text + '\n'; } });
    pyodide.setStderr({ batched: (text) => { stderr += text + '\n'; } });

    try {
      // 自动安装 imports 中引用的包
      await pyodide.loadPackagesFromImports(msg.code);

      const result = await pyodide.runPythonAsync(msg.code);
      const resultStr = result !== undefined && result !== null
        ? String(result)
        : '';

      self.postMessage({
        type: 'result',
        id: msg.id,
        result: resultStr,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      } satisfies WorkerResponse);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      self.postMessage({
        type: 'error',
        id: msg.id,
        error,
        stdout: stdout.trimEnd(),
        stderr: stderr.trimEnd(),
      } satisfies WorkerResponse);
    }
  }
});
