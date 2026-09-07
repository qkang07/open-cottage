import type { CheckResult, VerifyReport } from '../platform/verify';
import { createPlanRun, refreshReadySteps } from './state';
import type {
  HumanAcceptanceRecord,
  PlanCommandError,
  PlanDefinition,
  PlanEvent,
  PlanRun,
  PlanRevisionDiff,
  ToolMutationReport,
} from './types';

export class PlanRunnerError extends Error {
  constructor(readonly problem: PlanCommandError) {
    super(problem.message);
    this.name = 'PlanRunnerError';
  }
}

// 注意：必须是函数声明形式，never 返回值的控制流收窄才对调用方生效
function fail(
  code: PlanCommandError['code'],
  message: string,
  detail?: Record<string, unknown>,
): never {
  throw new PlanRunnerError({ code, message, detail });
}

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export interface RevisionInvalidation {
  invalidatedStepIds: string[];
  structurallyChangedStepIds: string[];
  finalVerificationInvalidated: boolean;
  reason: 'global_change' | 'step_change' | 'final_acceptance_change' | 'budget_only';
}

export const computeRevisionInvalidation = (
  previous: PlanDefinition,
  next: PlanDefinition,
): RevisionInvalidation => {
  const globalChanged =
    previous.goal !== next.goal ||
    !same(previous.requirements, next.requirements) ||
    previous.design !== next.design ||
    !same(previous.allowedPathPrefixes, next.allowedPathPrefixes);
  const previousCapabilities = new Map(
    previous.verificationCapabilitySnapshot.map((capability) => [capability.providerId, capability]),
  );
  const nextCapabilities = new Map(
    next.verificationCapabilitySnapshot.map((capability) => [capability.providerId, capability]),
  );
  const changedProviders = new Set(
    [...new Set([...previousCapabilities.keys(), ...nextCapabilities.keys()])].filter((providerId) => {
      const before = previousCapabilities.get(providerId);
      const after = nextCapabilities.get(providerId);
      if (!before || !after) return true;
      const beforeAssurance = before.assurance ?? (before.runtime === 'human' ? 'human' : 'structural');
      const afterAssurance = after.assurance ?? (after.runtime === 'human' ? 'human' : 'structural');
      return (
        (before.version ?? '1') !== (after.version ?? '1') ||
        beforeAssurance !== afterAssurance ||
        before.configSchemaDigest !== after.configSchemaDigest
      );
    }),
  );
  const finalChanged =
    !same(previous.finalAcceptance, next.finalAcceptance) ||
    next.finalAcceptance.some((criterion) => changedProviders.has(criterion.providerId));
  if (globalChanged) {
    return {
      invalidatedStepIds: next.steps.map((step) => step.id),
      structurallyChangedStepIds: next.steps.map((step) => step.id),
      finalVerificationInvalidated: true,
      reason: 'global_change',
    };
  }

  const previousById = new Map(previous.steps.map((step) => [step.id, step]));
  const changed = new Set(
    next.steps
      .filter(
        (step) =>
          !same(previousById.get(step.id), step) ||
          step.acceptance.some((criterion) => changedProviders.has(criterion.providerId)),
      )
      .map((step) => step.id),
  );
  const invalidated = new Set(changed);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const step of next.steps) {
      if (!invalidated.has(step.id) && step.dependsOn.some((id) => invalidated.has(id))) {
        invalidated.add(step.id);
        expanded = true;
      }
    }
  }
  return {
    invalidatedStepIds: [...invalidated],
    structurallyChangedStepIds: [...changed],
    finalVerificationInvalidated: finalChanged || invalidated.size > 0,
    reason: invalidated.size
      ? 'step_change'
      : finalChanged
        ? 'final_acceptance_change'
        : 'budget_only',
  };
};

const mutationPaths = (report: ToolMutationReport) => [
  ...report.created.filter((entry) => entry.kind === 'file').map((entry) => entry.path),
  ...report.modified.filter((entry) => entry.kind === 'file').map((entry) => entry.path),
  ...report.deleted.filter((entry) => entry.kind === 'file').map((entry) => entry.path),
  ...report.moved.flatMap((entry) =>
    entry.from.kind === 'file' || entry.to.kind === 'file'
      ? [entry.from.path, entry.to.path]
      : [],
  ),
];

