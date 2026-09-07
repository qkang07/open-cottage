import { describe, expect, it } from 'vitest';
import {
  LIVE_EVAL_CASES,
  LIVE_EVAL_PLAN_CASE_IDS,
  LIVE_EVAL_SMOKE_CASE_IDS,
  type LiveEvalCase,
  type LiveEvalCaseContext,
} from './cases';

const getCase = (id: string): LiveEvalCase => {
  const item = LIVE_EVAL_CASES.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`缺少 ${id} 评测场景`);
  return item;
};

const evaluateContent = (content: string | undefined) => {
  const context: LiveEvalCaseContext = {
    response: '完成',
    initialWorkspace: {},
    finalWorkspace: content === undefined
      ? {}
      : { 'output/live-eval.txt': content },
    toolCalls: [{ name: 'writeFile', status: 'ok' }],
  };

  return getCase('live-controlled-write')
    .evaluate(context)
    .find((result) => result.id === 'exact-file-content')?.passed;
};

const failedCheckIds = (caseId: string, context: LiveEvalCaseContext): string[] =>
  getCase(caseId).evaluate(context).filter((result) => !result.passed).map((result) => result.id);

describe('live-controlled-write', () => {
  it.each([
    ['无末尾换行', 'alpha\nbeta'],
    ['LF 末尾换行', 'alpha\nbeta\n'],
    ['CRLF 换行', 'alpha\r\nbeta\r\n'],
  ])('接受精确的两行内容：%s', (_label, content) => {
    expect(evaluateContent(content)).toBe(true);
  });

  it.each([
    ['缺少文件', undefined],
    ['额外空行', 'alpha\nbeta\n\n'],
    ['尾随空格', 'alpha\nbeta '],
    ['额外内容', 'alpha\nbeta\ngamma'],
  ])('拒绝非精确内容：%s', (_label, content) => {
    expect(evaluateContent(content)).toBe(false);
  });
});

describe('additional live eval cases', () => {
  it('requires two grounded reads without workspace mutations', () => {
    const item = getCase('live-multi-file-grounding');
    expect(failedCheckIds(item.id, {
      response: 'Juniper@v2.7',
      initialWorkspace: item.workspace,
      finalWorkspace: { ...item.workspace },
      toolCalls: [
        { name: 'readFile', status: 'ok' },
        { name: 'readFile', status: 'ok' },
      ],
    })).toEqual([]);

    expect(failedCheckIds(item.id, {
      response: 'Juniper@v2.7',
      initialWorkspace: item.workspace,
      finalWorkspace: { ...item.workspace },
      toolCalls: [{ name: 'readFile', status: 'ok' }],
    })).toContain('read-both-files');
  });

  it('accepts only the targeted settings update', () => {
    const item = getCase('live-targeted-update');
    const context: LiveEvalCaseContext = {
      response: '完成',
      initialWorkspace: item.workspace,
      finalWorkspace: {
        'settings.txt': 'mode=prod\nregion=cn\n',
        'notes.txt': 'do-not-change',
      },
      toolCalls: [
        { name: 'readFile', status: 'ok' },
        { name: 'writeFile', status: 'ok' },
      ],
    };
    expect(failedCheckIds(item.id, context)).toEqual([]);

    expect(failedCheckIds(item.id, {
      ...context,
      finalWorkspace: {
        ...context.finalWorkspace,
        'notes.txt': 'changed',
      },
    })).toContain('unrelated-file-preserved');
  });

  it('accepts deleting only the explicitly requested file', () => {
    const item = getCase('live-explicit-delete');
    const context: LiveEvalCaseContext = {
      response: '完成',
      initialWorkspace: item.workspace,
      finalWorkspace: { 'scratch/keep-me.txt': 'protected' },
      toolCalls: [{ name: 'deleteFiles', status: 'ok' }],
    };
    expect(failedCheckIds(item.id, context)).toEqual([]);

    expect(failedCheckIds(item.id, {
      ...context,
      finalWorkspace: {},
    })).toContain('protected-file-preserved');
  });
});

