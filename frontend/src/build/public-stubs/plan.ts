import type { CottageTool } from '@/agent/runtime/tool';
import { isAskUserTool } from '@/agent/toolNames';
import { getCapabilityRegistry } from '../../platform/capabilities/registry';
import type { CapabilityRiskLevel } from '../../platform/capabilities/types';
import { interactionRevision } from '../../platform/interaction/interactionScope';
import type {
  ExecutionPlan,
  PlanBudget,
  PlanGate,
  PlanSessionCounters,
} from '../../platform/plan/types';

export type PlanApprovalDecision = 'approved' | 'adjust' | 'cancel';

export const pendingPlanApprovalRevision = interactionRevision;

export const getPendingPlanApproval = (): null => null;
export const resolvePendingPlanApproval = (): void => {};
export const hasPendingPlanApprovalFor = (_sessionId: string): boolean => false;
export const cancelPendingPlanApproval = (): void => {};
export const recordPlanToolOutcome = (): void => {};

export class PlanSession {
  plan: ExecutionPlan | null = null;
  lastBlockedReason?: string;
  readonly counters: PlanSessionCounters = {
    files: 0,
    apiCalls: 0,
    turns: 0,
    microEditTokens: 0,
  };

  reset(): void {
    this.plan = null;
    this.lastBlockedReason = undefined;
  }

  submit(plan: ExecutionPlan): void {
    this.plan = plan;
  }

  effectiveBudget(fallback?: PlanBudget): PlanBudget {
    return fallback ?? {};
  }

  isOverBudget(): boolean {
    return false;
  }
}

export const createPlanGate = (): PlanGate | null => null;

export const createSubmitPlanTool = (): CottageTool => {
  throw new Error('当前构建未包含 Plan Gate');
};

export const SUBMIT_PLAN_TOOL_NAME = 'submitExecutionPlan';

export const isPlanExemptTool = (toolName: string): boolean =>
  toolName === SUBMIT_PLAN_TOOL_NAME ||
  isAskUserTool(toolName) ||
  toolName.startsWith('task') ||
  toolName.startsWith('orch');

export const getToolRiskLevel = (
  toolName: string,
): CapabilityRiskLevel | null => {
  const capabilities = getCapabilityRegistry().findByToolName(toolName);
  if (!capabilities.length) return null;
  const order: CapabilityRiskLevel[] = [
    'read',
    'write',
    'external',
    'destructive',
  ];
  return capabilities.reduce<CapabilityRiskLevel>(
    (highest, capability) =>
      order.indexOf(capability.riskLevel) >= order.indexOf(highest)
        ? capability.riskLevel
        : highest,
    'read',
  );
};

