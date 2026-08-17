import type { ScriptToolInvoker } from './runScript';
import {
  BLOCKED_SCRIPT_TOOL_NAMES,
  type UnifiedToolExecutor,
} from './toolInvocation';

/**
 * 脚本内禁止调用的工具名单：定义在统一执行器（toolInvocation.ts），
 * 此处仅转出以保持既有导出兼容。
 */
export { BLOCKED_SCRIPT_TOOL_NAMES };

export const isScriptBlockedToolName = (name: string): boolean =>
  BLOCKED_SCRIPT_TOOL_NAMES.has(name);

export interface CreateScriptToolInvokerOptions {
  /**
   * 统一工具执行器（lazy，规避组装顺序 / reuseAgent 热切换问题）。
   * 未注入时拒绝调用，不能降级到无治理的直接 invoke。
   */
  getExecutor?: () => UnifiedToolExecutor | undefined;
  /** 宿主 runScript 的 callId（重复指纹计次作用域 + trace 归属） */
  getParentCallId?: () => string | undefined;
}

/**
 * 构建 cottage.* SDK 的主线程执行桥：
 * 构造 { source: 'script' } 请求走统一执行器管线（黑名单 / 重复指纹 /
 * planGate / auto-allow 审批 / doom record / trace），输出经净化回 Worker。
 * 脚本内产图工具的图片留在工作区文件，cottageImages 附件通道由执行器剥离，
 * 不随脚本结果回传。
 */
export const createScriptToolInvoker = (
  options: CreateScriptToolInvokerOptions,
): ScriptToolInvoker => {
  return async (name, args, invokeOptions) => {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('cottage 工具名不能为空');
    }
    const executor = options.getExecutor?.();
    if (!executor) {
      throw new Error(`cottage.${name} 无法执行：统一工具执行器不可用`);
    }

    const outcome = await executor.invoke({
      toolName: name,
      args,
      source: 'script',
      signal: invokeOptions?.signal,
      parentCallId: options.getParentCallId?.(),
    });
    if (outcome.status !== 'ok') {
      throw new Error(outcome.resultText);
    }
    return outcome.rawOutput;
  };
};
