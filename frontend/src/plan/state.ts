import { normalizePath } from '../workspace/pathUtils';
import type {
  AcceptanceCriterion,
  PlanDefinition,
  PlanDraft,
  PlanRun,
  PlanStep,
  PlanStepStatus,
  StepRunState,
  VerificationCapability,
} from './types';
import { DEFAULT_PLAN_BUDGETS } from './types';

const cleanList = (values: readonly string[] | undefined) =>
  [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];

export const normalizePlanPrefix = (value: string): string => {
  const raw = value.trim().replace(/\\/g, '/');
  if (!raw || raw === '.' || raw.startsWith('/') || /^[a-zA-Z]:\//.test(raw)) {
    throw new Error(`无效的计划路径前缀：${value}`);
  }
  if (raw.split('/').some((part) => part === '..')) {
    throw new Error(`计划路径不能包含 ..：${value}`);
  }
  const normalized = normalizePath(raw).replace(/\/$/, '');
  if (!normalized || normalized === '.cottage' || normalized.startsWith('.cottage/')) {
    throw new Error(`计划不能授权内部数据目录：${value}`);
  }
  return normalized;
};

export const normalizePlanPrefixes = (values: readonly string[]) =>
  [...new Set(values.map(normalizePlanPrefix))];

const normalizeCriterion = (
  value: Partial<AcceptanceCriterion> & { description: string },
): AcceptanceCriterion => ({
  id: value.id?.trim() || crypto.randomUUID(),
  providerId: value.providerId?.trim() || 'user.acceptance',
  description: value.description.trim(),
  required: value.required !== false,
  config:
    value.config && typeof value.config === 'object' ? { ...value.config } : {},
});

const normalizeStep = (value: PlanDraft['steps'][number]): PlanStep => ({
  id: value.id?.trim() || crypto.randomUUID(),
  title: value.title.trim(),
  detail: value.detail?.trim() ?? '',
  kind: value.kind ?? 'implementation',
  dependsOn: cleanList(value.dependsOn),
  allowedPathPrefixes: value.allowedPathPrefixes?.length
    ? normalizePlanPrefixes(value.allowedPathPrefixes)
    : undefined,
  acceptance: (value.acceptance ?? [])
    .filter((item) => item.description.trim())
    .map(normalizeCriterion),
  skippable: value.skippable === true,
});

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
}

