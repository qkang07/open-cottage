import { describe, expect, it } from 'vitest';
import type { LiveEvalCaseReport, LiveEvalReport } from './types';
import {
  deleteDirectoryLiveEvalBaseline,
  initializeLiveEvalRoot,
  loadDirectoryLiveEvalBaselines,
  saveDirectoryLiveEvalBaseline,
  validateEvalRootMarker,
  type DirectoryStoredLiveEvalReport,
} from './directoryWorkspace';

const createFakeDirectory = (name = 'root'): FileSystemDirectoryHandle => {
  const files = new Map<string, { text: string }>();
  const directories = new Map<string, FileSystemDirectoryHandle>();
  const handle = {
    kind: 'directory',
    name,
    async getFileHandle(fileName: string, options?: { create?: boolean }) {
      let state = files.get(fileName);
      if (!state && options?.create) {
        state = { text: '' };
        files.set(fileName, state);
      }
      if (!state) throw new Error(`missing file: ${fileName}`);
      return {
        kind: 'file',
        name: fileName,
        async getFile() {
          return { text: async () => state!.text };
        },
        async createWritable() {
          return {
            async write(value: unknown) { state!.text = String(value); },
            async close() {},
          };
        },
      };
    },
    async getDirectoryHandle(directoryName: string, options?: { create?: boolean }) {
      let directory = directories.get(directoryName);
      if (!directory && options?.create) {
        directory = createFakeDirectory(directoryName);
        directories.set(directoryName, directory);
      }
      if (!directory) throw new Error(`missing directory: ${directoryName}`);
      return directory;
    },
    async removeEntry(entryName: string) {
      if (!files.delete(entryName) && !directories.delete(entryName)) {
        throw new Error(`missing entry: ${entryName}`);
      }
    },
    async *entries() {
      for (const [entryName, directory] of directories) yield [entryName, directory];
      for (const entryName of files.keys()) {
        yield [entryName, await this.getFileHandle(entryName)];
      }
    },
  };
  return handle as unknown as FileSystemDirectoryHandle;
};

const evalCase = (caseId: string, tags: string[]): LiveEvalCaseReport => ({
  caseId,
  title: caseId,
  tags,
  passed: true,
  score: 1,
  checks: [],
  usage: { modelCalls: 1, durationMs: 10, totalTokens: 100 },
  toolCalls: [],
  changedPaths: [],
  responseExcerpt: '',
});

const mixedReport = (): LiveEvalReport => {
  const cases = [evalCase('agent-a', []), evalCase('plan-a', ['plan'])];
  return {
    schemaVersion: 1,
    kind: 'live-model-eval',
    generatedAt: '2026-09-08T00:00:00.000Z',
    dryRun: false,
    model: { provider: 'openai', model: 'test', connectionId: 'test' },
    budget: { maxCases: 2, maxModelCalls: 2, maxTotalTokens: 200, maxDurationMs: 100, maxOutputTokens: 100 },
    selection: { caseIds: cases.map((item) => item.caseId), tags: [] },
    summary: {
      passed: true, caseCount: 2, passedCount: 2, averageScore: 1,
      usage: { modelCalls: 2, durationMs: 20, totalTokens: 200 },
    },
    cases,
  };
};

const writeHandleText = async (
  directory: FileSystemDirectoryHandle,
  name: string,
  text: string,
) => {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
};

describe('live eval directory marker', () => {
  it('accepts only the dedicated root marker schema', () => {
    expect(validateEvalRootMarker({
      schemaVersion: 1,
      kind: 'open-cottage-live-eval-root',
      createdAt: '2026-09-06T00:00:00.000Z',
    })).toBe(true);
    expect(validateEvalRootMarker({ schemaVersion: 1, kind: 'other' })).toBe(false);
    expect(validateEvalRootMarker({
      schemaVersion: 1,
      kind: 'open-cottage-live-eval-root',
    })).toBe(false);
    expect(validateEvalRootMarker(null)).toBe(false);
  });

  it('stores and clears Agent and Plan baselines independently', async () => {
    const root = createFakeDirectory();
    const report = mixedReport();
    const entry: DirectoryStoredLiveEvalReport = {
      id: 'directory:batch:run-01',
      generatedAt: report.generatedAt,
      report,
      source: 'directory',
      batchId: 'batch',
      runId: 'run-01',
    };

    await saveDirectoryLiveEvalBaseline(root, entry, 'agent');
    await saveDirectoryLiveEvalBaseline(root, entry, 'plan');
    const stored = await loadDirectoryLiveEvalBaselines(root);
    expect(stored.agent?.report.cases.map((item) => item.caseId)).toEqual(['agent-a']);
    expect(stored.plan?.report.cases.map((item) => item.caseId)).toEqual(['plan-a']);

    await deleteDirectoryLiveEvalBaseline(root, 'agent');
    const remaining = await loadDirectoryLiveEvalBaselines(root);
    expect(remaining.agent).toBeUndefined();
    expect(remaining.plan?.source.reportId).toBe(entry.id);
  });

  it('loads a legacy current.json into its report groups without rewriting it', async () => {
    const root = createFakeDirectory();
    await initializeLiveEvalRoot(root);
    const baselines = await root.getDirectoryHandle('baselines');
    const report = mixedReport();
    await writeHandleText(baselines, 'current.json', JSON.stringify({
      schemaVersion: 1,
      kind: 'open-cottage-live-eval-baseline',
      updatedAt: report.generatedAt,
      source: {
        reportId: 'directory:legacy:run-01',
        generatedAt: report.generatedAt,
        batchId: 'legacy',
        runId: 'run-01',
      },
      report,
    }));

    const loaded = await loadDirectoryLiveEvalBaselines(root);
    expect(loaded.agent?.report.selection.caseIds).toEqual(['agent-a']);
    expect(loaded.plan?.report.selection.caseIds).toEqual(['plan-a']);
    const legacyHandle = await baselines.getFileHandle('current.json');
    const legacyFile = await legacyHandle.getFile();
    expect(await legacyFile.text()).toContain('open-cottage-live-eval-baseline');
  });
});
