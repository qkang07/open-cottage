import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CottageTool } from '@/agent/runtime/tool';

// 以桩实现接管策略评估：deny / confirm / allow 三分支均可测
vi.mock('../platform/policy/policyEngine', () => ({
  evaluateToolPolicy: (toolName: string) => {
    if (toolName === 'denyTool') {
      return { action: 'deny', reason: '该工具被策略禁止' };
    }
    if (toolName === 'confirmTool') {
      return { action: 'confirm', message: '确认？', riskLevel: 'destructive' };
    }
    return { action: 'allow' };
  },
}));

import { createUnifiedToolExecutor } from './toolInvocation';
import { createPlanGate, PlanSession, recordPlanToolOutcome } from '../platform/plan';
import { resetCapabilityRegistry } from '../platform/capabilities/registry';
import { BUILTIN_CAPABILITIES } from '../platform/capabilities/builtins';
import type { TraceRecorder } from '../platform/trace';
import type { DoomLoopDetector } from './doomLoop';

const makeTool = (
  name: string,
  impl?: (args: unknown, config?: { signal?: AbortSignal }) => unknown,
) => {
  const invoke = vi.fn(async (args: unknown, config?: { signal?: AbortSignal }) =>
    impl ? impl(args, config) : { ok: true, name },
  );
  return {
    tool: { name, description: name, invoke } as unknown as CottageTool,
    invoke,
  };
};

const makeRecorder = () => {
  const append = vi.fn();
  return { recorder: { append } as unknown as TraceRecorder, append };
};

const makeDetector = () => {
  const check = vi.fn(() => null);
  const record = vi.fn();
  return {
    detector: { check, record, reset: vi.fn() } as unknown as DoomLoopDetector,
    check,
    record,
  };
};

