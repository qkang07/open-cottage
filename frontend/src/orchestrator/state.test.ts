import { describe, expect, it } from 'vitest';
import {
  addArtifactToState,
  canTransition,
  computeProgress,
  createOrchestrationState,
  findReadySteps,
  setSteps,
  transitionState,
  updateStepStatus,
} from './state';
import type { OrchestrationStep } from './types';

describe('orchestrator/state', () => {
  it('creates initial state', () => {
    const state = createOrchestrationState('id-1', 'session-1', 'test goal');
    expect(state.id).toBe('id-1');
    expect(state.chatSessionId).toBe('session-1');
    expect(state.goal).toBe('test goal');
    expect(state.status).toBe('planning');
    expect(state.steps).toEqual([]);
  });

  it('validates state transitions', () => {
    expect(canTransition('planning', 'running')).toBe(true);
    expect(canTransition('planning', 'paused')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('failed', 'running')).toBe(false);
  });

  it('throws on invalid transition', () => {
    const state = createOrchestrationState('id', 'session', 'goal');
    expect(() => transitionState(state, 'completed')).toThrow();
  });

  it('sets steps and switches to awaiting_approval', () => {
    let state = createOrchestrationState('id', 'session', 'goal');
    const steps: OrchestrationStep[] = [
      { id: 's1', title: 'Step 1', type: 'agent', status: 'pending', dependencies: [], artifactIds: [] },
    ];
    state = setSteps(state, steps);
    expect(state.status).toBe('awaiting_approval');
    expect(state.steps).toHaveLength(1);
  });

  it('updates step status', () => {
    let state = createOrchestrationState('id', 'session', 'goal');
    state = setSteps(state, [
      { id: 's1', title: 'Step 1', type: 'agent', status: 'pending', dependencies: [], artifactIds: [] },
    ]);
    state = updateStepStatus(state, 's1', 'doing');
    expect(state.steps[0].status).toBe('doing');
    expect(state.currentStepId).toBe('s1');
  });

  it('finds ready steps respecting dependencies', () => {
    let state = createOrchestrationState('id', 'session', 'goal');
    state = setSteps(state, [
      { id: 's1', title: 'A', type: 'agent', status: 'pending', dependencies: [], artifactIds: [] },
      { id: 's2', title: 'B', type: 'agent', status: 'pending', dependencies: ['s1'], artifactIds: [] },
      { id: 's3', title: 'C', type: 'agent', status: 'pending', dependencies: ['s2'], artifactIds: [] },
    ]);

    expect(findReadySteps(state).map((s) => s.id)).toEqual(['s1']);

    state = updateStepStatus(state, 's1', 'done');
    expect(findReadySteps(state).map((s) => s.id)).toEqual(['s2']);

    state = updateStepStatus(state, 's2', 'done');
    expect(findReadySteps(state).map((s) => s.id)).toEqual(['s3']);
  });

  it('attaches artifact to state and step', () => {
    let state = createOrchestrationState('id', 'session', 'goal');
    state = setSteps(state, [
      { id: 's1', title: 'Step 1', type: 'agent', status: 'done', dependencies: [], artifactIds: [] },
    ]);
    state = addArtifactToState(state, {
      id: 'a1',
      type: 'text',
      name: 'result.txt',
      content: 'hello',
      producerStepId: 's1',
      createdAt: 1,
    });
    expect(state.artifactIds).toContain('a1');
    expect(state.steps[0].artifactIds).toContain('a1');
  });

  it('computes progress', () => {
    let state = createOrchestrationState('id', 'session', 'goal');
    state = setSteps(state, [
      { id: 's1', title: 'A', type: 'agent', status: 'done', dependencies: [], artifactIds: [] },
      { id: 's2', title: 'B', type: 'agent', status: 'doing', dependencies: [], artifactIds: [] },
      { id: 's3', title: 'C', type: 'agent', status: 'pending', dependencies: [], artifactIds: [] },
    ]);
    const progress = computeProgress(state);
    expect(progress.total).toBe(3);
    expect(progress.done).toBe(1);
    expect(progress.doing).toBe(1);
    expect(progress.percent).toBe(33);
  });
});
