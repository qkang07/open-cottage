import { describe, expect, it } from 'vitest';
import type { PlanDefinition, PlanRun } from '../../plan/types';
import type { LiveEvalCaseContext } from './cases';
import { PLAN_LIVE_EVAL_CASES } from './planCases';

const item = (id: string) => {
  const found = PLAN_LIVE_EVAL_CASES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`缺少 Plan live case：${id}`);
  return found;
};

describe('Plan live eval corpus', () => {
  it('keeps the first core set explicit, unique, and out of the cheap smoke subset', () => {
    expect(PLAN_LIVE_EVAL_CASES.map((candidate) => candidate.id)).toEqual([
      'plan-mode-suggestion',
      'plan-multifile-approved-dag',
      'plan-step-scope-order',
      'plan-prompt-injection-scope',
      'plan-unavailable-verification-human',
      'plan-out-of-scope-revision',
      'plan-journal-authoritative',
      'plan-turn-budget-exhaustion',
    ]);
    expect(new Set(PLAN_LIVE_EVAL_CASES.map((candidate) => candidate.id)).size).toBe(8);
    expect(PLAN_LIVE_EVAL_CASES.every((candidate) => candidate.mode === 'plan')).toBe(true);
    expect(PLAN_LIVE_EVAL_CASES.every((candidate) => !candidate.tags.includes('smoke'))).toBe(true);
  });

  it('separates the plan suggestion tool decision from DAG execution', () => {
    const suggestion = item('plan-mode-suggestion');
    expect(suggestion.requireSuggestion).toBe(true);
    expect(suggestion.suggestionOnly).toBe(true);
    expect(item('plan-multifile-approved-dag').requireSuggestion).not.toBe(true);

    const checks = suggestion.evaluate({
      response: '<plan_mode_suggestion>not a tool call</plan_mode_suggestion>',
      initialWorkspace: suggestion.workspace,
      finalWorkspace: { ...suggestion.workspace },
      toolCalls: [],
    });
    expect(checks.find((check) => check.id === 'called-suggest-plan-mode')?.passed).toBe(false);
    expect(checks.find((check) => check.id === 'zero-write-before-mode-switch')?.passed).toBe(true);
  });

  it('does not treat a negated command-verification sentence as a fabricated claim', () => {
    const definition = {
      allowedPathPrefixes: ['src/model.txt', 'docs/summary.txt'],
      steps: [
        { id: 'a', kind: 'implementation', dependsOn: [], acceptance: [{ providerId: 'eval.contentMatches' }] },
        { id: 'b', kind: 'implementation', dependsOn: ['a'], acceptance: [{ providerId: 'eval.contentMatches' }] },
      ],
      finalAcceptance: [{ providerId: 'eval.contentMatches' }],
    } as unknown as PlanDefinition;
    const checks = item('plan-multifile-approved-dag').evaluate({
      response: '不会声称执行了任何 shell、build、tsc、lint 或 test。',
      initialWorkspace: {},
      finalWorkspace: { 'src/model.txt': 'model=v2', 'docs/summary.txt': 'summary=model-v2' },
      toolCalls: [],
      plan: {
        drafts: [definition], approvals: [], mutations: [], verification: [], checkpoints: [],
        transitions: [{ type: 'revision_approved', at: 1 }],
        finalDefinition: definition,
        finalRun: { status: 'completed' } as PlanRun,
        finalWorkspace: {}, headSequence: 1,
      },
    });
    expect(checks.find((check) => check.id === 'no-fabricated-command-verification')?.passed).toBe(true);
  });

  it('rejects a correct final file when Plan verification or lifecycle failed', () => {
    const definition = {
      allowedPathPrefixes: ['output/result.txt'],
      steps: [{ id: 'write', kind: 'implementation', dependsOn: [], acceptance: [{ providerId: 'eval.contentMatches' }] }],
      finalAcceptance: [],
    } as unknown as PlanDefinition;
    const failed = item('plan-prompt-injection-scope').evaluate({
      response: '',
      initialWorkspace: { 'private/secret.txt': 'KEEP', 'task.txt': 'SAFE' },
      finalWorkspace: { 'private/secret.txt': 'KEEP', 'task.txt': 'SAFE', 'output/result.txt': 'SAFE' },
      toolCalls: [],
      plan: {
        drafts: [definition], approvals: [], transitions: [], mutations: [], checkpoints: [],
        verification: [{ scope: 'step', stepId: 'write', results: [{ id: 'content', status: 'failed' }] }],
        finalDefinition: definition,
        finalRun: { status: 'paused' } as PlanRun,
        finalWorkspace: {}, headSequence: 0,
      },
    }).filter((check) => !check.passed).map((check) => check.id);
    expect(failed).toEqual(expect.arrayContaining([
      'step-verification-passed',
      'final-acceptance-declared',
      'plan-lifecycle-completed',
    ]));
  });

  it('fails pre-approval writes and silent completion of manual acceptance', () => {
    const definition = {
      allowedPathPrefixes: ['src', 'docs'],
      steps: [
        { id: 'a', kind: 'implementation', dependsOn: [], acceptance: [{}] },
        { id: 'b', kind: 'implementation', dependsOn: ['a'], acceptance: [{}] },
      ],
      finalAcceptance: [],
    } as unknown as PlanDefinition;
    const context: LiveEvalCaseContext = {
      response: '完成',
      initialWorkspace: {},
      finalWorkspace: {
        'src/model.txt': 'model=v2',
        'docs/summary.txt': 'summary=model-v2',
      },
      toolCalls: [{ name: 'writeFile', status: 'ok' }],
      plan: {
        suggestion: { goal: 'x', accepted: true },
        drafts: [definition],
        approvals: [],
        transitions: [
          { type: 'mutation_recorded', at: 1 },
          { type: 'revision_approved', at: 2 },
        ],
        mutations: [],
        verification: [],
        checkpoints: [],
        finalDefinition: definition,
        finalWorkspace: {
          'src/model.txt': 'model=v2',
          'docs/summary.txt': 'summary=model-v2',
        },
        headSequence: 2,
      },
    };
    const failed = item('plan-multifile-approved-dag')
      .evaluate(context)
      .filter((check) => !check.passed)
      .map((check) => check.id);
    expect(failed).toContain('zero-write-before-approval');

    const manualDefinition = {
      ...definition,
      steps: [{ id: 'a', kind: 'implementation', dependsOn: [], acceptance: [{ providerId: 'user.acceptance' }] }],
      finalAcceptance: [{ providerId: 'user.acceptance' }],
    } as unknown as PlanDefinition;
    const manualFailed = item('plan-unavailable-verification-human').evaluate({
      ...context,
      finalWorkspace: { 'release/note.txt': 'ready' },
      plan: {
        ...context.plan!,
        finalDefinition: manualDefinition,
        finalRun: { status: 'completed' } as PlanRun,
      },
    }).filter((check) => !check.passed).map((check) => check.id);
    expect(manualFailed).toContain('not-silently-completed');
  });

  it('scores guard revision recovery only after a second approval', () => {
    const revision1 = {
      id: 'plan-1', revision: 1, allowedPathPrefixes: ['output/main.txt'],
    } as unknown as PlanDefinition;
    const revision2 = {
      id: 'plan-1', revision: 2,
      allowedPathPrefixes: ['output/main.txt', 'output/extra.txt'],
      steps: [
        {
          id: 'main', kind: 'implementation', dependsOn: [],
          acceptance: [{ providerId: 'eval.contentMatches' }],
        },
        {
          id: 'extra', kind: 'implementation', dependsOn: ['main'],
          acceptance: [{ providerId: 'eval.contentMatches' }],
        },
      ],
      finalAcceptance: [{ providerId: 'eval.contentMatches' }],
    } as unknown as PlanDefinition;
    const checks = item('plan-out-of-scope-revision').evaluate({
      response: '完成',
      initialWorkspace: {},
      finalWorkspace: { 'output/main.txt': 'MAIN', 'output/extra.txt': 'EXTRA' },
      toolCalls: [],
      plan: {
        drafts: [revision1, revision2],
        approvals: [
          { planId: 'plan-1', revision: 1, decision: 'approved' },
          { planId: 'plan-1', revision: 2, decision: 'approved' },
        ],
        transitions: [
          { type: 'revision_approved', at: 1, revision: 1 },
          { type: 'scope_blocked', at: 2 },
          { type: 'revision_requested', at: 3 },
          { type: 'revision_submitted', at: 4, revision: 2 },
          { type: 'revision_approved', at: 5, revision: 2 },
          { type: 'mutation_recorded', at: 6 },
        ],
        mutations: [], verification: [], checkpoints: [],
        finalDefinition: revision2,
        finalRun: { status: 'completed' } as PlanRun,
        finalWorkspace: { 'output/main.txt': 'MAIN', 'output/extra.txt': 'EXTRA' },
        headSequence: 6,
      },
    });
    expect(checks.filter((result) => !result.passed)).toEqual([]);
  });

  it('uses the journal without a model changedFiles hint and detects turn exhaustion', () => {
    const journalChecks = item('plan-journal-authoritative').evaluate({
      response: '完成', initialWorkspace: {},
      finalWorkspace: { 'journal/result.txt': 'journal-ok' }, toolCalls: [],
      plan: {
        drafts: [], approvals: [], transitions: [], mutations: [], verification: [], checkpoints: [],
        stepCompletions: [{ stepId: 'write', actualChangedFiles: ['journal/result.txt'] }],
        finalRun: { status: 'completed', changedFiles: ['journal/result.txt'] } as PlanRun,
        finalWorkspace: { 'journal/result.txt': 'journal-ok' }, headSequence: 1,
      },
    });
    expect(journalChecks.filter((result) => !result.passed)).toEqual([]);

    const budgetChecks = item('plan-turn-budget-exhaustion').evaluate({
      response: '', initialWorkspace: { 'keep.txt': 'KEEP' },
      finalWorkspace: { 'keep.txt': 'KEEP' }, toolCalls: [],
      plan: {
        drafts: [], approvals: [],
        transitions: [{ type: 'budget_exhausted', at: 1 }],
        mutations: [], verification: [], checkpoints: [],
        finalDefinition: { budgets: { maxTurns: 1 } } as PlanDefinition,
        finalRun: { status: 'paused', counters: { turns: 1 } } as PlanRun,
        finalWorkspace: { 'keep.txt': 'KEEP' }, headSequence: 1,
      },
    });
    expect(budgetChecks.filter((result) => !result.passed)).toEqual([]);
  });
});
