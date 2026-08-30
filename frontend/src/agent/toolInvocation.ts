import type { CottageTool } from '@/agent/runtime/tool';
import type { ZodTypeAny } from 'zod';
import type { PolicyGate } from '../platform/policy';
import { evaluateToolPolicy } from '../platform/policy/policyEngine';
import type { PlanGate, PlanSession } from '../platform/plan';
import { recordPlanToolOutcome } from '../platform/plan';
import { DOOM_LOOP_TOOL_NAME, type DoomLoopDetector } from './doomLoop';
import type { TraceRecorder, TraceToolStatus } from '../platform/trace';
import { stripCottageImages, stripWriteSnapshot } from './cottageTools';
import type { PlanGuardVerdict, PlanToolGuard } from '../plan/scopeGate';
import {
  abortMutationJournal,
  beginMutationJournal,
  endMutationJournal,
} from '../plan/mutationJournal';
import { capturePlanStepPaths } from '../plan/checkpoints';
import type { ToolMutationReport } from '../plan/types';
import {
  workspaceWriteCoordinator,
  type WorkspaceWriteLease,
} from '../plan/workspaceLock';
import { toolRisk } from './toolDescriptions';
import { toolNameIn } from './toolNames';
import { workspace } from '../workspace/FileSystemWorkspace';

/**
 * 统一工具调用执行器：agent / script / manual 三类来源共用同一管线，
 * 按来源配置治理强度（黑名单、重复指纹、doom loop、计划闸门、审批、trace）。
 * 执行器只做「闸门判定 + 执行 + 结构化 outcome + trace」；
 * UI section、runtime tool result、附件注入、diff 卡片留在调用方。
 * 设计文档：docs/tool-invocation-design.md
 */

export type ToolInvocationSource = 'agent' | 'script' | 'manual';

export interface ApprovedPlanContext {
  planId: string;
  approvedRevision: number;
  stepId?: string;
  allowedPathPrefixes: string[];
}

/**
 * 脚本 / 手工调用中禁止的工具：runScript 自身（防递归开 Worker）与
 * 交互 / 流程控制类工具（需要用户参与或改变回合流程，不适合静默执行）。
 */
export const BLOCKED_SCRIPT_TOOL_NAMES = new Set<string>([
  'runScript',
  'askUser',
  'loadTools',
  'submitExecutionPlan',
  'suggestSpec',
  'submitSpec',
  'specUpdateTask',
  'specComplete',
  'specFail',
  'suggestPlanMode',
  'submitPlan',
  'completePlanStep',
  'blockPlanStep',
  'requestPlanRevision',
  'completePlanRun',
  'failPlanRun',
  'dispatchPlanResearch',
  'taskSetPlan',
  'taskComplete',
  'taskFail',
  'taskHandoff',
  'dispatchSubtask',
]);

export interface ToolInvocationRequest {
  toolName: string;
  args: unknown;
  source: ToolInvocationSource;
  planContext?: ApprovedPlanContext;
  /** 缺省生成 `${source}:${uuid}` */
  callId?: string;
  signal?: AbortSignal;
  /** agent 轮次；script/manual 为 0 */
  round?: number;
  /** script：宿主 runScript 的 callId（重复指纹计次作用域 + trace 归属） */
  parentCallId?: string;
  /** 仅用于页面刷新后恢复已经持久化为 approved 的同一审批调用。 */
  approvalAlreadyGranted?: boolean;
  onAwaitingApproval?: (request: {
    message: string;
    toolName: string;
    args: unknown;
    callId: string;
    approvalKind?: 'policy' | 'doom_loop';
  }) => void;
}

export interface ToolInvocationOutcome {
  callId: string;
  status: TraceToolStatus;
  rawOutput?: unknown;
  /** 阻断/错误原因沿用「⛔/📋/🔁」文案 */
  resultText: string;
  imagePaths: string[];
  snapshot?: { before: string; after: string; created?: boolean };
  mutations?: ToolMutationReport;
  durationMs: number;
}

export interface SourceGovernancePolicy {
  blockedToolNames?: ReadonlySet<string>;
  /** 相同工具+相同参数上限；0 = 不启用 */
  maxIdenticalCalls: number;
  planGate: boolean;
  /** gate = 挂审批等待；auto-allow = confirm 放行、deny 仍拦 */
  policyApproval: 'gate' | 'auto-allow';
  doomLoop: 'off' | 'record-only' | 'full';
  trace: boolean;
}

export const DEFAULT_SOURCE_POLICIES: Record<
  ToolInvocationSource,
  SourceGovernancePolicy