const verificationStateFor = (checks: CheckResult[]): PlanRun['stepStates'][string]['verificationState'] => {
  if (!checks.length) return 'unverified';
  if (checks.some((check) => check.status === 'failed')) return 'failed';
  if (checks.some((check) => check.status === 'unavailable')) return 'unavailable';
  if (checks.some((check) => check.status === 'manual')) return 'unverified';
  return checks.some((check) => check.assurance === 'functional')
    ? 'verified'
    : 'partially_verified';
};

export interface RunnerTransition {
  run: PlanRun;
  event: PlanEvent;
  boundary: boolean;
}

/** The only component allowed to construct PlanRun lifecycle transitions. */
export class PlanRunner {
  private assertRevision(definition: PlanDefinition, run: PlanRun) {
    if (run.approvedRevision !== definition.revision) {
      fail('revision_mismatch', '执行状态与批准的计划版本不匹配', {
        approvedRevision: run.approvedRevision,
        definitionRevision: definition.revision,
      });
    }
  }

  submitRevision(
    definition: PlanDefinition,
    previous?: PlanDefinition | null,
    previousRun?: PlanRun | null,
    preserveStepIds: string[] = [],
  ): RunnerTransition {
    let run = createPlanRun(definition);
    if (previous && previousRun?.planId === definition.id) {
      const invalidation = computeRevisionInvalidation(previous, definition);
      const invalidated = new Set(invalidation.invalidatedStepIds);
      const preserve = new Set(preserveStepIds);
      const previousSteps = new Map(previous.steps.map((step) => [step.id, step]));
      const previousProviders = new Map(
        previous.verificationCapabilitySnapshot.map((item) => [item.providerId, item]),
      );
      const budgetChanges = Object.fromEntries(
        (Object.keys(definition.budgets) as Array<keyof typeof definition.budgets>)
          .filter((key) => previous.budgets[key] !== definition.budgets[key])
          .map((key) => [key, { before: previous.budgets[key], after: definition.budgets[key] }]),
      ) as PlanRevisionDiff['budgetChanges'];
      const stepStates = Object.fromEntries(
        definition.steps.map((step) => {
          const previousState = previousRun.stepStates[step.id];
          const canPreserve =
            preserve.has(step.id) &&
            !invalidated.has(step.id) &&
            same(previousSteps.get(step.id), step) &&
            previousState &&
            ['completed', 'skipped'].includes(previousState.status);
          return [step.id, canPreserve ? previousState : run.stepStates[step.id]!];
        }),
      );
      run = refreshReadySteps(definition, {
        ...previousRun,
        status: 'awaiting_approval',
        stepStates,
        invalidatedStepIds: invalidation.invalidatedStepIds,
        revisionDiff: {
          fromRevision: previous.revision,
          toRevision: definition.revision,
          addedPaths: definition.allowedPathPrefixes.filter(
            (path) => !previous.allowedPathPrefixes.includes(path),
          ),
          removedPaths: previous.allowedPathPrefixes.filter(
            (path) => !definition.allowedPathPrefixes.includes(path),
          ),
          budgetChanges,
          providerChanges: definition.verificationCapabilitySnapshot
            .filter((item) => {
              const before = previousProviders.get(item.providerId);
              return before?.version !== item.version || before?.assurance !== item.assurance;
            })
            .map((item) => ({
              providerId: item.providerId,
              beforeVersion: previousProviders.get(item.providerId)?.version,
              afterVersion: item.version,
              beforeAssurance: previousProviders.get(item.providerId)?.assurance,
              afterAssurance: item.assurance,
            })),
          invalidatedStepIds: invalidation.invalidatedStepIds,
        },
        finalVerification: invalidation.finalVerificationInvalidated
          ? undefined
          : previousRun.finalVerification,
        currentStepId: undefined,
        pendingReason: `revision ${definition.revision} 等待批准`,
        recoveryRequired: false,
        updatedAt: Date.now(),
      });
    }
    return {
      run,
      event: {
        type: previous ? 'revision_submitted' : 'submitted',
        at: Date.now(),
        revision: definition.revision,
      },
      boundary: true,
    };
  }

