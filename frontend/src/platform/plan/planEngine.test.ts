import { describe, expect, it, beforeEach } from 'vitest';
import { resetCapabilityRegistry } from '../capabilities/registry';
import { BUILTIN_CAPABILITIES } from '../capabilities/builtins';
import {
  evaluatePlanGate,
  getToolRiskLevel,
  isPlanExemptTool,
  recordPlanToolOutcome,
} from './planEngine';
import { PlanSession } from './planSession';

describe('planEngine', () => {
  beforeEach(() => {
    resetCapabilityRegistry(BUILTIN_CAPABILITIES);
  });

  it('read tools do not require plan', () => {
    expect(getToolRiskLevel('readFile')).toBe('read');
    const session = new PlanSession();
    const verdict = evaluatePlanGate(
      session,
      { toolName: 'readFile', toolRound: 1 },
      { requirePlanFor: ['write', 'external', 'destructive'] },
    );
    expect(verdict.allowed).toBe(true);
  });

  it('write tools blocked without plan', () => {
    const session = new PlanSession();
    const verdict = evaluatePlanGate(
      session,
      { toolName: 'writeFile', toolRound: 1 },
      { requirePlanFor: ['write', 'external', 'destructive'] },
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('submitExecutionPlan');
  });

  it('write tools allowed after plan submitted', () => {
    const session = new PlanSession();
    session.submit({
      goal: '改文件',
      items: [{ requirement: '更新 config' }],
      submittedAt: Date.now(),
    });
    const verdict = evaluatePlanGate(
      session,
      { toolName: 'writeFile', toolRound: 1 },
      { requirePlanFor: ['write'], defaultBudget: { maxFiles: 5 } },
    );
    expect(verdict.allowed).toBe(true);
  });

  it('blocks when file budget exceeded', () => {
    const session = new PlanSession();
    session.submit({
      goal: '批量改',
      items: [{ requirement: '改多个文件' }],
      budget: { maxFiles: 1 },
      submittedAt: Date.now(),
    });
    recordPlanToolOutcome(session, 'writeFile');
    const verdict = evaluatePlanGate(
      session,
      { toolName: 'editFile', toolRound: 2 },
      { requirePlanFor: ['write'] },
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('maxFiles');
  });

  it('blocks when turn budget exceeded and resets per plan', () => {
    const session = new PlanSession();
    session.submit({
      goal: '改文件',
      items: [{ requirement: '更新 config' }],
      budget: { maxTurns: 2 },
      submittedAt: Date.now(),
    });
    expect(
      evaluatePlanGate(session, { toolName: 'writeFile', toolRound: 999 }, {
        requirePlanFor: ['write'],
      }).allowed,
    ).toBe(true);
    session.counters.turns = 2;
    expect(
      evaluatePlanGate(session, { toolName: 'writeFile', toolRound: 999 }, {
        requirePlanFor: ['write'],
      }).allowed,
    ).toBe(true);
    session.counters.turns = 3;
    const verdict = evaluatePlanGate(
      session,
      { toolName: 'writeFile', toolRound: 999 },
      { requirePlanFor: ['write'] },
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('maxTurns');

    // 重新提交计划后 turns 归零，重新放行
    session.submit({
      goal: '再改一次',
      items: [{ requirement: '更新 config' }],
      budget: { maxTurns: 2 },
      submittedAt: Date.now(),
    });
    expect(
      evaluatePlanGate(session, { toolName: 'writeFile', toolRound: 999 }, {
        requirePlanFor: ['write'],
      }).allowed,
    ).toBe(true);
  });

  it('exempts askUser and task tools', () => {
    expect(isPlanExemptTool('askUser')).toBe(true);
    // 模型可能输出 snake_case 变体，同样豁免
    expect(isPlanExemptTool('ask_user')).toBe(true);
    expect(isPlanExemptTool('taskSetPlan')).toBe(true);
    expect(isPlanExemptTool('orch_completeStep')).toBe(true);
  });

  it('runScript 宿主不计入 files 预算（脚本内子调用已各自计数，防双计）', () => {
    const session = new PlanSession();
    session.submit({
      goal: '跑脚本',
      items: [{ requirement: '批量改文件' }],
      submittedAt: Date.now(),
    });
    recordPlanToolOutcome(session, 'runScript');
    expect(session.counters.files).toBe(0);
    recordPlanToolOutcome(session, 'writeFile');
    expect(session.counters.files).toBe(1);
  });
});