export const validatePlanDefinition = (
  definition: PlanDefinition,
): PlanValidationResult => {
  const errors: string[] = [];
  if (!definition.goal.trim()) errors.push('计划目标不能为空');
  if (!definition.steps.length) errors.push('计划至少需要一个步骤');
  if (!definition.allowedPathPrefixes.length) {
    errors.push('计划至少需要一个允许写入的路径前缀');
  }
  if (!Number.isInteger(definition.budgets.maxTurns) || definition.budgets.maxTurns < 1) {
    errors.push('最大轮次必须是正整数');
  }
  if (
    !Number.isInteger(definition.budgets.maxChangedFiles) ||
    definition.budgets.maxChangedFiles < 1
  ) {
    errors.push('最大修改文件数必须是正整数');
  }
  if (
    !Number.isInteger(definition.budgets.maxExternalCalls) ||
    definition.budgets.maxExternalCalls < 0
  ) {
    errors.push('最大外部调用数必须是非负整数');
  }
  if (
    !Number.isInteger(definition.budgets.maxStepRetries) ||
    definition.budgets.maxStepRetries < 0
  ) {
    errors.push('步骤重试次数必须是非负整数');
  }

  const ids = new Set<string>();
  for (const step of definition.steps) {
    if (!step.id || ids.has(step.id)) errors.push(`步骤 ID 重复或为空：${step.id}`);
    ids.add(step.id);
    if (!step.title.trim()) errors.push(`步骤 ${step.id} 的标题不能为空`);
  }
  for (const step of definition.steps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) {
        errors.push(`步骤 ${step.id} 依赖不存在的步骤 ${dependency}`);
      }
      if (dependency === step.id) errors.push(`步骤 ${step.id} 不能依赖自身`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(definition.steps.map((step) => [step.id, step]));
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!visit(dep)) return false;
    }
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const id of ids) {
    if (!visit(id)) {
      errors.push('步骤依赖存在循环');
      break;
    }
  }

  const allowed = definition.allowedPathPrefixes.map((path) => path.toLowerCase());
  for (const step of definition.steps) {
    for (const prefix of step.allowedPathPrefixes ?? []) {
      const candidate = prefix.toLowerCase();
      if (!allowed.some((root) => candidate === root || candidate.startsWith(`${root}/`))) {
        errors.push(`步骤 ${step.id} 的路径范围超出计划范围：${prefix}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
};

export const createPlanDefinition = (
  draft: PlanDraft,
  context: {
    sessionId: string;
    workspaceId: string;
    capabilities: VerificationCapability[];
    previous?: PlanDefinition | null;
  },
): PlanDefinition => {
  const now = Date.now();
  const previous = context.previous ?? null;
  const definition: PlanDefinition = {
    schema: 1,
    id: (previous?.id ?? draft.planId?.trim()) || crypto.randomUUID(),
    revision: previous ? previous.revision + 1 : 1,
    sessionId: context.sessionId,
    workspaceId: context.workspaceId,
    goal: draft.goal.trim(),
    requirements: cleanList(draft.requirements),
    design: draft.design.trim(),
    allowedPathPrefixes: normalizePlanPrefixes(draft.allowedPathPrefixes),
    steps: draft.steps.filter((step) => step.title.trim()).map(normalizeStep),
    finalAcceptance: draft.finalAcceptance
      .filter((item) => item.description.trim())
      .map(normalizeCriterion),
    verificationCapabilitySnapshot: context.capabilities.map((item) => ({ ...item })),
    budgets: { ...DEFAULT_PLAN_BUDGETS, ...(draft.budgets ?? {}) },
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  const validation = validatePlanDefinition(definition);
  if (!validation.valid) throw new Error(validation.errors.join('；'));
  return definition;
};

const newStepState = (): StepRunState => ({
  status: 'pending',
  verificationState: 'not_checked',
  attempts: 0,
  changedFiles: [],
  evidence: [],
  checkResults: [],
});

export const refreshReadySteps = (
  definition: PlanDefinition,
  run: PlanRun,
): PlanRun => {
  const next = { ...run, stepStates: { ...run.stepStates } };
  for (const step of definition.steps) {
    const state = next.stepStates[step.id] ?? newStepState();
    if (state.status !== 'pending' && state.status !== 'ready') {
      next.stepStates[step.id] = state;
      continue;
    }
    const ready = step.dependsOn.every((dependency) => {
      const status = next.stepStates[dependency]?.status;
      const dependencyStep = definition.steps.find((item) => item.id === dependency);
      return status === 'completed' ||
        (status === 'skipped' && dependencyStep?.skippable === true);
    });
    next.stepStates[step.id] = { ...state, status: ready ? 'ready' : 'pending' };
  }
  next.updatedAt = Date.now();
  return next;
};

export const createPlanRun = (definition: PlanDefinition): PlanRun => {
  const now = Date.now();
  const stepStates = Object.fromEntries(
    definition.steps.map((step) => [step.id, newStepState()]),
  );
  return refreshReadySteps(definition, {
    schema: 1,
    planId: definition.id,
    sessionId: definition.sessionId,
    workspaceId: definition.workspaceId,
    approvedRevision: 0,
    status: 'awaiting_approval',
    stepStates,
    changedFiles: [],
    operatorInstructions: [],
    counters: { turns: 0, changedFiles: 0, externalCalls: 0 },
    createdAt: now,
    updatedAt: now,
  });
};

export const recoverInterruptedPlan = (run: PlanRun): PlanRun => {
  const runningStep = Object.entries(run.stepStates).find(
    ([, state]) => state.status === 'running',
  );
  if (run.status !== 'running' && run.status !== 'verifying' && !runningStep) return run;
  const stepStates = { ...run.stepStates };
  if (runningStep) {
    stepStates[runningStep[0]] = {
      ...runningStep[1],
      status: 'blocked',
      failureReason: '应用在步骤执行中中断，需要用户确认后继续',
    };
  }
  return {
    ...run,
    status: 'paused',
    stepStates,
    recoveryRequired: true,
    pendingReason:
      run.status === 'verifying'
        ? '检测到验证过程被中断，已暂停；恢复后会重新运行声明的只读验证'
        : '检测到未完成的执行步骤，已暂停以避免重复执行',
    updatedAt: Date.now(),
  };
};

export const isTerminalPlanStatus = (status: PlanRun['status']) =>
  status === 'completed' || status === 'failed' || status === 'cancelled';

export const nextReadyStep = (
  definition: PlanDefinition,
  run: PlanRun,
): PlanStep | null =>
  definition.steps.find((step) => run.stepStates[step.id]?.status === 'ready') ?? null;

export const planProgress = (run: PlanRun) => {
  const states = Object.values(run.stepStates);
  const completed = states.filter((state) =>
    state.status === 'completed' || state.status === 'skipped',
  ).length;
  return {
    total: states.length,
    completed,
    failed: states.filter((state) => state.status === 'failed').length,
    percent: states.length ? Math.round((completed / states.length) * 100) : 0,
  };
};

export const statusAfterCheckResults = (
  results: CheckResultLike[],
): StepRunState['verificationState'] => {
  if (!results.length) return 'unverified';
  if (results.some((item) => item.status === 'failed')) return 'failed';
  if (results.some((item) => item.status === 'unavailable')) return 'unavailable';
  if (results.every((item) => item.status === 'passed')) {
    return results.some((item) => item.assurance === 'functional')
      ? 'verified'
      : 'partially_verified';
  }
  return 'partially_verified';
};

interface CheckResultLike {
  status?: string;
  assurance?: string;
}

export const canTransitionStep = (
  from: PlanStepStatus,
  to: PlanStepStatus,
): boolean => {
  const allowed: Record<PlanStepStatus, PlanStepStatus[]> = {
    pending: ['ready', 'skipped'],
    ready: ['running', 'skipped'],
    running: ['completed', 'blocked', 'failed'],
    blocked: ['ready', 'running', 'failed', 'skipped'],
    completed: [],
    failed: ['ready', 'skipped'],
    skipped: [],
  };
  return allowed[from].includes(to);
};
