import type {
  ExecutionPlan,
  PlanBudget,
  PlanSessionCounters,
} from './types';

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
    this.counters.files = 0;
    this.counters.apiCalls = 0;
    this.counters.turns = 0;
    this.counters.microEditTokens = 0;
  }

  submit(plan: ExecutionPlan): void {
    this.plan = plan;
    this.counters.files = 0;
    this.counters.apiCalls = 0;
    this.counters.turns = 0;
    this.counters.microEditTokens = 0;
  }

  effectiveBudget(fallback?: PlanBudget): PlanBudget {
    return {
      maxFiles: this.plan?.budget?.maxFiles ?? fallback?.maxFiles,
      maxApiCalls: this.plan?.budget?.maxApiCalls ?? fallback?.maxApiCalls,
      maxTurns: this.plan?.budget?.maxTurns ?? fallback?.maxTurns,
    };
  }

  isOverBudget(fallback?: PlanBudget): boolean {
    if (!this.plan) return false;
    const budget = this.effectiveBudget(fallback);
    if (budget.maxTurns !== undefined && this.counters.turns > budget.maxTurns) {
      return true;
    }
    if (
      budget.maxApiCalls !== undefined &&
      this.counters.apiCalls > budget.maxApiCalls
    ) {
      return true;
    }
    if (budget.maxFiles !== undefined && this.counters.files > budget.maxFiles) {
      return true;
    }
    return false;
  }
}
