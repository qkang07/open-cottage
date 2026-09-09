import type { LiveEvalCaseReport, LiveEvalReport } from './types';

export type LiveEvalBaselineGroup = 'agent' | 'plan';

export type LiveEvalCaseTrend =
  | 'improved'
  | 'regressed'
  | 'unchanged';

export interface LiveEvalMetricComparison {
  baseline: number;
  current: number;
  delta: number;
}

export interface LiveEvalCaseComparison {
  caseId: string;
  title: string;
  group: 'agent' | 'plan';
  trend: LiveEvalCaseTrend;
  baselinePassed: boolean;
  currentPassed: boolean;
  score: LiveEvalMetricComparison;
  totalTokens: LiveEvalMetricComparison;
}

export const liveEvalBaselineGroupForCase = (
  item: Pick<LiveEvalCaseReport, 'tags'>,
): LiveEvalBaselineGroup => Array.isArray(item.tags) && item.tags.includes('plan')
  ? 'plan'
  : 'agent';

export const liveEvalBaselineGroupsForReport = (
  report: LiveEvalReport,
): LiveEvalBaselineGroup[] => (['agent', 'plan'] as const).filter((group) =>
  report.cases.some((item) => liveEvalBaselineGroupForCase(item) === group),
);

const usageTotal = (
  cases: readonly LiveEvalCaseReport[],
  key: 'inputTokens' | 'outputTokens' | 'totalTokens' | 'reasoningTokens' | 'cachedInputTokens',
) => cases.reduce((sum, item) => sum + (item.usage[key] ?? 0), 0);

export const selectLiveEvalReportGroup = (
  report: LiveEvalReport,
  group: LiveEvalBaselineGroup,
): LiveEvalReport => {
  const cases = report.cases.filter((item) => liveEvalBaselineGroupForCase(item) === group);
  if (cases.length === 0) throw new Error(`评测报告不包含 ${group} 分组`);
  return {
    ...report,
    budget: { ...report.budget, maxCases: cases.length },
    selection: { caseIds: cases.map((item) => item.caseId), tags: [] },
    summary: {
      passed: cases.every((item) => item.passed),
      caseCount: cases.length,
      passedCount: cases.filter((item) => item.passed).length,
      averageScore: cases.reduce((sum, item) => sum + item.score, 0) / cases.length,
      usage: {
        modelCalls: cases.reduce((sum, item) => sum + item.usage.modelCalls, 0),
        durationMs: cases.reduce((sum, item) => sum + item.usage.durationMs, 0),
        inputTokens: usageTotal(cases, 'inputTokens'),
        outputTokens: usageTotal(cases, 'outputTokens'),
        totalTokens: usageTotal(cases, 'totalTokens'),
        reasoningTokens: usageTotal(cases, 'reasoningTokens'),
        cachedInputTokens: usageTotal(cases, 'cachedInputTokens'),
      },
    },
    cases,
  };
};

export interface LiveEvalReportComparison {
  compatible: boolean;
  reason?: string;
  metrics: {
    passedCount: LiveEvalMetricComparison;
    averageScore: LiveEvalMetricComparison;
    modelCalls: LiveEvalMetricComparison;
    totalTokens: LiveEvalMetricComparison;
    durationMs: LiveEvalMetricComparison;
  };
  cases: LiveEvalCaseComparison[];
}

const metric = (baseline: number, current: number): LiveEvalMetricComparison => ({
  baseline,
  current,
  delta: current - baseline,
});

const caseIds = (report: LiveEvalReport): string[] =>
  report.cases.map((item) => item.caseId).sort((a, b) => a.localeCompare(b));

const sameCaseSet = (baseline: LiveEvalReport, current: LiveEvalReport): boolean => {
  const left = caseIds(baseline);
  const right = caseIds(current);
  return left.length === right.length && left.every((id, index) => id === right[index]);
};

const caseTrend = (
  baseline: LiveEvalCaseReport,
  current: LiveEvalCaseReport,
): LiveEvalCaseTrend => {
  if (!baseline.passed && current.passed) return 'improved';
  if (baseline.passed && !current.passed) return 'regressed';
  if (current.score > baseline.score) return 'improved';
  if (current.score < baseline.score) return 'regressed';
  return 'unchanged';
};

export const compareLiveEvalReports = (
  baseline: LiveEvalReport,
  current: LiveEvalReport,
): LiveEvalReportComparison => {
  const metrics: LiveEvalReportComparison['metrics'] = {
    passedCount: metric(baseline.summary.passedCount, current.summary.passedCount),
    averageScore: metric(baseline.summary.averageScore, current.summary.averageScore),
    modelCalls: metric(
      baseline.summary.usage.modelCalls,
      current.summary.usage.modelCalls,
    ),
    totalTokens: metric(
      baseline.summary.usage.totalTokens ?? 0,
      current.summary.usage.totalTokens ?? 0,
    ),
    durationMs: metric(
      baseline.summary.usage.durationMs,
      current.summary.usage.durationMs,
    ),
  };

  if (!sameCaseSet(baseline, current)) {
    return {
      compatible: false,
      reason: '当前报告与基线的场景集合不同，不能直接比较。请使用相同场景重新运行。',
      metrics,
      cases: [],
    };
  }

  const baselineCases = new Map(baseline.cases.map((item) => [item.caseId, item]));
  const cases = current.cases.map((item): LiveEvalCaseComparison => {
    const before = baselineCases.get(item.caseId)!;
    return {
      caseId: item.caseId,
      title: item.title,
      group: liveEvalBaselineGroupForCase(item),
      trend: caseTrend(before, item),
      baselinePassed: before.passed,
      currentPassed: item.passed,
      score: metric(before.score, item.score),
      totalTokens: metric(
        before.usage.totalTokens ?? 0,
        item.usage.totalTokens ?? 0,
      ),
    };
  });

  return { compatible: true, metrics, cases };
};
