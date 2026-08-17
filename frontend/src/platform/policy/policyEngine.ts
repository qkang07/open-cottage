import { toolLocaleAlias } from '../../agent/toolDescriptions';
import { getCapabilityRegistry } from '../capabilities/registry';
import type { Capability, CapabilityRiskLevel } from '../capabilities/types';
import type { PolicyDecision } from './types';

const RISK_ORDER: CapabilityRiskLevel[] = [
  'read',
  'write',
  'external',
  'destructive',
];

export const RISK_LABEL: Record<CapabilityRiskLevel, string> = {
  read: '只读',
  write: '写入',
  external: '外部访问',
  destructive: '破坏性',
};

const riskRank = (level: CapabilityRiskLevel): number =>
  RISK_ORDER.indexOf(level);

const highestRisk = (caps: Capability[]): Capability | null =>
  caps.reduce<Capability | null>((acc, cap) => {
    if (!acc) return cap;
    return riskRank(cap.riskLevel) >= riskRank(acc.riskLevel) ? cap : acc;
  }, null);

export interface PolicyEvaluationContext {
  /** 需要用户审批的风险级别集合 */
  requireApprovalFor: readonly CapabilityRiskLevel[];
}

/**
 * dryRun 预检豁免（逐工具 opt-in）：登记工具在 dryRun 预检分支下为只读
 * （不写盘、无副作用），预检审批只增加摩擦、不增加安全，直接放行。
 * 豁免依据是工具实现内部的只读保证，须逐工具核实后才能登记，
 * 不得泛化为「凡参数含 dryRun 的工具一律豁免」。
 */
const DRY_RUN_EXEMPT_PREDICATES: Record<
  string,
  (args: Record<string, unknown>) => boolean
> = {
  // dryRun=true 只跑 validatePlan（存在性/冲突/保护区预检），不落盘
  applyTidyPlan: (args) => args.dryRun === true,
  // 仅 dryRun===false 落盘；缺省/true 只在 Worker 中计算 diff
  astEdit: (args) => args.dryRun !== false,
};

/**
 * 评估单个工具调用的策略决定。
 * 未在能力目录登记的工具（如 askUser、task 系列、orch 系列）默认放行。
 */
export const evaluateToolPolicy = (
  toolName: string,
  ctx: PolicyEvaluationContext,
  args?: unknown,
): PolicyDecision => {
  if (toolName === 'doom_loop') {
    return {
      action: 'confirm',
      riskLevel: 'destructive',
      message:
        '检测到助手可能陷入工具调用循环（同一工具反复用相同参数，或连续失败）。\n\n允许：再执行一次该工具。\n拒绝：跳过这次调用，让助手换思路。',
    };
  }

  const dryRunExempt = DRY_RUN_EXEMPT_PREDICATES[toolName];
  if (
    dryRunExempt &&
    args &&
    typeof args === 'object' &&
    !Array.isArray(args) &&
    dryRunExempt(args as Record<string, unknown>)
  ) {
    return { action: 'allow' };
  }

  // applyPatch 通常是普通写入，但 unified diff 也可删除文件；删除必须逐次确认。
  if (
    toolName === 'applyPatch' &&
    args &&
    typeof args === 'object' &&
    !Array.isArray(args)
  ) {
    const patch = (args as Record<string, unknown>).patch;
    if (typeof patch === 'string' && /^\+\+\+\s+\/dev\/null\s*$/m.test(patch)) {
      return {
        action: 'confirm',
        riskLevel: 'destructive',
        message: '该 unified diff 包含文件删除。删除不会因计划路径授权而自动执行，是否继续？',
      };
    }
  }

  // 生图按张计费：n>1 强制确认（不论治理策略是否勾选 external）
  if (
    (toolName === 'generateImage' || toolName === 'editImage') &&
    args &&
    typeof args === 'object' &&
    !Array.isArray(args)
  ) {
    const n = Number((args as Record<string, unknown>).n);
    if (Number.isFinite(n) && n > 1) {
      return {
        action: 'confirm',
        riskLevel: 'external',
        message: `即将生成 ${Math.floor(n)} 张图片（按张计费，费用由当前生图厂商 API Key 承担）。是否继续？`,
      };
    }
  }

  const caps = getCapabilityRegistry().findByToolName(toolName);
  if (!caps.length) return { action: 'allow' };

  const top = highestRisk(caps);
  if (!top) return { action: 'allow' };

  const needsApproval =
    caps.some((c) => c.requiresApproval) ||
    ctx.requireApprovalFor.includes(top.riskLevel);

  if (!needsApproval) return { action: 'allow' };

  // runScript 统一审批：脚本内可经 cottage.* 调用 agent 工具（含高危工具），
  // 本次批准对脚本内的 confirm 级子调用一并授权（deny 仍拦截）
  if (toolName === 'runScript') {
    return {
      action: 'confirm',
      riskLevel: top.riskLevel,
      message:
        '即将执行 runScript 脚本。脚本内可经 cottage.* 调用 agent 工具（含写入 / 删除等高危工具），本次批准对脚本内的工具调用一并授权。\n\n是否允许执行？',
    };
  }

  return {
    action: 'confirm',
    riskLevel: top.riskLevel,
    message: `工具「${toolLocaleAlias(toolName)}」属于「${RISK_LABEL[top.riskLevel]}」级操作，是否允许执行？`,
  };
};
