import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReplayModelController } from '../agent/runtime/replay';
import { CORE_AGENT_EVAL_BASELINE } from './baseline';
import { CORE_AGENT_EVAL_SCENARIOS } from './scenarios';
import { formatAgentEvalReport, runAgentEvalScenario } from './runner';
import { installEvalWebLocks } from './runtime';
import { evalSelectionFromEnv, selectAgentEvalScenarios } from './selection';
import type { AgentEvalReport, AgentEvalSuiteReport } from './types';

const selection = evalSelectionFromEnv();
const selectedScenarios = selectAgentEvalScenarios(
  CORE_AGENT_EVAL_SCENARIOS,
  selection,
);
const reports: AgentEvalReport[] = [];
const startedAt = Date.now();

const writeRunArtifacts = () => {
  const passedCount = reports.filter((report) => report.passed).length;
  const suite: AgentEvalSuiteReport = {
    schemaVersion: 1,
    passed: passedCount === reports.length && reports.length === selectedScenarios.length,
    scenarioCount: reports.length,
    passedCount,
    failedCount: reports.length - passedCount,
    durationMs: Date.now() - startedAt,
    reports,
  };
  const reportPath = resolve(
    process.env.COTTAGE_EVAL_REPORT ?? '.artifacts/evals/report.json',
  );
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      selection,
      baseline: CORE_AGENT_EVAL_BASELINE,
      suite,
    }, null, 2)}\n`,
  );

  const failures = reports.filter((report) => !report.passed);
  const failureDir = resolve(dirname(reportPath), 'failures');
  mkdirSync(failureDir, { recursive: true });
  writeFileSync(
    resolve(failureDir, 'index.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      scenarioIds: failures.map((report) => report.scenarioId),
    }, null, 2)}\n`,
  );
  for (const report of failures) {
    writeFileSync(
      resolve(failureDir, `${report.scenarioId}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
};

describe('Phase 1 deterministic Agent eval harness', () => {
  beforeAll(() => installEvalWebLocks());
  afterAll(writeRunArtifacts);

  it('matches the committed scenario baseline', () => {
    const ids = CORE_AGENT_EVAL_SCENARIOS.map((scenario) => scenario.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...CORE_AGENT_EVAL_BASELINE.scenarioIds]);
  });

  it('keeps regression provenance unique and actionable', () => {
    const regressions = CORE_AGENT_EVAL_SCENARIOS
      .map((scenario) => scenario.regression)
      .filter((item) => item !== undefined);
    expect(regressions.length).toBeGreaterThan(0);
    expect(new Set(regressions.map((item) => item.id)).size).toBe(regressions.length);
    for (const regression of regressions) {
      expect(regression.symptom.trim()).not.toBe('');
      expect(regression.invariant.trim()).not.toBe('');
    }
  });

  it('selects at least one scenario', () => {
    expect(selectedScenarios.length, `没有场景匹配筛选条件：${JSON.stringify(selection)}`).toBeGreaterThan(0);
  });

  for (const scenario of selectedScenarios) {
    it(scenario.id, async () => {
      const report = await runAgentEvalScenario(scenario);
      reports.push(report);
      expect(report.passed, formatAgentEvalReport(report)).toBe(true);
    });
  }
});

describe('replay model controller', () => {
  it('captures requests and detects unconsumed fixtures', async () => {
    const controller = createReplayModelController({
      streams: [
        [{ type: 'finish', finishReason: 'stop' }],
        [{ type: 'finish', finishReason: 'stop' }],
      ],
    });
    for await (const _event of controller.driver.stream({ messages: [] })) {
      // consume the first stream
    }
    expect(controller.calls).toHaveLength(1);
    expect(() => controller.assertExhausted()).toThrow('not fully consumed');
  });
});
