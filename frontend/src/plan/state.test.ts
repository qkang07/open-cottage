import { describe, expect, it } from 'vitest';
import {
  createPlanDefinition,
  createPlanRun,
  nextReadyStep,
  normalizePlanPrefix,
  recoverInterruptedPlan,
  refreshReadySteps,
  validatePlanDefinition,
} from './state';

const definition = () =>
  createPlanDefinition(
    {
      goal: '实现统一计划模式',
      requirements: ['浏览器优先'],
      design: '使用 DAG 状态机',
      allowedPathPrefixes: ['frontend/src/plan'],
      steps: [
        { id: 'a', title: '核心', kind: 'implementation' },
        { id: 'b', title: '界面', kind: 'implementation', dependsOn: ['a'] },
      ],
      finalAcceptance: [
        {
          providerId: 'user.acceptance',
          description: '用户确认',
          required: true,
        },
      ],
    },
    { sessionId: 'session', workspaceId: 'workspace', capabilities: [] },
  );

describe('plan/state', () => {
  it('normalizes workspace prefixes and rejects escape paths', () => {
    expect(normalizePlanPrefix('frontend\\src/plan/')).toBe('frontend/src/plan');
    expect(() => normalizePlanPrefix('../outside')).toThrow('..');
    expect(() => normalizePlanPrefix('C:/outside')).toThrow('无效');
    expect(() => normalizePlanPrefix('.cottage/plans')).toThrow('内部数据目录');
  });

  it('rejects missing dependencies and cycles', () => {
    const base = definition();
    expect(
      validatePlanDefinition({
        ...base,
        steps: [{ ...base.steps[0]!, dependsOn: ['missing'] }],
      }).valid,
    ).toBe(false);
    expect(
      validatePlanDefinition({
        ...base,
        steps: [
          { ...base.steps[0]!, dependsOn: ['b'] },
          { ...base.steps[1]!, dependsOn: ['a'] },
        ],
      }).errors,
    ).toContain('步骤依赖存在循环');
  });

  it('unlocks steps only after dependencies complete', () => {
    const plan = definition();
    let run = createPlanRun(plan);
    expect(nextReadyStep(plan, run)?.id).toBe('a');
    run = refreshReadySteps(plan, {
      ...run,
      stepStates: {
        ...run.stepStates,
        a: { ...run.stepStates.a!, status: 'completed' },
      },
    });
    expect(nextReadyStep(plan, run)?.id).toBe('b');
  });

  it('also unlocks downstream steps after the user explicitly skips a dependency', () => {
    const plan = definition();
    plan.steps[0]!.skippable = true;
    const run = refreshReadySteps(plan, {
      ...createPlanRun(plan),
      stepStates: {
        ...createPlanRun(plan).stepStates,
        a: { ...createPlanRun(plan).stepStates.a!, status: 'skipped' },
      },
    });
    expect(nextReadyStep(plan, run)?.id).toBe('b');
  });

  it('does not satisfy dependencies when a non-skippable step is marked skipped', () => {
    const plan = definition();
    const initial = createPlanRun(plan);
    const run = refreshReadySteps(plan, {
      ...initial,
      stepStates: {
        ...initial.stepStates,
        a: { ...initial.stepStates.a!, status: 'skipped' },
      },
    });
    expect(nextReadyStep(plan, run)).toBeNull();
  });

  it('creates immutable increasing revisions', () => {
    const first = definition();
    const second = createPlanDefinition(
      {
        planId: first.id,
        baseRevision: first.revision,
        goal: first.goal,
        requirements: first.requirements,
        design: `${first.design} v2`,
        allowedPathPrefixes: first.allowedPathPrefixes,
        steps: first.steps,
        finalAcceptance: first.finalAcceptance,
      },
      {
        sessionId: first.sessionId,
        workspaceId: first.workspaceId,
        capabilities: [],
        previous: first,
      },
    );
    expect(second.id).toBe(first.id);
    expect(second.revision).toBe(2);
    expect(first.revision).toBe(1);
  });

  it('pauses interrupted running steps instead of replaying them', () => {
    const plan = definition();
    const run = createPlanRun(plan);
    const recovered = recoverInterruptedPlan({
      ...run,
      status: 'running',
      currentStepId: 'a',
      stepStates: {
        ...run.stepStates,
        a: { ...run.stepStates.a!, status: 'running' },
      },
    });
    expect(recovered.status).toBe('paused');
    expect(recovered.recoveryRequired).toBe(true);
    expect(recovered.stepStates.a?.status).toBe('blocked');
  });

  it('pauses interrupted verification instead of claiming completion', () => {
    const plan = definition();
    const recovered = recoverInterruptedPlan({
      ...createPlanRun(plan),
      status: 'verifying',
    });
    expect(recovered.status).toBe('paused');
    expect(recovered.pendingReason).toContain('验证过程被中断');
  });
});
