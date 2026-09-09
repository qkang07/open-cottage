import { describe, expect, it } from 'vitest';
import {
  compareLiveEvalReports,
  liveEvalBaselineGroupsForReport,
  selectLiveEvalReportGroup,
} from './compare';
import type { LiveEvalCaseReport, LiveEvalReport } from './types';

const evalCase = (
  caseId: string,
  passed: boolean,
  score: number,
  totalTokens: number,
  tags: string[] = [],
): LiveEvalCaseReport => ({
  caseId,
  title: caseId,
  tags,
  passed,
  score,
  checks: [],
  usage: {
    modelCalls: 1,
    durationMs: 100,
    inputTokens: totalTokens,
    outputTokens: 0,
    totalTokens,
  },
  toolCalls: [],
  changedPaths: [],
  responseExcerpt: '',
});

const report = (cases: LiveEvalCaseReport[]): LiveEvalReport => ({
  schemaVersion: 1,
  kind: 'live-model-eval',
  generatedAt: '2026-09-06T00:00:00.000Z',
  dryRun: false,
  model: { provider: 'openai', model: 'test', connectionId: 'test' },
  budget: {
    maxCases: cases.length,
    maxModelCalls: 10,
    maxTotalTokens: 10_000,
    maxDurationMs: 10_000,
    maxOutputTokens: 1_000,
  },
  selection: { caseIds: cases.map((item) => item.caseId), tags: [] },
  summary: {
    passed: cases.every((item) => item.passed),
    caseCount: cases.length,
    passedCount: cases.filter((item) => item.passed).length,
    averageScore: cases.reduce((sum, item) => sum + item.score, 0) / cases.length,
    usage: {
      modelCalls: cases.length,
      durationMs: 500,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: cases.reduce((sum, item) => sum + (item.usage.totalTokens ?? 0), 0),
    },
  },
  cases,
});

describe('compareLiveEvalReports', () => {
  it('reports improvements, regressions and metric deltas for the same cases', () => {
    const baseline = report([
      evalCase('a', false, 0.3, 100),
      evalCase('b', true, 1, 200),
      evalCase('c', true, 1, 300, ['plan']),
    ]);
    const current = report([
      evalCase('a', true, 1, 120),
      evalCase('b', false, 0.5, 180),
      evalCase('c', true, 1, 300, ['plan']),
    ]);

    const result = compareLiveEvalReports(baseline, current);

    expect(result.compatible).toBe(true);
    expect(result.metrics.totalTokens.delta).toBe(0);
    expect(result.cases.map((item) => [item.caseId, item.trend])).toEqual([
      ['a', 'improved'],
      ['b', 'regressed'],
      ['c', 'unchanged'],
    ]);
    expect(result.cases.map((item) => [item.caseId, item.group])).toEqual([
      ['a', 'agent'],
      ['b', 'agent'],
      ['c', 'plan'],
    ]);
  });

  it('rejects comparisons with different case sets', () => {
    const result = compareLiveEvalReports(
      report([evalCase('a', true, 1, 100)]),
      report([evalCase('b', true, 1, 100)]),
    );

    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('场景集合不同');
    expect(result.cases).toEqual([]);
  });

  it('splits a mixed report into independently comparable baseline groups', () => {
    const mixed = report([
      evalCase('agent-a', true, 1, 100),
      evalCase('plan-a', false, 0.5, 300, ['plan']),
    ]);

    expect(liveEvalBaselineGroupsForReport(mixed)).toEqual(['agent', 'plan']);
    const agent = selectLiveEvalReportGroup(mixed, 'agent');
    const plan = selectLiveEvalReportGroup(mixed, 'plan');
    expect(agent.selection.caseIds).toEqual(['agent-a']);
    expect(agent.summary).toMatchObject({ caseCount: 1, passedCount: 1 });
    expect(agent.summary.usage).toMatchObject({ modelCalls: 1, totalTokens: 100 });
    expect(plan.selection.caseIds).toEqual(['plan-a']);
    expect(plan.summary).toMatchObject({ caseCount: 1, passedCount: 0 });
    expect(plan.summary.usage).toMatchObject({ modelCalls: 1, totalTokens: 300 });
  });
});
