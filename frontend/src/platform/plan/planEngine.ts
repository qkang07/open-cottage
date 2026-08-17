import { getCapabilityRegistry } from '../capabilities/registry';
import type { Capability, CapabilityRiskLevel } from '../capabilities/types';
import { isAskUserTool } from '../../agent/toolNames';
import type { PlanSession } from './planSession';
import type {
  PlanBudget,
  PlanGateInput,
  PlanGateVerdict,
} from './types';

const RISK_ORDER: CapabilityRiskLevel[] = [
  'read',
  'write',
  'external',
  'destructive',
];

const riskRank = (level: CapabilityRiskLevel): number =>
  RISK_ORDER.indexOf(level);

const highestRisk = (caps: Capability[]): Capability | null =>
  caps.reduce<Capability | null>((acc, cap) => {
    if (!acc) return cap;
    return riskRank(cap.riskLevel) >= riskRank(acc.riskLevel) ? cap : acc;
  }, null);

export const SUBMIT_PLAN_TOOL_NAME = 'submitExecutionPlan';

const EXEMPT_TOOL_PREFIXES = ['task', 'orch'];

export const isPlanExemptTool = (toolName: string): boolean => {
  if (toolName === SUBMIT_PLAN_TOOL_NAME || isAskUserTool(toolName)) return true;
  return EXEMPT_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix));
};

export const getToolRiskLevel = (
  toolName: string,
): CapabilityRiskLevel | null => {
  const caps = getCapabilityRegistry().findByToolName(toolName);
  if (!caps.length) return null;
  return highestRisk(caps)?.riskLevel ?? null;
};

export const requiresPlanForRisk = (
  risk: CapabilityRiskLevel | null,
  requirePlanFor: readonly CapabilityRiskLevel[],
): boolean => {
  if (!risk) return false;
  return requirePlanFor.includes(risk);
};

const withinBudget = (
  value: number,
  limit: number | undefined,
): boolean => limit === undefined || value <= limit;

const APPROX_CHARS_PER_TOKEN = 4;

/**
 * 估算 write 级工具的改动 token 数。返回 Infinity 表示该工具不纳入微改豁免。
 * editFile/patchFile 按改动载荷估算，writeFile/createFile 按内容长度估算。
 */
export const estimateWriteTokens = (
  toolName: string,
  args: Record<string, unknown> | undefined,
): number => {
  if (!args) return Infinity;
  switch (toolName) {
    case 'editFile': {
      const edits = Array.isArray(args.edits) ? args.edits : [];
      const chars = edits.reduce((sum, edit) => {
        const obj = edit as Record<string, unknown> | null;
        const search = typeof obj?.search === 'string' ? obj.search.length : 0;
        const replace = typeof obj?.replace === 'string' ? obj.replace.length : 0;
        return sum + search + replace;
      }, 0);
      return Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
    }
    case 'writeFile':
    case 'createFile':
    case 'appendFile': {
      const content = typeof args.content === 'string' ? args.content : '';
      return Math.ceil(content.length / APPROX_CHARS_PER_TOKEN);
    }
    case 'patchFile': {
      const { path: _path, ...rest } = args;
      return Math.ceil(JSON.stringify(rest).length / APPROX_CHARS_PER_TOKEN);
    }
    case 'applyPatch': {
      const patch = typeof args.patch === 'string' ? args.patch : '';
      return Math.ceil(patch.length / APPROX_CHARS_PER_TOKEN);
    }
    case 'touch':
      return 1;
    default:
      return Infinity;
  }
};

export interface EvaluatePlanGateContext {
  requirePlanFor: readonly CapabilityRiskLevel[];
  defaultBudget?: PlanBudget;
  microEditExempt?: boolean;
  microEditMaxTokens?: number;
}

export const evaluatePlanGate = (
  session: PlanSession,
  input: PlanGateInput,
  ctx: EvaluatePlanGateContext,
): PlanGateVerdict => {
  const { toolName } = input;
  if (isPlanExemptTool(toolName)) return { allowed: true };

  const risk = getToolRiskLevel(toolName);
  if (!requiresPlanForRisk(risk, ctx.requirePlanFor)) return { allowed: true };

  if (!session.plan) {
    // 微改豁免：write 级工具在无计划时，若累计改动量低于阈值则直接放行
    if (ctx.microEditExempt && risk === 'write') {
      const estimated = estimateWriteTokens(toolName, input.args);
      if (
        estimated !== Infinity &&
        ctx.microEditMaxTokens !== undefined &&
        session.counters.microEditTokens + estimated <= ctx.microEditMaxTokens
      ) {
        session.counters.microEditTokens += estimated;
        return { allowed: true };
      }
    }
    return {
      allowed: false,
      reason:
        '执行写入、外部访问或破坏性操作前，须先调用 submitExecutionPlan 提交执行计划。',
    };
  }

  const budget = session.effectiveBudget(ctx.defaultBudget);

  if (!withinBudget(session.counters.turns, budget.maxTurns)) {
    return {
      allowed: false,
      reason: `已超过计划预算：最多 ${budget.maxTurns} 轮工具调用。请缩小范围或重新提交计划。`,
    };
  }

  if (
    risk === 'external' &&
    !withinBudget(session.counters.apiCalls + 1, budget.maxApiCalls)
  ) {
    return {
      allowed: false,
      reason: `已超过计划预算：最多 ${budget.maxApiCalls} 次外部访问。`,
    };
  }

  if (
    (risk === 'write' || risk === 'destructive') &&
    !withinBudget(session.counters.files + 1, budget.maxFiles)
  ) {
    return {
      allowed: false,
      reason: `已超过计划预算：最多 ${budget.maxFiles} 次文件写入/修改。`,
    };
  }

  return { allowed: true };
};

export const recordPlanToolOutcome = (
  session: PlanSession,
  toolName: string,
): void => {
  if (isPlanExemptTool(toolName)) return;
  // runScript 防双计：脚本内 cottage.* 子调用已各自经统一执行器计数，
  // 宿主 runScript 自身不再计入 files 预算
  if (toolName === 'runScript') return;
  // 无计划时（微改豁免路径）不计入计划预算计数
  if (!session.plan) return;
  const risk = getToolRiskLevel(toolName);
  if (risk === 'external') session.counters.apiCalls += 1;
  if (risk === 'write' || risk === 'destructive') session.counters.files += 1;
};
