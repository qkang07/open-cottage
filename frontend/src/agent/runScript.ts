import { handleScriptWorkerRequest } from './scriptWorkerHost';
import type {
  WorkerHostMessage,
  WorkerOutbound,
  WorkerRequest,
  WorkerResponse,
} from './scriptWorkerProtocol';
import type { ToolStreamChunk } from './toolStream';

import ScriptWorker from './script.worker?worker';

export interface RunScriptResult {
  result: unknown;
  logs: string[];
}

/** 主线程侧 agent 工具桥：按名称执行工具并返回可结构化克隆的结果 */
export type ScriptToolInvoker = (
  name: string,
  args: unknown,
  /** 可选调用上下文；第三参向后兼容 */
  options?: { signal?: AbortSignal },
) => Promise<unknown>;

interface ExecuteScriptWorkerOptions {
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  /** cottage.* SDK 的工具执行桥；未注入时脚本内调用 cottage.* 会报错 */
  invokeTool?: ScriptToolInvoker;
}

const READ_ONLY_WORKER_API = new Set(['listFiles', 'readFile', 'exists']);

const scriptApiToolCall = (
  request: Exclude<WorkerRequest, { type: 'invokeTool' }>,
): { name: string; args: Record<string, unknown> } => {
  const { id: _id, type, ...rest } = request;
  if (type === 'patchFile') {
    return { name: type, args: { path: request.path, ...request.patches } };
  }
  return { name: type, args: rest };
};

export const executeScriptWorker = (
  code: string,
  options?: ExecuteScriptWorkerOptions,
): Promise<RunScriptResult> => {
  const worker = new ScriptWorker();
  const logs: string[] = [];
  const signal = options?.signal;

  return new Promise((resolve, reject) => {
    const finish = (
      outcome: 'resolve' | 'reject',
      value: RunScriptResult | Error,
    ) => {
      signal?.removeEventListener('abort', onAbort);
      worker.removeEventListener('message', onMessage);
      worker.terminate();
      if (outcome === 'resolve') {
        resolve(value as RunScriptResult);
      } else {
        reject(value);
      }
    };

    const onAbort = () => {
      finish('reject', new DOMException('脚本执行已停止', 'AbortError'));
    };

    if (signal?.aborted) {
      worker.terminate();
      reject(new DOMException('脚本执行已停止', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', onAbort);

    const onMessage = async (event: MessageEvent<WorkerOutbound>) => {
      const message = event.data;

      if (message.type === 'log') {
        const line = message.args
          .map((item) =>
            typeof item === 'string' ? item : JSON.stringify(item),
          )
          .join(' ');
        logs.push(line);
        options?.onLog?.(line);
        return;
      }

      if ('id' in message && !('ok' in message)) {
        const request = message as WorkerRequest;
        try {
          let result: unknown;
          if (request.type === 'invokeTool') {
            if (!options?.invokeTool) {
              throw new Error(
                'cottage 工具 SDK 不可用：当前脚本环境未注入 agent 工具桥',
              );
            }
            result = await options.invokeTool(request.name, request.args, {
              signal,
            });
          } else if (options?.invokeTool) {
            // 已注入统一工具桥时，Worker 的 api.* 与 cottage.* 一样逐项经过
            // Plan 范围、风险审批、预算、检查点和 trace，避免内部调用绕过闸门。
            const call = scriptApiToolCall(request);
            result = await options.invokeTool(call.name, call.args, { signal });
          } else {
            if (!READ_ONLY_WORKER_API.has(request.type)) {
              throw new Error(
                `Worker api.${request.type} 需要统一工具执行器；只读验证环境禁止写入`,
              );
            }
            result = await handleScriptWorkerRequest(request);
          }
          worker.postMessage({
            id: request.id,
            ok: true,
            result,
          } satisfies WorkerResponse);
        } catch (error) {
          worker.postMessage({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } satisfies WorkerResponse);
        }
        return;
      }

      if (message.type === 'done') {
        finish('resolve', { result: message.result, logs });
        return;
      }

      if (message.type === 'error') {
        finish('reject', new Error(message.error));
        return;
      }
      finish(
        'reject',
        new Error(`Worker 返回了未知消息: ${JSON.stringify(message)}`),
      );
    };

    worker.addEventListener('message', onMessage);
    worker.postMessage({ type: 'run', code } satisfies WorkerHostMessage);
  });
};

export const runScriptInWorker = (
  code: string,
  signal?: AbortSignal,
  invokeTool?: ScriptToolInvoker,
): Promise<RunScriptResult> => executeScriptWorker(code, { signal, invokeTool });

export async function* streamRunScriptInWorker(
  code: string,
  signal?: AbortSignal,
  invokeTool?: ScriptToolInvoker,
): AsyncGenerator<ToolStreamChunk> {
  const pending: ToolStreamChunk[] = [];
  let wake: (() => void) | undefined;
  let settled = false;
  let settleError: Error | undefined;

  const notify = () => {
    wake?.();
    wake = undefined;
  };

  void executeScriptWorker(code, {
    signal,
    invokeTool,
    onLog: (line) => {
      pending.push({ type: 'delta', text: `${line}\n` });
      notify();
    },
  }).then(
    (value) => {
      pending.push({ type: 'done', value });
      settled = true;
      notify();
    },
    (error) => {
      settleError = error instanceof Error ? error : new Error(String(error));
      settled = true;
      notify();
    },
  );

  while (true) {
    if (signal?.aborted) {
      throw new DOMException('脚本执行已停止', 'AbortError');
    }
    while (pending.length) {
      const chunk = pending.shift()!;
      yield chunk;
      if (chunk.type === 'done') return;
    }
    if (settled) {
      if (settleError) throw settleError;
      return;
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}