describe('createUnifiedToolExecutor', () => {
  beforeEach(() => {
    resetCapabilityRegistry(BUILTIN_CAPABILITIES);
    const testNavigator = globalThis.navigator ?? {};
    if (!globalThis.navigator) {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: testNavigator,
      });
    }
    Object.defineProperty(testNavigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: object) => Promise<unknown>,
        ) => callback({}),
      },
    });
  });

  it('script 来源拒绝黑名单工具', async () => {
    const { tool, invoke } = makeTool('askUser');
    const executor = createUnifiedToolExecutor({ getTool: () => tool });
    const outcome = await executor.invoke({
      toolName: 'askUser',
      args: { question: '继续吗？' },
      source: 'script',
    });
    expect(outcome.status).toBe('blocked_policy');
    expect(outcome.resultText).toContain('不可在脚本中调用');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('script 来源拒绝黑名单工具的 snake_case 变体名', async () => {
    const { tool, invoke } = makeTool('askUser');
    const executor = createUnifiedToolExecutor({ getTool: () => tool });
    const outcome = await executor.invoke({
      toolName: 'ask_user',
      args: { question: '继续吗？' },
      source: 'script',
    });
    expect(outcome.status).toBe('blocked_policy');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('script 来源拒绝未知工具', async () => {
    const executor = createUnifiedToolExecutor({ getTool: () => undefined });
    const outcome = await executor.invoke({
      toolName: 'noSuchTool',
      args: {},
      source: 'script',
    });
    expect(outcome.status).toBe('unknown_tool');
    expect(outcome.resultText).toContain('不存在');
  });

  it('blocks workspace writes when Web Locks is unavailable', async () => {
    Reflect.deleteProperty(globalThis.navigator, 'locks');
    const { tool, invoke } = makeTool('writeFile');
    const executor = createUnifiedToolExecutor({ getTool: () => tool });
    const outcome = await executor.invoke({
      toolName: 'writeFile',
      args: { path: 'frontend/src/a.ts', content: 'x' },
      source: 'agent',
    });
    expect(outcome.status).toBe('blocked_policy');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('Plan Mode 的 Worker 子调用经过范围闸门执行前后钩子', async () => {
    const { tool } = makeTool('writeFile');
    const beforeExecute = vi.fn(async () => undefined);
    const afterExecute = vi.fn(async () => undefined);
    const block = vi.fn(async () => undefined);
    const executor = createUnifiedToolExecutor({
      getTool: () => tool,
      getPlanToolGuard: () => ({
        check: () => ({
          allowed: true,
          paths: ['frontend/src/a.ts'],
          risk: 'write' as const,
        }),
        block,
        beforeExecute,
        afterExecute,
      }),
    });
    const outcome = await executor.invoke({
      toolName: 'writeFile',
      args: { path: 'frontend/src/a.ts', content: 'x' },
      source: 'script',
    });
    expect(outcome.status).toBe('ok');
    expect(beforeExecute).toHaveBeenCalledTimes(1);
    expect(afterExecute).toHaveBeenCalledWith(
      expect.objectContaining({ allowed: true }),
      true,
      { created: [], modified: [], deleted: [], moved: [] },
    );
    expect(block).not.toHaveBeenCalled();
  });

  it('auto-allow 下 deny 仍拦截', async () => {
    const { tool, invoke } = makeTool('denyTool');
    const executor = createUnifiedToolExecutor({ getTool: () => tool });
    const outcome = await executor.invoke({
      toolName: 'denyTool',
      args: {},
      source: 'script',
    });
    expect(outcome.status).toBe('blocked_policy');
    expect(outcome.resultText).toContain('安全策略');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('auto-allow 下 confirm 直接放行（runScript 统一审批语义）', async () => {
    const { tool, invoke } = makeTool('confirmTool');
    const executor = createUnifiedToolExecutor({ getTool: () => tool });
    const outcome = await executor.invoke({
      toolName: 'confirmTool',
      args: {},
      source: 'script',
    });
    expect(outcome.status).toBe('ok');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('manual 来源 confirm 放行且 trace 标记 source', async () => {
    const { tool } = makeTool('confirmTool');
    const { recorder, append } = makeRecorder();
    const executor = createUnifiedToolExecutor({
      getTool: () => tool,
      getTraceRecorder: () => recorder,
    });
    const outcome = await executor.invoke({
      toolName: 'confirmTool',
      args: {},
      source: 'manual',
    });
    expect(outcome.status).toBe('ok');
    expect(append).toHaveBeenCalledTimes(1);
    const event = append.mock.calls[0]![0];
    expect(event.source).toBe('manual');
    expect(event.round).toBe(0);
  });

  it('script 子调用计入 plan 预算，runScript 宿主防双计', async () => {
    const { tool } = makeTool('writeFile');
    const session = new PlanSession();
    session.submit({
      goal: '批量改',
      items: [{ requirement: '改文件' }],
      submittedAt: Date.now(),
    });
    const planGate = createPlanGate(session, { enabled: true });
    const executor = createUnifiedToolExecutor({
      getTool: () => tool,
      getPlanGate: () => planGate ?? undefined,
      getPlanSession: () => session,
    });
    const outcome = await executor.invoke({
      toolName: 'writeFile',
      args: { path: 'a.txt', content: 'x' },
      source: 'script',
      parentCallId: 'agent:run-1',
    });
    expect(outcome.status).toBe('ok');
    expect(session.counters.files).toBe(1);
    // 宿主 runScript 自身不重复计数
    recordPlanToolOutcome(session, 'runScript');
    expect(session.counters.files).toBe(1);
  });

  it('planGate 阻断时返回 blocked_plan 并记录原因', async () => {
    const { tool, invoke } = makeTool('writeFile');
    const session = new PlanSession();
    const planGate = createPlanGate(session, { enabled: true });
    const executor = createUnifiedToolExecutor({
      getTool: () => tool,
      getPlanGate: () => planGate ?? undefined,
      getPlanSession: () => session,
    });
    const outcome = await executor.invoke({
      toolName: 'writeFile',
      args: { path: 'a.txt', content: 'x' },
      source: 'script',
    });
    expect(outcome.status).toBe('blocked_plan');
    expect(outcome.resultText).toContain('计划闸门');
    expect(session.lastBlockedReason).toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('script 来源相同调用第 6 次被拦（上限 5，按脚本运行隔离）', async () => {
    const { tool, invoke } = makeTool('readFile');
    const executor = createUnifiedToolExecutor({ getTool: () => tool });
    const request = {
      toolName: 'readFile',
      args: { path: 'a.txt' },
      source: 'script' as const,
      parentCallId: 'agent:run-1',
    };
    for (let i = 0; i < 5; i += 1) {
      const outcome = await executor.invoke(request);
      expect(outcome.status).toBe('ok');
    }
    const blocked = await executor.invoke(request);
    expect(blocked.status).toBe('duplicate');
    expect(blocked.resultText).toContain('重复调用');
    expect(invoke).toHaveBeenCalledTimes(5);

    // 另一次脚本运行（不同 parentCallId）重新计次
    const nextRun = await executor.invoke({
      ...request,
      parentCallId: 'agent:run-2',
    });
    expect(nextRun.status).toBe('ok');
  });

  it('script 来源 record-only：执行结果写入共享 doom detector', async () => {
    const { tool } = makeTool('readFile');
    const { detector, record, check } = makeDetector();
    const executor = createUnifiedToolExecutor({
      getTool: () => tool,
      getDoomLoopDetector: () => detector,
    });
    const ok = await executor.invoke({
      toolName: 'readFile',
      args: { path: 'a.txt' },
      source: 'script',
    });
    expect(ok.status).toBe('ok');
    expect(check).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'readFile', status: 'ok' }),
    );
  });

  it('trace 事件带 source/parentCallId，round 为 0', async () => {
    const { tool } = makeTool('readFile');
    const { recorder, append } = makeRecorder();
    const executor = createUnifiedToolExecutor({
      getTool: () => tool,
      getTraceRecorder: () => recorder,
    });
    await executor.invoke({
      toolName: 'readFile',
      args: { path: 'a.txt' },
      source: 'script',
      parentCallId: 'agent:run-1',
    });
    expect(append).toHaveBeenCalledTimes(1);
    const event = append.mock.calls[0]![0];
    expect(event).toMatchObject({
      type: 'tool_call',
      name: 'readFile',
      round: 0,
      source: 'script',
      parentCallId: 'agent:run-1',
      status: 'ok',
    });
    expect(event.id).toMatch(/^script:/);
    expect(typeof event.durationMs).toBe('number');
  });

  it('signal 已 abort 时直接返回 aborted', async () => {
    const { tool, invoke } = makeTool('readFile');
    const executor = createUnifiedToolExecutor({ getTool: () => tool });
    const controller = new AbortController();
    controller.abort();
    const outcome = await executor.invoke({
      toolName: 'readFile',
      args: { path: 'a.txt' },
      source: 'script',
      signal: controller.signal,
    });
    expect(outcome.status).toBe('aborted');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('执行中 AbortError 归为 aborted 而非 error', async () => {
    const controller = new AbortController();
    const { tool } = makeTool('slowTool', () => {
      controller.abort();
      throw new DOMException('已停止', 'AbortError');
    });
    const executor = createUnifiedToolExecutor({ getTool: () => tool });
    const outcome = await executor.invoke({
      toolName: 'slowTool',
      args: {},
      source: 'script',
      signal: controller.signal,
    });
    expect(outcome.status).toBe('aborted');
  });

  it('工具抛错归为 error 并记录 doom error', async () => {
    const { tool } = makeTool('boomTool', () => {
      throw new Error('内部错误');
    });
    const { detector, record } = makeDetector();
    const { recorder, append } = makeRecorder();
    const executor = createUnifiedToolExecutor({
      getTool: () => tool,
      getDoomLoopDetector: () => detector,
      getTraceRecorder: () => recorder,
    });
    const outcome = await executor.invoke({
      toolName: 'boomTool',
      args: {},
      source: 'script',
    });
    expect(outcome.status).toBe('error');
    expect(outcome.resultText).toBe('内部错误');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error' }),
    );
    expect(append.mock.calls[0]![0].status).toBe('error');
  });

  it('script 来源剥离 cottageImages 与写入快照，rawOutput 可结构化克隆', async () => {
    const { tool } = makeTool('writeFile', () => ({
      ok: true,
      before: 'old',
      after: 'new',
      created: false,
      cottageImages: ['img/a.png'],
    }));
    const executor = createUnifiedToolExecutor({ getTool: () => tool });
    const outcome = await executor.invoke({
      toolName: 'writeFile',
      args: { path: 'a.txt', content: 'new' },
      source: 'script',
    });
    expect(outcome.status).toBe('ok');
    expect(outcome.imagePaths).toEqual(['img/a.png']);
    expect(outcome.snapshot).toEqual({ before: 'old', after: 'new', created: false });
    const raw = outcome.rawOutput as Record<string, unknown>;
    expect(raw.ok).toBe(true);
    expect(raw.before).toBeUndefined();
    expect(raw.after).toBeUndefined();
    expect(raw.cottageImages).toBeUndefined();
  });

  it('policyApproval gate 模式走 PolicyGate，拒绝时 blocked_policy', async () => {
    const { tool, invoke } = makeTool('confirmTool');
    const policyGate = vi.fn(async () => ({
      allowed: false,
      reason: '用户拒绝了该操作',
    }));
    const executor = createUnifiedToolExecutor({
      getTool: () => tool,
      getPolicyGate: () => policyGate,
      policyOverrides: { script: { policyApproval: 'gate' } },
    });
    const outcome = await executor.invoke({
      toolName: 'confirmTool',
      args: {},
      source: 'script',
    });
    expect(outcome.status).toBe('blocked_policy');
    expect(policyGate).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('刷新后恢复同一已批准调用时不重复审批但仍经过执行器', async () => {
    const { tool, invoke } = makeTool('confirmTool');
    const policyGate = vi.fn(async () => ({ allowed: false, reason: '不应再次审批' }));
    const executor = createUnifiedToolExecutor({
      getTool: () => tool,
      getPolicyGate: () => policyGate,
    });
    const outcome = await executor.invoke({
      toolName: 'confirmTool',
      args: {},
      source: 'agent',
      callId: 'approved-call',
      approvalAlreadyGranted: true,
    });
    expect(outcome.status).toBe('ok');
    expect(policyGate).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
