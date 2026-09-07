import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createChatModel } from '../../agent/createModel';
import { createLiveEvalBudgetedModel } from './budget';
import { loadLiveEvalConfig, validateLiveEvalConfig } from './config';
import { runLiveEvalSuite } from './runner';
import type { LiveEvalReport } from './types';
import { installEvalWebLocks } from '../runtime';

const config = loadLiveEvalConfig();
const configurationErrors = validateLiveEvalConfig(config);

const writeReport = (report: LiveEvalReport) => {
  const path = resolve(config.reportPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
};

describe('live model eval', () => {
  it('has an explicit and bounded configuration', () => {
    expect(configurationErrors).toEqual([]);
  });

  if (config.dryRun) {
    it('validates configuration without sending a model request', () => {
      const report: LiveEvalReport = {
        schemaVersion: 1,
        kind: 'live-model-eval',
        generatedAt: new Date().toISOString(),
        dryRun: true,
        model: {
          provider: config.provider,
          model: config.model,
          connectionId: config.connectionId,
          ...(config.baseUrl ? { baseUrl: '[custom-base-url]' } : {}),
        },
        budget: config.budget,
        selection: { caseIds: config.caseIds, tags: config.tags },
        summary: {
          passed: configurationErrors.length === 0,
          caseCount: 0,
          passedCount: 0,
          averageScore: 0,
          usage: {
            modelCalls: 0,
            durationMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          },
        },
        cases: [],
        ...(configurationErrors.length ? { configurationErrors } : {}),
      };
      writeReport(report);
      expect(report.summary.usage.modelCalls).toBe(0);
    });
  } else {
    it(
      'runs the selected cases against the configured model',
      async () => {
        installEvalWebLocks();
        const rawModel = createChatModel(
          {
            provider: config.provider,
            connectionId: config.connectionId,
            model: config.model,
            maxTokens: config.budget.maxOutputTokens,
            ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
          },
          {
            id: config.connectionId,
            apiKey: config.apiKey,
            ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
          },
        );
        const budgeted = createLiveEvalBudgetedModel(rawModel, config.budget);
        const report = await runLiveEvalSuite({
          config,
          model: budgeted.model,
          usageSnapshot: budgeted.snapshot,
          callsSnapshot: budgeted.callsSnapshot,
          setModelPhase: budgeted.setPhase,
          getBudgetViolation: budgeted.getViolation,
        });
        writeReport(report);
        expect(report.summary.passed, JSON.stringify(report.cases, null, 2)).toBe(true);
      },
      config.budget.maxDurationMs + 15_000,
    );
  }
});