  approveRevision(definition: PlanDefinition, run: PlanRun): RunnerTransition {
    if (run.status !== 'awaiting_approval') {
      fail('invalid_transition', '只有待批准计划可以批准', { status: run.status });
    }
    const next = refreshReadySteps(definition, {
      ...run,
      approvedRevision: definition.revision,
      status: 'running',
      pendingReason: undefined,
      recoveryRequired: false,
      updatedAt: Date.now(),
    });
    return {
      run: next,
      event: { type: 'revision_approved', at: Date.now(), revision: definition.revision },
      boundary: true,
    };
  }

  startStep(definition: PlanDefinition, run: PlanRun, stepId: string): RunnerTransition {
    this.assertRevision(definition, run);
    const step = definition.steps.find((item) => item.id === stepId);
    const state = run.stepStates[stepId];
    if (!step || !state) fail('step_not_found', '计划步骤不存在', { stepId });
    if (state.status !== 'ready') {
      fail('dependency_not_satisfied', '步骤尚未 ready，不能开始执行', {
        stepId,
        status: state.status,
      });
    }
    const next: PlanRun = {
      ...run,
      status: 'running',
      currentStepId: stepId,
      stepStates: {
        ...run.stepStates,
        [stepId]: {
          ...state,
          status: 'running',
          attempts: state.attempts + 1,
          startedAt: Date.now(),
          failureReason: undefined,
        },
      },
      updatedAt: Date.now(),
    };
    return { run: next, event: { type: 'step_started', at: Date.now(), stepId }, boundary: true };
  }

  recordTurnCompleted(definition: PlanDefinition, run: PlanRun): RunnerTransition {
    this.assertRevision(definition, run);
    if (run.status !== 'running') {
      fail('invalid_transition', '只有正在执行的计划可以记录完成轮次', {
        status: run.status,
      });
    }
    const turns = run.counters.turns + 1;
    const exhausted = turns >= definition.budgets.maxTurns;
    const next: PlanRun = {
      ...run,
      status: exhausted ? 'paused' : 'running',
      counters: { ...run.counters, turns },
      pendingReason: exhausted
        ? `达到最大执行轮次 ${definition.budgets.maxTurns}，需要用户确认后继续`
        : run.pendingReason,
      updatedAt: Date.now(),
    };
    return {
      run: next,
      event: exhausted
        ? {
            type: 'budget_exhausted',
            at: Date.now(),
            stepId: run.currentStepId,
            detail: { budget: 'maxTurns', value: turns },
          }
        : {
            type: 'turn_completed',
            at: Date.now(),
            stepId: run.currentStepId,
            detail: { turn: turns },
          },
      boundary: exhausted,
    };
  }

  recordMutation(
    definition: PlanDefinition,
    run: PlanRun,
    stepId: string,
    report: ToolMutationReport,
  ): RunnerTransition {
    this.assertRevision(definition, run);
    const state = run.stepStates[stepId];
    if (!state || state.status !== 'running') {
      fail('invalid_transition', '只有正在执行的步骤可以记录实际变更', { stepId });
    }
    const paths = [...new Set(mutationPaths(report))];
    const changedFiles = [...new Set([...run.changedFiles, ...paths])];
    const next: PlanRun = {
      ...run,
      changedFiles,
      counters: { ...run.counters, changedFiles: changedFiles.length },
      stepStates: {
        ...run.stepStates,
        [stepId]: {
          ...state,
          changedFiles: [...new Set([...state.changedFiles, ...paths])],
          mutationReports: [...(state.mutationReports ?? []), report],
        },
      },
      updatedAt: Date.now(),
    };
    return {
      run: next,
      event: { type: 'mutation_recorded', at: Date.now(), stepId, detail: { report } },
      boundary: false,
    };
  }

