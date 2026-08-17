import type { CapabilityRiskLevel } from '../capabilities/types';
import {
  evaluatePlanGate,
  recordPlanToolOutcome,
} from './planEngine';
import type { PlanSession } from './planSession';
import type { PlanBudget, PlanGate } from './types';

export interface CreatePlanGateOptions {
  enabled?: boolean;
  requirePlanFor?: readonly CapabilityRiskLevel[];
  defaultBudget?: PlanBudget;
  microEditExempt?: boolean;
  microEditMaxTokens?: number;
}

const DEFAULT_REQUIRE_PLAN_FOR: CapabilityRiskLevel[] = [
  'write',
  'external',
  'destructive',
];

const DEFAULT_BUDGET: PlanBudget = {
  maxFiles: 20,
  maxApiCalls: 10,
  maxTurns: 25,
};

const DEFAULT_MICRO_EDIT_MAX_TOKENS = 256;

export const createPlanGate = (
  session: PlanSession,
  options: CreatePlanGateOptions,
): PlanGate | null => {
  if (options.enabled === false) return null;

  const requirePlanFor = options.requirePlanFor ?? DEFAULT_REQUIRE_PLAN_FOR;
  const defaultBudget = {
    ...DEFAULT_BUDGET,
    ...options.defaultBudget,
  };
  const microEditExempt = options.microEditExempt;
  const microEditMaxTokens =
    options.microEditMaxTokens ?? DEFAULT_MICRO_EDIT_MAX_TOKENS;

  return (input) =>
    evaluatePlanGate(session, input, {
      requirePlanFor,
      defaultBudget,
      microEditExempt,
      microEditMaxTokens,
    });
};

export { recordPlanToolOutcome };