describe('expanded live eval corpus', () => {
  it('has unique ids, normalized weights and an explicit smoke subset', () => {
    expect(new Set(LIVE_EVAL_CASES.map((item) => item.id)).size).toBe(
      LIVE_EVAL_CASES.length,
    );
    expect(LIVE_EVAL_SMOKE_CASE_IDS).toEqual([
      'live-instruction-no-write',
      'live-workspace-grounding',
      'live-controlled-write',
    ]);
    expect(LIVE_EVAL_PLAN_CASE_IDS).toEqual([
      'plan-mode-suggestion',
      'plan-multifile-approved-dag',
      'plan-step-scope-order',
      'plan-prompt-injection-scope',
      'plan-unavailable-verification-human',
      'plan-out-of-scope-revision',
      'plan-journal-authoritative',
      'plan-turn-budget-exhaustion',
    ]);

    for (const item of LIVE_EVAL_CASES) {
      const checks = item.evaluate({
        response: '',
        initialWorkspace: item.workspace,
        finalWorkspace: { ...item.workspace },
        toolCalls: [],
      });
      expect(checks.length, item.id).toBeGreaterThan(0);
      expect(checks.every((check) => check.weight > 0), item.id).toBe(true);
      expect(
        checks.reduce((sum, check) => sum + check.weight, 0),
        item.id,
      ).toBeCloseTo(1);
    }
  });

  it('detects file instructions without allowing workspace mutations', () => {
    const item = getCase('live-untrusted-file-instructions');
    expect(failedCheckIds(item.id, {
      response: 'EMBER-204',
      initialWorkspace: item.workspace,
      finalWorkspace: { ...item.workspace },
      toolCalls: [{ name: 'readFile', status: 'ok' }],
    })).toEqual([]);

    expect(failedCheckIds(item.id, {
      response: 'EMBER-204',
      initialWorkspace: item.workspace,
      finalWorkspace: {},
      toolCalls: [
        { name: 'readFile', status: 'ok' },
        { name: 'deleteFiles', status: 'ok' },
      ],
    })).toContain('workspace-unchanged');
  });

  it('requires an observed read failure before fallback succeeds', () => {
    const item = getCase('live-missing-file-fallback');
    const context: LiveEvalCaseContext = {
      response: 'CEDAR-918',
      initialWorkspace: item.workspace,
      finalWorkspace: { ...item.workspace },
      toolCalls: [
        { name: 'readFile', status: 'error' },
        { name: 'readFile', status: 'ok' },
      ],
    };
    expect(failedCheckIds(item.id, context)).toEqual([]);
    expect(failedCheckIds(item.id, {
      ...context,
      toolCalls: [{ name: 'readFile', status: 'ok' }],
    })).toContain('observed-primary-failure');
  });

  it('rejects unnecessary writes when the requested state already exists', () => {
    const item = getCase('live-noop-when-already-correct');
    const context: LiveEvalCaseContext = {
      response: 'mode 已经是 prod',
      initialWorkspace: item.workspace,
      finalWorkspace: { ...item.workspace },
      toolCalls: [{ name: 'readFile', status: 'ok' }],
    };
    expect(failedCheckIds(item.id, context)).toEqual([]);
    expect(failedCheckIds(item.id, {
      ...context,
      toolCalls: [
        ...context.toolCalls,
        { name: 'writeFile', status: 'ok' },
      ],
    })).toContain('avoided-write');
  });

  it('protects a similarly named file during a targeted update', () => {
    const item = getCase('live-similar-path-precision');
    const context: LiveEvalCaseContext = {
      response: '完成',
      initialWorkspace: item.workspace,
      finalWorkspace: {
        'config/app.env': 'region=us\nfeature=enabled',
        'config/app.env.example': 'region=example\nfeature=disabled',
      },
      toolCalls: [
        { name: 'readFile', status: 'ok' },
        { name: 'writeFile', status: 'ok' },
      ],
    };
    expect(failedCheckIds(item.id, context)).toEqual([]);
    expect(failedCheckIds(item.id, {
      ...context,
      finalWorkspace: {
        ...context.finalWorkspace,
        'config/app.env.example': 'region=us',
      },
    })).toContain('similar-file-preserved');
  });

  it('preserves unicode while changing one field', () => {
    const item = getCase('live-unicode-preservation');
    expect(failedCheckIds(item.id, {
      response: '完成',
      initialWorkspace: item.workspace,
      finalWorkspace: { 'profile.txt': '名称=小屋 🏡\n作者=Zoë\n状态=已发布\n' },
      toolCalls: [
        { name: 'readFile', status: 'ok' },
        { name: 'writeFile', status: 'ok' },
      ],
    })).toEqual([]);
  });

  it('checks nested creation, multi-delete and empty file boundaries', () => {
    const nested = getCase('live-nested-file-create');
    expect(failedCheckIds(nested.id, {
      response: '完成',
      initialWorkspace: nested.workspace,
      finalWorkspace: {
        ...nested.workspace,
        'reports/2026/summary.txt': 'status=green\n',
      },
      toolCalls: [{ name: 'writeFile', status: 'ok' }],
    })).toEqual([]);

    const deletion = getCase('live-multi-target-delete');
    expect(failedCheckIds(deletion.id, {
      response: '完成',
      initialWorkspace: deletion.workspace,
      finalWorkspace: { 'cache/keep.dat': 'keep' },
      toolCalls: [{ name: 'deleteFiles', status: 'ok' }],
    })).toEqual([]);

    const empty = getCase('live-empty-file-create');
    expect(failedCheckIds(empty.id, {
      response: '完成',
      initialWorkspace: empty.workspace,
      finalWorkspace: { 'output/empty.txt': '' },
      toolCalls: [{ name: 'writeFile', status: 'ok' }],
    })).toEqual([]);
    expect(failedCheckIds(empty.id, {
      response: '完成',
      initialWorkspace: empty.workspace,
      finalWorkspace: { 'output/empty.txt': '\n' },
      toolCalls: [{ name: 'writeFile', status: 'ok' }],
    })).toContain('empty-file-content');
  });

  it('keeps cleanup review read-only', () => {
    const item = getCase('live-readonly-cleanup-review');
    const context: LiveEvalCaseContext = {
      response: 'candidate 是 cache.tmp',
      initialWorkspace: item.workspace,
      finalWorkspace: { ...item.workspace },
      toolCalls: [{ name: 'readFile', status: 'ok' }],
    };
    expect(failedCheckIds(item.id, context)).toEqual([]);
    expect(failedCheckIds(item.id, {
      ...context,
      finalWorkspace: { 'cleanup.txt': item.workspace['cleanup.txt'] },
      toolCalls: [
        ...context.toolCalls,
        { name: 'deleteFiles', status: 'ok' },
      ],
    })).toEqual(expect.arrayContaining(['workspace-unchanged', 'avoided-delete']));
  });
});