  completeStep(
    definition: PlanDefinition,
    run: PlanRun,
    stepId: string,
    checks: CheckResult[],
    reportedPaths: string[] = [],
    requiredCriterionIds?: string[],
  ): RunnerTransition {
    this.assertRevision(definition, run);
    const state = run.stepStates[stepId];
    if (!state || state.status !== 'running') {
      fail('invalid_transition', '只有正在执行的步骤可以完成', { stepId });
    }
    const actual = new Set(state.changedFiles.map((path) => path.toLowerCase()));
    const mismatch = reportedPaths.filter((path) => !actual.has(path.toLowerCase()));
    if (mismatch.length) {
      fail('mutation_mismatch', '模型报告的文件不在实际 MutationReport 中', { mismatch });
    }
    const required = requiredCriterionIds ? new Set(requiredCriterionIds) : null;
    const requiredFailed = checks.some(
      (result) =>
        (!required || required.has(result.id)) &&
        (result.status === 'failed' || result.status === 'unavailable'),
    );
    const stepStates = {
      ...run.stepStates,
      [stepId]: {
        ...state,
        status: requiredFailed ? 'blocked' as const : 'completed' as const,
        verificationState: verificationStateFor(checks),
        checkResults: checks,
        completedAt: requiredFailed ? undefined : Date.now(),
        failureReason: requiredFailed ? '必需验收检查失败或不可用' : undefined,
      },
    };
    const next = refreshReadySteps(definition, {
      ...run,
      status: requiredFailed ? 'paused' : 'running',
      currentStepId: undefined,
      stepStates,
      pendingReason: requiredFailed ? '步骤验证未通过，已保留现场并暂停' : undefined,
      updatedAt: Date.now(),
    });
    return {
      run: next,
      event: { type: requiredFailed ? 'step_blocked' : 'step_completed', at: Date.now(), stepId },
      boundary: true,
    };
  }

  blockStep(definition: PlanDefinition, run: PlanRun, stepId: string, reason: string): RunnerTransition {
    this.assertRevision(definition, run);
    const state = run.stepStates[stepId];
    if (!state || !['running', 'ready'].includes(state.status)) {
      fail('invalid_transition', '当前步骤状态不能阻塞', { stepId, status: state?.status });
    }
    const next: PlanRun = {
      ...run,
      status: 'waiting_for_user',
      currentStepId: stepId,
      pendingReason: reason,
      stepStates: { ...run.stepStates, [stepId]: { ...state, status: 'blocked', failureReason: reason } },
      updatedAt: Date.now(),
    };
    return { run: next, event: { type: 'step_blocked', at: Date.now(), stepId, detail: { reason } }, boundary: true };
  }

  skipStep(definition: PlanDefinition, run: PlanRun, stepId: string): RunnerTransition {
    this.assertRevision(definition, run);
    const step = definition.steps.find((item) => item.id === stepId);
    const state = run.stepStates[stepId];
    if (!step || !state) fail('step_not_found', '计划步骤不存在', { stepId });
    if (!step.skippable) fail('step_not_skippable', '该步骤不可跳过，必须提交新 revision', { stepId });
    if (!['pending', 'ready', 'blocked', 'failed'].includes(state.status)) {
      fail('invalid_transition', '当前步骤状态不能跳过', { stepId, status: state.status });
    }
    const next = refreshReadySteps(definition, {
      ...run,
      status: 'running',
      currentStepId: undefined,
      requiresHumanAcceptance: true,
      stepStates: {
        ...run.stepStates,
        [stepId]: {
          ...state,
          status: 'skipped',
          verificationState:
            state.verificationState === 'not_checked' ? 'unverified' : state.verificationState,
          failureReason: '用户选择保留当前修改并跳过该步骤',
          completedAt: Date.now(),
        },
      },
      updatedAt: Date.now(),
    });
    return { run: next, event: { type: 'step_skipped', at: Date.now(), stepId }, boundary: true };
  }

