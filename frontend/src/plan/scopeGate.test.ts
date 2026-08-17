import { describe, expect, it, vi } from 'vitest';
import { createPlanDefinition, createPlanRun } from './state';
import { createPlanToolGuard } from './scopeGate';

const context = (overrides?: { research?: boolean; approvedRevision?: number }) => {
  const definition = createPlanDefinition(
    {
      goal: '受控修改',
      requirements: [],
      design: '',
      allowedPathPrefixes: ['frontend/src'],
      steps: [
        {
          id: 'step',
          title: '修改文件',
          kind: overrides?.research ? 'research' : 'implementation',
        },
      ],
      finalAcceptance: [],
    },
    { sessionId: 'session', workspaceId: 'workspace', capabilities: [] },
  );
  const base = createPlanRun(definition);
  return {
    definition,
    run: {
      ...base,
      status: 'running' as const,
      approvedRevision: overrides?.approvedRevision ?? definition.revision,
      currentStepId: 'step',
      stepStates: {
        ...base.stepStates,
        step: { ...base.stepStates.step!, status: 'running' as const },
      },
    },
  };
};

describe('plan/scopeGate', () => {
  const create = (active = context()) =>
    createPlanToolGuard({
      getContext: () => active,
      onBlocked: vi.fn(),
      onMutation: vi.fn(),
    });

  it('allows case-insensitive paths inside an approved prefix', () => {
    const verdict = create().check({
      toolName: 'writeFile',
      args: { path: 'FRONTEND/src/plan/types.ts', content: 'x' },
      source: 'agent',
    });
    expect(verdict.allowed).toBe(true);
  });

  it('rejects traversal, absolute paths, and out-of-scope writes', () => {
    const guard = create();
    for (const path of ['../outside.ts', 'C:/outside.ts', 'docs/outside.md']) {
      expect(
        guard.check({
          toolName: 'writeFile',
          args: { path, content: 'x' },
          source: 'agent',
        }).allowed,
      ).toBe(false);
    }
  });

  it('blocks writes from research steps and revision mismatches', () => {
    expect(
      create(context({ research: true })).check({
        toolName: 'writeFile',
        args: { path: 'frontend/src/a.ts', content: 'x' },
        source: 'agent',
      }).reason,
    ).toContain('只读研究步骤');
    expect(
      create(context({ approvedRevision: 0 })).check({
        toolName: 'writeFile',
        args: { path: 'frontend/src/a.ts', content: 'x' },
        source: 'agent',
      }).reason,
    ).toContain('执行版本不一致');
  });

  it('does not let a step widen the plan scope', () => {
    const active = context();
    active.definition.steps[0]!.allowedPathPrefixes = ['frontend/src/plan'];
    expect(
      create(active).check({
        toolName: 'writeFile',
        args: { path: 'frontend/src/agent/a.ts', content: 'x' },
        source: 'script',
      }).allowed,
    ).toBe(false);
  });
});
