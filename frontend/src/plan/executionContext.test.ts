import { describe, expect, it } from 'vitest';
import type { PlanDefinition, PlanRun } from './types';
import { buildPlanExecutionContext } from './executionContext';

describe('buildPlanExecutionContext', () => {
  it('includes approved state, acceptance, journal truth, snapshot and remaining budget', () => {
    const definition = {
      id: 'plan-1', revision: 2, goal: 'ship safely', requirements: ['keep scope'], design: 'two steps',
      allowedPathPrefixes: ['src/a.txt'],
      steps: [{
        id: 'write-a', title: 'write a', detail: 'change the file', kind: 'implementation', dependsOn: ['research'],
        allowedPathPrefixes: ['src/a.txt'],
        acceptance: [{ id: 'step-check', providerId: 'eval.contentMatches', description: 'a matches', required: true, config: { path: 'src/a.txt', expected: 'done' } }],
      }, { id: 'research', title: 'research', detail: 'read', kind: 'research', dependsOn: [], acceptance: [] }],
      finalAcceptance: [{ id: 'final-check', providerId: 'eval.contentMatches', description: 'final matches', required: true, config: {} }],
      verificationCapabilitySnapshot: [{ providerId: 'eval.contentMatches', label: 'content', runtime: 'browser', available: true, kinds: ['contentMatches'] }],
      budgets: { maxTurns: 8, maxChangedFiles: 2, maxExternalCalls: 1, maxStepRetries: 2 },
    } as PlanDefinition;
    const run = {
      approvedRevision: 2, status: 'running', currentStepId: 'write-a', changedFiles: ['src/a.txt'],
      counters: { turns: 3, changedFiles: 1, externalCalls: 0 },
      stepStates: {
        'write-a': { attempts: 1, changedFiles: ['src/a.txt'], evidence: [], status: 'running' },
        research: { status: 'completed', changedFiles: [], evidence: [{ kind: 'summary', summary: 'dependency evidence' }] },
      },
    } as PlanRun;
    const result = buildPlanExecutionContext({
      definition,
      run,
      operatorInstructions: ['preserve comments'],
    });
    expect(result).toContain('ship safely');
    expect(result).toContain('step-check');
    expect(result).toContain('final-check');
    expect(result).toContain('dependency evidence');
    expect(result).toContain('src/a.txt');
    expect(result).toContain('批准时验证能力快照');
    expect(result).toContain('preserve comments');
    expect(result.length).toBeLessThanOrEqual(24_000);
  });
});