> = {
  agent: {
    maxIdenticalCalls: 2,
    planGate: true,
    policyApproval: 'gate',
    doomLoop: 'full',
    trace: true,
  },
  script: {
    blockedToolNames: BLOCKED_SCRIPT_TOOL_NAMES,
    maxIdenticalCalls: 5,
    planGate: true,
    // 前提：宿主 runScript 已经统一审批（含脚本内高危子调用一并授权）
    policyApproval: 'auto-allow',
    doomLoop: 'record-only',
    trace: true,
  },
  manual: {
    blockedToolNames: BLOCKED_SCRIPT_TOOL_NAMES,
    maxIdenticalCalls: 0,
    planGate: false,
    // destructive 的二次确认由 UI（DebugPanel）负责
    policyApproval: 'auto-allow',
    doomLoop: 'off',
    trace: true,
  },
};

/** 工具目录分组：已挂载 agent 工具 / 延后目录（手工调用无需 loadTools 激活）/ MCP 外部工具 */
export type ToolCatalogGroup = 'mounted' | 'deferred' | 'mcp';

export interface ToolCatalogEntry {
  name: string;
  description: string;
  group: ToolCatalogGroup;
  /** zod schema：供手工调用 UI 做参数预校验与骨架预填（展示时转 JSON Schema） */
  schema?: ZodTypeAny;
}

export interface CreateToolExecutorOptions {
  getTool: (name: string) => CottageTool | undefined;
  getPolicyGate?: () => PolicyGate | undefined;
  getPlanGate?: () => PlanGate | undefined;
  getPlanSession?: () => PlanSession | undefined;
  /** 统一 Plan Mode 路径范围、预算与步骤检查点闸门。 */
  getPlanToolGuard?: () => PlanToolGuard | undefined;
  getDoomLoopDetector?: () => DoomLoopDetector | undefined;
  getTraceRecorder?: () => TraceRecorder | null;
  sessionId?: string | null;
  /** 供手工调用 UI 枚举可调用工具（阶段 2 使用） */
  listTools?: () => ToolCatalogEntry[];
  policyOverrides?: Partial<
    Record<ToolInvocationSource, Partial<SourceGovernancePolicy>>
  >;
}

export interface UnifiedToolExecutor {
  invoke: (req: ToolInvocationRequest) => Promise<ToolInvocationOutcome>;
  listTools: () => ToolCatalogEntry[];
}

/** 手工调用结果原样展示的上限 */
const MANUAL_RESULT_MAX_CHARS = 64 * 1024;
/** trace resultSnippet 截断上限 */
const TRACE_RESULT_SNIPPET_MAX = 8000;
/** 重复指纹作用域（每次脚本运行一个）保留上限，超出按先进先出淘汰 */
const MAX_DUPLICATE_SCOPES = 64;

/** 永不 abort 的占位 signal（PolicyGate 要求必传） */
const neverAbortSignal = (): AbortSignal => new AbortController().signal;

/**
 * 净化脚本侧工具输出使其可结构化克隆回 Worker：
 * 剥离 before/after 写入快照后做 JSON round-trip（cottageImages 已由管线剥离）。
 */
export const sanitizeScriptToolOutput = (output: unknown): unknown => {
  let value = output;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (
      typeof record.before === 'string' &&
      typeof record.after === 'string'
    ) {
      const rest = { ...record };
      delete rest.before;
      delete rest.after;
      value = rest;
    }
  }
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return String(value);
  }
};