  requestRevision(run: PlanRun, reason: string): RunnerTransition {
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      fail('invalid_transition', '终态计划不能请求 revision', { status: run.status });
    }
    const next: PlanRun = {
      ...run,
      status: 'paused',
      currentStepId: undefined,
      pendingReason: reason,
      updatedAt: Date.now(),
    };
    return {
      run: next,
      event: { type: 'revision_requested', at: Date.now(), detail: { reason } },
      boundary: true,
    };
  }

  verifyRun(
    definition: PlanDefinition,
    run: PlanRun,
    report: VerifyReport,
    hasFunctionalCoverage: boolean,
    requiredFailed = false,
  ): RunnerTransition {
    this.assertRevision(definition, run);
    const allRequiredSteps = definition.steps.every((step) =>
      step.skippable
        ? ['completed', 'skipped'].includes(run.stepStates[step.id]?.status)
        : run.stepStates[step.id]?.status === 'completed',
    );
    const allCriteria = [
      ...definition.steps.flatMap((step) => step.acceptance),
      ...definition.finalAcceptance,
    ];
    const hasHuman = allCriteria.some((criterion) => criterion.providerId === 'user.acceptance');
    const accepted = run.acceptanceRecords ?? {};
    const hasUnacceptedHuman = allCriteria.some(
      (criterion) => criterion.providerId === 'user.acceptance' && !accepted[criterion.id],
    );
    const automatic =
      report.verdict === 'pass' &&
      allRequiredSteps &&
      hasFunctionalCoverage &&
      !hasHuman &&
      !hasUnacceptedHuman &&
      !run.requiresHumanAcceptance;
    const next: PlanRun = {
      ...run,
      status: requiredFailed ? 'paused' : automatic ? 'completed' : 'awaiting_acceptance',
      finalVerification: report,
      pendingReason: requiredFailed
        ? report.reason ?? '必需最终验收检查失败或不可用'
        : automatic
          ? undefined
          : '缺少受信 functional 验证或仍有人工验收项',
      updatedAt: Date.now(),
    };
    return {
      run: next,
      event: {
        type: requiredFailed
          ? 'final_verification_failed'
          : automatic
            ? 'completed'
            : 'awaiting_acceptance',
        at: Date.now(),
      },
      boundary: true,
    };
  }

  acceptCriteria(
    run: PlanRun,
    criterionIds: string[],
    operator: string,
    note?: string,
  ): RunnerTransition {
    if (run.status !== 'awaiting_acceptance') {
      fail('invalid_transition', '当前计划不在等待验收状态', { status: run.status });
    }
    const records = { ...(run.acceptanceRecords ?? {}) };
    const at = Date.now();
    for (const criterionId of criterionIds) {
      const record: HumanAcceptanceRecord = { criterionId, acceptedBy: operator, acceptedAt: at, note };
      records[criterionId] = record;
    }
    const next: PlanRun = { ...run, acceptanceRecords: records, updatedAt: at };
    return { run: next, event: { type: 'criteria_accepted', at, detail: { criterionIds, operator, note } }, boundary: true };
  }

  cancelRun(run: PlanRun, reason = '用户取消了计划'): RunnerTransition {
    if (['completed', 'failed', 'cancelled'].includes(run.status)) {
      fail('invalid_transition', '终态计划不能再次取消', { status: run.status });
    }
    const next = {
      ...run,
      status: 'cancelled' as const,
      currentStepId: undefined,
      pendingReason: reason,
      updatedAt: Date.now(),
    };
    return {
      run: next,
      event: { type: 'cancelled', at: Date.now(), detail: { reason } },
      boundary: true,
    };
  }

  restoreCheckpoint(run: PlanRun, stepId: string, detail: Record<string, unknown>): RunnerTransition {
    if (!run.stepStates[stepId]) fail('step_not_found', '计划步骤不存在', { stepId });
    const next: PlanRun = {
      ...run,
      status: 'paused',
      pendingReason: '已恢复到步骤开始前的检查点',
      updatedAt: Date.now(),
    };
    return {
      run: next,
      event: { type: 'step_restored', at: Date.now(), stepId, detail },
      boundary: true,
    };
  }
}

export const planRunner = new PlanRunner();
