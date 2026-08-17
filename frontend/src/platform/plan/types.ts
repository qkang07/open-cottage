import type { CapabilityRiskLevel } from '../capabilities/types';

export interface PlanBudget {
  maxFiles?: number;
  maxApiCalls?: number;
  maxTurns?: number;
}

export interface ExecutionPlanItem {
  requirement: string;
  actions?: string[];
  confidence?: number;
}

export interface ExecutionPlan {
  goal: string;
  domain?: string;
  items: ExecutionPlanItem[];
  budget?: PlanBudget;
  submittedAt: number;
}

export interface PlanSessionCounters {
  files: number;
  apiCalls: number;
  turns: number;
  /** 本回合内经微改豁免放行的累计改动 token 估算 */
  microEditTokens: number;
}

export interface PlanGateVerdict {
  allowed: boolean;
  reason?: string;
}

export interface PlanGateInput {
  toolName: string;
  toolRound: number;
  /** 工具调用参数，用于微改豁免的改动量估算 */
  args?: Record<string, unknown>;
}

export type PlanGate = (input: PlanGateInput) => PlanGateVerdict;

export interface PlanGateConfig {
  enabled?: boolean;
  /** 须先提交计划才可执行的风险级别，默认 write / external / destructive */
  requirePlanFor?: CapabilityRiskLevel[];
  defaultBudget?: PlanBudget;
  /** 提交计划后须用户在 UI 批准才放行后续工具，默认 true */
  requireApproval?: boolean;
  /** 小改动豁免：write 级工具在无计划时若累计改动量低于阈值则直接放行 */
  microEditExempt?: boolean;
  /** 微改豁免的累计 token 上限（按字符数/4 粗估），默认 256 */
  microEditMaxTokens?: number;
}