const SOURCE_LABEL: Record<ToolInvocationSource, string> = {
  agent: 'agent 回合',
  script: '脚本',
  manual: '手工调用',
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';

export const createUnifiedToolExecutor = (
  options: CreateToolExecutorOptions,
): UnifiedToolExecutor => {
  const resolvePolicy = (
    source: ToolInvocationSource,
  ): SourceGovernancePolicy => {
    const resolved: SourceGovernancePolicy = {
      ...DEFAULT_SOURCE_POLICIES[source],
      ...options.policyOverrides?.[source],
    };
    // Plan Mode 中脚本子调用和调试面板手工调用都逐项经过当前 PolicyGate，
    // 删除、移动、外部副作用不能借来源差异绕过单独确认。
    if ((source === 'script' || source === 'manual') && options.getPlanToolGuard?.()) {
      resolved.policyApproval = 'gate';
    }
    return resolved;
  };

  /** 重复指纹计次：按 parentCallId（每次脚本运行）隔离作用域 */
  const duplicateScopes = new Map<string, Map<string, number>>();
  const bumpDuplicateCount = (scope: string, fingerprint: string): number => {
    let counts = duplicateScopes.get(scope);
    if (!counts) {
      if (duplicateScopes.size >= MAX_DUPLICATE_SCOPES) {
        const oldest = duplicateScopes.keys().next().value;
        if (oldest !== undefined) duplicateScopes.delete(oldest);
      }
      counts = new Map();
      duplicateScopes.set(scope, counts);
    }
    const next = (counts.get(fingerprint) ?? 0) + 1;
    counts.set(fingerprint, next);
    return next;
  };

  const invoke = async (
    req: ToolInvocationRequest,
  ): Promise<ToolInvocationOutcome> => {
    const policy = resolvePolicy(req.source);
    const callId = req.callId ?? `${req.source}:${crypto.randomUUID()}`;
    const startedAt = Date.now();
    const args = (
      req.args && typeof req.args === 'object' ? req.args : {}
    ) as Record<string, unknown>;

    const finish = (partial: {
      status: TraceToolStatus;
      resultText: string;
      rawOutput?: unknown;
      imagePaths?: string[];
      snapshot?: { before: string; after: string; created?: boolean };
      mutations?: ToolMutationReport;
    }): ToolInvocationOutcome => {
      const outcome: ToolInvocationOutcome = {
        callId,
        status: partial.status,
        rawOutput: partial.rawOutput,
        resultText: partial.resultText,
        imagePaths: partial.imagePaths ?? [],
        snapshot: partial.snapshot,
        mutations: partial.mutations,
        durationMs: Date.now() - startedAt,
      };
      if (policy.trace) {
        const recorder = options.getTraceRecorder?.();
        recorder?.append({
          type: 'tool_call',
          at: startedAt,
          id: callId,
          round: req.round ?? 0,
          name: req.toolName,
          args: req.args,
          status: outcome.status,
          resultSnippet: outcome.resultText.slice(0, TRACE_RESULT_SNIPPET_MAX),
          ...(outcome.snapshot
            ? {
                before: outcome.snapshot.before,
                after: outcome.snapshot.after,
                created: outcome.snapshot.created,
              }
            : {}),
          durationMs: outcome.durationMs,
          source: req.source,
          ...(req.parentCallId ? { parentCallId: req.parentCallId } : {}),
        });
      }
      return outcome;
    };

    if (typeof req.toolName !== 'string' || !req.toolName.trim()) {
      return finish({ status: 'unknown_tool', resultText: '⛔ 工具名不能为空' });
    }

    // 黑名单匹配走归一化：模型可能输出 snake_case / 大小写变体，精确匹配会被绕过
    // （而 getToolByName 能归一化解析到真实工具并执行）。
    if (
      policy.blockedToolNames &&
      toolNameIn(policy.blockedToolNames, req.toolName)
    ) {
      return finish({
        status: 'blocked_policy',
        resultText: `⛔ ${req.toolName} 不可在${SOURCE_LABEL[req.source]}中调用（交互 / 流程控制类工具或 runScript 自身）`,
      });
    }

    const tool = options.getTool(req.toolName);
    if (!tool) {
      return finish({
        status: 'unknown_tool',
        resultText: `⛔ cottage.${req.toolName} 不存在：未知的 agent 工具`,
      });
    }

    if (req.signal?.aborted) {
      return finish({ status: 'aborted', resultText: '⛔ 已停止' });
    }

    const detector = options.getDoomLoopDetector?.();
    let planGuardVerdict: PlanGuardVerdict | undefined;
    let loopRetryApproved = false;

    const requestLoopRetryApproval = async (input: {
      reason: string;
      pattern: string;
    }): Promise<{ allowed: boolean; reason?: string }> => {
      const policyGate = options.getPolicyGate?.();
      if (!policyGate || !req.onAwaitingApproval) {
        return {
          allowed: false,
          reason: '检测到重复调用，但当前调用来源无法向用户发起确认',
        };
      }
      return policyGate({
        toolName: DOOM_LOOP_TOOL_NAME,
        args: {
          reason: input.reason,
          pattern: input.pattern,
          targetTool: req.toolName,
        },
        callId,
        signal: req.signal ?? neverAbortSignal(),
        onAwaitingApproval: ({ message }) =>
          req.onAwaitingApproval?.({
            message,
            toolName: req.toolName,
            args: req.args,
            callId,
            approvalKind: 'doom_loop',
          }),
      });
    };

    // 重复指纹：agent 可见调用超过来源上限后先询问用户，不再直接拦截。
    if (policy.maxIdenticalCalls > 0) {
      const scope = req.parentCallId ?? `${req.source}:session`;
      const fingerprint = `${req.toolName}:${JSON.stringify(args)}`;
      const attempt = bumpDuplicateCount(scope, fingerprint);
      if (attempt > policy.maxIdenticalCalls) {
        try {
          const verdict = await requestLoopRetryApproval({
            reason: `同工具同参数已调用 ${attempt} 次`,
            pattern: `${req.toolName} · ${JSON.stringify(args).slice(0, 120)}`,
          });
          if (!verdict.allowed) {
            detector?.record({ name: req.toolName, args, status: 'blocked' });
            return finish({
              status: 'duplicate',
              resultText: `🔁 用户未允许再次执行「${req.toolName}」：${verdict.reason ?? '已拒绝重复调用'}`,
            });
          }
          loopRetryApproved = true;
        } catch (error) {
          if (req.signal?.aborted) {
            return finish({ status: 'aborted', resultText: '⛔ 已停止' });
          }
          return finish({
            status: 'duplicate',
            resultText: `🔁 重复调用确认失败：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }

    // doom loop：full 先 check 再执行；record-only 只在执行后写入共享 detector
    if (detector && policy.doomLoop === 'full' && !loopRetryApproved) {
      const pattern = detector.check({ name: req.toolName, args });
      if (pattern) {
        try {
          const verdict = await requestLoopRetryApproval(pattern);
          if (!verdict.allowed) {
            detector.record({ name: req.toolName, args, status: 'blocked' });
            return finish({
              status: 'doom_loop',
              resultText: `🔁 用户未允许再次执行「${req.toolName}」：${verdict.reason ?? pattern.reason}`,
            });
          }
          loopRetryApproved = true;
        } catch (error) {
          if (req.signal?.aborted) {
            return finish({ status: 'aborted', resultText: '⛔ 已停止' });
          }
          return finish({
            status: 'doom_loop',
            resultText: `🔁 循环调用确认失败：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }

    const planToolGuard = options.getPlanToolGuard?.();
    if (planToolGuard) {
      planGuardVerdict = planToolGuard.check({
        toolName: req.toolName,
        args,
        source: req.source,
      });
      if (!planGuardVerdict.allowed) {
        await planToolGuard.block(planGuardVerdict);
        return finish({
          status: 'blocked_plan',
          resultText: `📋 计划范围：${planGuardVerdict.reason ?? '该操作未被批准'}`,
        });
      }
    }

    // 计划闸门：纯计数判定；成功后由 recordPlanToolOutcome 记账
    if (policy.planGate) {
      const planGate = options.getPlanGate?.();
      if (planGate) {
        const verdict = planGate({
          toolName: req.toolName,
          toolRound: req.round ?? 0,
          args,
        });
        if (!verdict.allowed) {
          const reason = verdict.reason ?? '该操作被计划闸门阻止';
          const planSession = options.getPlanSession?.();
          if (planSession) planSession.lastBlockedReason = reason;
          return finish({
            status: 'blocked_plan',
            resultText: `📋 计划闸门：${reason}`,
          });
        }
      }
    }

    // 策略审批：gate 挂审批等待；auto-allow 下 confirm 放行、deny 仍拦
    const restoredAgentApproval =
      req.source === 'agent' && req.approvalAlreadyGranted === true;
    if (policy.policyApproval === 'gate' && !restoredAgentApproval) {
      const policyGate = options.getPolicyGate?.();
      if (policyGate) {
        try {
          const verdict = await policyGate({
            toolName: req.toolName,
            args,
            callId,
            signal: req.signal ?? neverAbortSignal(),
            onAwaitingApproval: ({ message }) =>
              req.onAwaitingApproval?.({
                message,
                toolName: req.toolName,
                args: req.args,
                callId,
              }),
          });
          if (!verdict.allowed) {
            return finish({
              status: 'blocked_policy',
              resultText: `⛔ 操作被安全策略阻止：${verdict.reason ?? '用户拒绝了该操作'}。如需继续请向用户说明，或者改用低风险方式。`,
            });
          }
        } catch (error) {
          if (req.signal?.aborted) {
            return finish({ status: 'aborted', resultText: '⛔ 已停止' });
          }
          return finish({
            status: 'blocked_policy',
            resultText: `⛔ 审批闸门异常：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    } else {
      const decision = evaluateToolPolicy(
        req.toolName,
        { requireApprovalFor: [] },
        args,
      );
      if (decision.action === 'deny') {
        return finish({
          status: 'blocked_policy',
          resultText: `⛔ 操作被安全策略阻止：${decision.reason}。`,
        });
      }
    }

    if (req.signal?.aborted) {
      return finish({ status: 'aborted', resultText: '⛔ 已停止' });
    }

    let executorLease: WorkspaceWriteLease | null = null;
    const invocationRisk = toolRisk(req.toolName);
    if (
      !planToolGuard &&
      (invocationRisk === 'write' || invocationRisk === 'destructive')
    ) {
      executorLease = await workspaceWriteCoordinator.acquire(
        workspace.rootName ?? 'workspace',
        planGuardVerdict?.planId ?? `session:${options.sessionId ?? 'unknown'}`,
      );
      if (!executorLease) {
        return finish({
          status: 'blocked_policy',
          resultText: '无法获得工作区排他锁，写入未执行',
        });
      }
    }

    if (planToolGuard && planGuardVerdict) {
      try {
        await planToolGuard.beforeExecute(planGuardVerdict);
      } catch (error) {
        return finish({
          status: 'blocked_plan',
          resultText: `📋 计划检查点：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    let journalStarted = false;
    let mutationReport: ToolMutationReport | undefined;
    if (
      planGuardVerdict?.mutationScopePrefixes?.length &&
      planGuardVerdict.risk !== 'read' &&
      planGuardVerdict.risk !== 'control'
    ) {
      try {
        beginMutationJournal({
          allowedPathPrefixes: planGuardVerdict.mutationScopePrefixes,
          onBeforePath: async (path) => {
            if (planGuardVerdict?.planId && planGuardVerdict.stepId) {
              await capturePlanStepPaths(
                planGuardVerdict.planId,
                planGuardVerdict.stepId,
                [path],
              );
            }
          },
        });
        journalStarted = true;
      } catch (error) {
        await planToolGuard?.afterExecute(planGuardVerdict, false).catch(() => undefined);
        return finish({
          status: 'blocked_plan',
          resultText: error instanceof Error ? error.message : String(error),
        });
      }
    }

    try {
      const output = await tool.invoke(
        args,
        req.signal ? { signal: req.signal } : undefined,
      );
      const { output: outputSansImages, imagePaths } =
        stripCottageImages(output);
      const { resultText, snapshot } = stripWriteSnapshot(outputSansImages);
      if (journalStarted) {
        mutationReport = await endMutationJournal();
        journalStarted = false;
      }
      if (planToolGuard && planGuardVerdict) {
        await planToolGuard.afterExecute(
          planGuardVerdict,
          true,
          mutationReport ?? { created: [], modified: [], deleted: [], moved: [] },
        );
      }
      if (policy.planGate) {
        const planSession = options.getPlanSession?.();
        if (planSession) recordPlanToolOutcome(planSession, req.toolName);
      }
      if (detector && policy.doomLoop !== 'off') {
        detector.record({ name: req.toolName, args, status: 'ok' });
      }
      const rawOutput =
        req.source === 'script'
          ? sanitizeScriptToolOutput(outputSansImages)
          : output;
      const cappedResultText =
        req.source === 'manual' && resultText.length > MANUAL_RESULT_MAX_CHARS
          ? `${resultText.slice(0, MANUAL_RESULT_MAX_CHARS)}\n…（结果过长已截断）`
          : resultText;
      executorLease?.release();
      return finish({
        status: 'ok',
        rawOutput,
        resultText: cappedResultText,
        imagePaths,
        snapshot: snapshot ?? undefined,
        mutations: mutationReport,
      });
    } catch (error) {
      let journalFinalizeFailed = false;
      if (journalStarted) {
        try {
          mutationReport = await endMutationJournal();
        } catch {
          journalFinalizeFailed = true;
          abortMutationJournal();
        }
        journalStarted = false;
      } else if (planGuardVerdict?.mutationScopePrefixes?.length) {
        abortMutationJournal();
      }
      if (planToolGuard && planGuardVerdict) {
        await planToolGuard
          .afterExecute(planGuardVerdict, false, mutationReport)
          .catch(() => undefined);
        if (journalFinalizeFailed) {
          await planToolGuard.block({
            ...planGuardVerdict,
            allowed: false,
            reason: '工具可能已修改工作区，但写入后回读或 SHA-256 核对失败；已暂停等待恢复',
          }).catch(() => undefined);
        }
      }
      executorLease?.release();
      const aborted = req.signal?.aborted || isAbortError(error);
      if (!aborted && detector && policy.doomLoop !== 'off') {
        detector.record({ name: req.toolName, args, status: 'error' });
      }
      if (aborted) {
        return finish({ status: 'aborted', resultText: '⛔ 已停止' });
      }
      return finish({
        status: 'error',
        resultText: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return {
    invoke,
    listTools: () => options.listTools?.() ?? [],
  };
};
