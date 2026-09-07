import type { TraceRecorder } from '../platform/trace';
import type { SessionEvent } from '../session/eventLog';
import type {
  EvalApprovalDecision,
  EvalApprovalRequest,
  EvalPolicyScript,
} from './types';

export const createEvalTraceRecorder = () => {
  const events: SessionEvent[] = [];
  const recorder = {
    append(event: SessionEvent) {
      events.push(event);
    },
    appendMany(next: readonly SessionEvent[]) {
      events.push(...next);
    },
    async flush() {},
    hasPending: () => false,
    getSessionId: () => 'eval',
    attach: () => () => undefined,
  } as unknown as TraceRecorder;
  return { recorder, events };
};

export const createEvalPolicyScript = (
  configured: readonly EvalApprovalDecision[] = [],
): EvalPolicyScript => {
  const decisions = configured.map((decision) => ({ ...decision }));
  const requests: EvalApprovalRequest[] = [];
  const pending: Array<{
    input: Parameters<EvalPolicyScript['gate']>[0];
    configured: EvalApprovalDecision;
    resolve: (verdict: { allowed: boolean; reason?: string }) => void;
  }> = [];

  const recordDecision = (
    input: Parameters<EvalPolicyScript['gate']>[0],
    decision: EvalApprovalDecision,
    announce = true,
  ) => {
    const message = `评测审批：${input.toolName}`;
    if (announce) input.onAwaitingApproval?.({ message });
    requests.push({
      toolName: input.toolName,
      callId: input.callId,
      args: input.args,
      message,
      decision,
    });
  };

  return {
    decisions,
    requests,
    async gate(input) {
      const index = decisions.findIndex(
        (decision) => !decision.toolName || decision.toolName === input.toolName,
      );
      if (index < 0) return { allowed: true };
      const [decision] = decisions.splice(index, 1);
      if (!decision) return { allowed: true };
      if (decision.waitForAction) {
        input.onAwaitingApproval?.({ message: `评测审批：${input.toolName}` });
        return new Promise<{ allowed: boolean; reason?: string }>((resolve) => {
          pending.push({ input, configured: decision, resolve });
        });
      }
      const resolved = { ...decision, allowed: decision.allowed === true };
      recordDecision(input, resolved);
      return resolved.allowed
        ? { allowed: true }
        : { allowed: false, reason: resolved.reason ?? '评测脚本拒绝了操作' };
    },
    async resolvePending(resolution) {
      for (let attempt = 0; attempt < 100 && pending.length === 0; attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const index = pending.findIndex(
        (entry) => !resolution.toolName || entry.input.toolName === resolution.toolName,
      );
      if (index < 0) {
        throw new Error(`没有等待中的审批：${resolution.toolName ?? '*'}`);
      }
      const [entry] = pending.splice(index, 1);
      if (!entry) throw new Error('等待中的审批已消失');
      const decision: EvalApprovalDecision = {
        ...entry.configured,
        allowed: resolution.allowed,
        reason: resolution.reason ?? entry.configured.reason,
      };
      recordDecision(entry.input, decision, false);
      entry.resolve(
        resolution.allowed
          ? { allowed: true }
          : { allowed: false, reason: decision.reason ?? '评测脚本拒绝了操作' },
      );
    },
    pendingCount: () => pending.length,
    assertExhausted() {
      if (pending.length > 0) {
        throw new Error(`仍有 ${pending.length} 个审批处于等待状态`);
      }
      if (decisions.length > 0) {
        throw new Error(
          `尚有 ${decisions.length} 个审批决策未消费：${decisions
            .map((decision) => decision.toolName ?? '*')
            .join(', ')}`,
        );
      }
    },
  };
};

/** Vitest 的 Node 环境没有 Web Locks；显式安装串行实现以测试写工具。 */
export const installEvalWebLocks = (): void => {
  const currentNavigator = globalThis.navigator;
  if (currentNavigator?.locks) return;
  if (!currentNavigator) {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    });
  }
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object) => Promise<unknown>,
      ) => callback({}),
    },
  });
};
