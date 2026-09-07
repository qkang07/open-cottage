import type { LiveEvalCaseReport, LiveEvalReport } from './types';

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
      group: item.tags.includes('plan') ? 'plan' : 'agent',
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
