import { describe, expect, it } from 'vitest';
import { createPlanDefinition, createPlanRun } from './state';
import {
  computeRevisionInvalidation,
  PlanRunner,
  PlanRunnerError,
} from './runner';

const makeDefinition = () =>
  createPlanDefinition(
    {
      goal: '加固 Plan Mode',
      requirements: ['浏览器安全'],
      design: 'DAG',
      allowedPathPrefixes: ['frontend/src/plan'],
      steps: [
        { id: 'a', title: '核心', kind: 'implementation' },
        { id: 'b', title: '界面', kind: 'implementation', dependsOn: ['a'] },
      ],
      finalAcceptance: [],
    },
    { sessionId: 's', workspaceId: 'w', capabilities: [] },
  );

describe('PlanRunner', () => {
  it('rejects skipping a non-skippable step with a structured error', () => {
    const definition = makeDefinition();
    const run = {
      ...createPlanRun(definition),
      approvedRevision: definition.revision,
      status: 'running' as const,
    };
    expect(() => new PlanRunner().skipStep(definition, run, 'a')).toThrowError(
      PlanRunnerError,
    );
    try {
      new PlanRunner().skipStep(definition, run, 'a');
    } catch (error) {
      expect((error as PlanRunnerError).problem.code).toBe('step_not_skippable');
    }
  });

  it('invalidates a changed step and all transitive dependents', () => {
    const previous = makeDefinition();
    const next = {
      ...previous,
      revision: previous.revision + 1,
      steps: previous.steps.map((step) =>
        step.id === 'a' ? { ...step, detail: 'changed' } : step,
      ),
    };
    expect(computeRevisionInvalidation(previous, next).invalidatedStepIds).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps step evidence for budget-only revisions', () => {
    const previous = makeDefinition();
    const next = {
      ...previous,
      revision: previous.revision + 1,
      budgets: { ...previous.budgets, maxTurns: previous.budgets.maxTurns + 1 },
    };
    const invalidation = computeRevisionInvalidation(previous, next);
    expect(invalidation.reason).toBe('budget_only');
    expect(invalidation.invalidatedStepIds).toEqual([]);
  });

  it('invalidates evidence produced by a provider whose approved version changed', () => {
    const previous = makeDefinition();
    previous.steps[0]!.acceptance = [{
      id: 'check-a',
      providerId: 'workspace.contentHash',
      description: '哈希',
      required: true,
      config: { path: 'frontend/src/plan/a.ts' },
    }];
    previous.verificationCapabilitySnapshot = [{
      providerId: 'workspace.contentHash',
      label: 'hash',
      runtime: 'browser',
      available: true,
      kinds: ['contentHash'],
      version: '1',
      assurance: 'structural',
    }];
    const next = {
      ...previous,
      revision: previous.revision + 1,
      verificationCapabilitySnapshot: previous.verificationCapabilitySnapshot.map((item) => ({
        ...item,
        version: '2',
      })),
    };
    expect(computeRevisionInvalidation(previous, next).invalidatedStepIds).toEqual(['a', 'b']);
  });

  it('preserves unchanged completed evidence only when explicitly requested', () => {
    const previous = makeDefinition();
    const previousRun = createPlanRun(previous);
    previousRun.stepStates.a = {
      ...previousRun.stepStates.a!,
      status: 'completed',
      changedFiles: ['frontend/src/plan/a.ts'],
    };
    const next = { ...previous, revision: previous.revision + 1 };
    const runner = new PlanRunner();
    expect(
      runner.submitRevision(next, previous, previousRun).run.stepStates.a?.status,
    ).toBe('ready');
    expect(
      runner.submitRevision(next, previous, previousRun, ['a']).run.stepStates.a?.status,
    ).toBe('completed');
  });

  it('keeps a blocked step current so recovery actions target the right checkpoint', () => {
    const definition = makeDefinition();
    const runner = new PlanRunner();
    const approved = runner.approveRevision(definition, createPlanRun(definition)).run;
    const running = runner.startStep(definition, approved, 'a').run;
    const blocked = runner.blockStep(definition, running, 'a', '需要用户输入').run;
    expect(blocked.currentStepId).toBe('a');
    expect(blocked.stepStates.a?.status).toBe('blocked');
  });

  it('never auto-completes from structural verification alone', () => {
    const definition = makeDefinition();
    const run = createPlanRun(definition);
    for (const step of definition.steps) run.stepStates[step.id]!.status = 'completed';
    run.approvedRevision = definition.revision;
    run.status = 'verifying';
    const transition = new PlanRunner().verifyRun(
      definition,
      run,
      {
        verdict: 'pass',
        checks: [],
        uncovered: [],
        runAt: 1,
        manifestPathCount: 0,
        acceptanceFileCount: 0,
        scriptRan: false,
      },
      false,
    );
    expect(transition.run.status).toBe('awaiting_acceptance');
  });
});
