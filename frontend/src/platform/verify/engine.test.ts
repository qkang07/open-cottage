import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileContents = new Map<string, string>();
const existingPaths = new Set<string>();

vi.mock('../../workspace/FileSystemWorkspace', () => ({
  workspace: {
    exists: vi.fn((p: string) => Promise.resolve(existingPaths.has(p))),
    readFile: vi.fn(async (p: string) => ({
      path: p,
      content: fileContents.get(p) ?? '',
    })),
  },
}));

vi.mock('../../agent/runScript', () => ({
  runScriptInWorker: vi.fn(async (script: string) => {
    if (script.includes('THROW')) throw new Error('脚本爆炸');
    if (script.includes('BAD')) return { result: { ok: false } };
    return { result: { ok: true } };
  }),
}));

import { runVerify } from './engine';
import type { TaskManifest } from '../../task/types';

const setFile = (path: string, content: string) => {
  existingPaths.add(path);
  fileContents.set(path, content);
};

const manifest = (paths: string[]): TaskManifest => ({
  paths: paths.map((p) => ({ path: p })),
  updatedAt: Date.now(),
});

describe('runVerify', () => {
  beforeEach(() => {
    fileContents.clear();
    existingPaths.clear();
  });

  it('passes when all acceptance files exist', async () => {
    setFile('a.txt', 'hello');
    setFile('b.txt', 'world');
    const report = await runVerify({
      acceptanceFiles: ['a.txt', 'b.txt'],
      manifest: null,
    });
    expect(report.verdict).toBe('pass');
    expect(report.uncovered).toEqual([]);
  });

  it('fails with uncovered list when a file is missing', async () => {
    setFile('a.txt', 'hello');
    const report = await runVerify({
      acceptanceFiles: ['a.txt', 'missing.txt'],
      manifest: null,
    });
    expect(report.verdict).toBe('fail');
    expect(report.uncovered.length).toBe(1);
    expect(report.uncovered[0]).toContain('missing.txt');
  });

  it('contentContains passes/fails and supports not', async () => {
    setFile('readme.md', '# Project\nHello world');
    const ok = await runVerify({
      checks: [{ type: 'contentContains', path: 'readme.md', expected: 'Hello' }],
      manifest: null,
    });
    expect(ok.verdict).toBe('pass');

    const neg = await runVerify({
      checks: [
        {
          type: 'contentContains',
          path: 'readme.md',
          expected: 'Goodbye',
          not: true,
        },
      ],
      manifest: null,
    });
    expect(neg.verdict).toBe('pass');
  });

  it('contentMatches evaluates regex', async () => {
    setFile('config.ts', 'export const VERSION = "1.2.3";');
    const report = await runVerify({
      checks: [
        {
          type: 'contentMatches',
          path: 'config.ts',
          expected: 'VERSION\\s*=\\s*"\\d+\\.\\d+\\.\\d+"',
        },
      ],
      manifest: null,
    });
    expect(report.verdict).toBe('pass');
  });

  it('jsonField reads nested paths', async () => {
    setFile(
      'pkg.json',
      JSON.stringify({ name: 'cottage', scripts: { dev: 'vite' } }),
    );
    const report = await runVerify({
      checks: [
        {
          type: 'jsonField',
          path: 'pkg.json',
          field: 'scripts.dev',
          equals: 'vite',
        },
      ],
      manifest: null,
    });
    expect(report.verdict).toBe('pass');
  });

  it('manifestCoverage fails when a manifest path is missing', async () => {
    setFile('a.txt', 'x');
    const report = await runVerify({
      manifest: manifest(['a.txt', 'gone.txt']),
    });
    expect(report.verdict).toBe('fail');
    expect(report.uncovered[0]).toContain('gone.txt');
  });

  it('runs acceptance script and surfaces failure', async () => {
    const report = await runVerify({
      acceptanceScript: 'return { ok: true }',
      manifest: manifest([]),
    });
    expect(report.verdict).toBe('pass');
    expect(report.scriptRan).toBe(true);

    const bad = await runVerify({
      acceptanceScript: 'return { ok: false }',
      manifest: manifest([]),
    });
    expect(bad.verdict).toBe('fail');
    expect(bad.uncovered.some((u) => u.includes('脚本'))).toBe(true);
  });

  it('structured checks take precedence over legacy files', async () => {
    setFile('a.txt', 'hi');
    const report = await runVerify({
      acceptanceFiles: ['a.txt', 'ignored.txt'],
      checks: [{ type: 'fileExists', path: 'a.txt' }],
      manifest: null,
    });
    expect(report.verdict).toBe('pass');
    expect(report.checks.length).toBe(1);
  });

  it('reports unverified when no executable check exists', async () => {
    const report = await runVerify({ manifest: null });
    expect(report.verdict).toBe('unverified');
    expect(report.reason).toContain('不能视为验证通过');
  });
});
