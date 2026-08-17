import type {
  Artifact,
  OrchestrationState,
  OrchestrationStatus,
  OrchestrationStep,
  OrchestrationStepStatus,
} from './types';

export const validTransitions: Record<
  OrchestrationStatus,
  OrchestrationStatus[]
> = {
  planning: ['awaiting_approval', 'running', 'paused', 'failed'],
  awaiting_approval: ['running', 'failed'],
  running: ['paused', 'completed', 'failed'],
  paused: ['running', 'completed', 'failed'],
  completed: [],
  failed: [],
};

export function canTransition(
  from: OrchestrationStatus,
  to: OrchestrationStatus,
): boolean {
  return validTransitions[from].includes(to);
}

export function transitionState(
  state: OrchestrationState,
  to: OrchestrationStatus,
): OrchestrationState {
  if (!canTransition(state.status, to)) {
    throw new Error(
      `非法状态转换: ${state.status} -> ${to} (orchestration ${state.id})`,
    );
  }
  return {
    ...state,
    status: to,
    updatedAt: Date.now(),
  };
}

export function createOrchestrationState(
  id: string,
  chatSessionId: string,
  goal: string,
): OrchestrationState {
  const now = Date.now();
  return {
    id,
    chatSessionId,
    goal,
    status: 'planning',
    steps: [],
    artifactIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function updateStepStatus(
  state: OrchestrationState,
  stepId: string,
  status: OrchestrationStepStatus,
  options?: { result?: string; error?: string },
): OrchestrationState {
  const steps = state.steps.map((step) => {
    if (step.id !== stepId) return step;
    return {
      ...step,
      status,
      ...(options?.result !== undefined && { result: options.result }),
      ...(options?.error !== undefined && { error: options.error }),
    };
  });
  return {
    ...state,
    steps,
    currentStepId: status === 'doing' ? stepId : state.currentStepId,
    updatedAt: Date.now(),
  };
}

export function setSteps(
  state: OrchestrationState,
  steps: OrchestrationStep[],
): OrchestrationState {
  // 计划生成后进入「待批准」状态，需用户确认后才执行
  return {
    ...state,
    status: 'awaiting_approval',
    steps,
    updatedAt: Date.now(),
  };
}

export function addArtifactToState(
  state: OrchestrationState,
  artifact: Artifact,
): OrchestrationState {
  const artifactIds = state.artifactIds.includes(artifact.id)
    ? state.artifactIds
    : [...state.artifactIds, artifact.id];

  const steps = state.steps.map((step) => {
    if (step.id !== artifact.producerStepId) return step;
    const artifactIdsInStep = step.artifactIds.includes(artifact.id)
      ? step.artifactIds
      : [...step.artifactIds, artifact.id];
    return { ...step, artifactIds: artifactIdsInStep };
  });

  return {
    ...state,
    artifactIds,
    steps,
    updatedAt: Date.now(),
  };
}

export function findReadySteps(state: OrchestrationState): OrchestrationStep[] {
  const doneIds = new Set(
    state.steps.filter((s) => s.status === 'done').map((s) => s.id),
  );
  return state.steps.filter(
    (step) =>
      step.status === 'pending' &&
      step.dependencies.every((depId) => doneIds.has(depId)),
  );
}

export function hasRunningSteps(state: OrchestrationState): boolean {
  return state.steps.some((s) => s.status === 'doing');
}

export function isTerminalState(state: OrchestrationState): boolean {
  return state.status === 'completed' || state.status === 'failed';
}

export function computeProgress(state: OrchestrationState): {
  total: number;
  done: number;
  doing: number;
  failed: number;
  percent: number;
} {
  const total = state.steps.length;
  const done = state.steps.filter((s) => s.status === 'done').length;
  const doing = state.steps.filter((s) => s.status === 'doing').length;
  const failed = state.steps.filter((s) => s.status === 'failed').length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { total, done, doing, failed, percent };
}
