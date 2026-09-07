import { z } from 'zod';
import { cottageTool } from '../../agent/runtime/tool';
import {
  loadDirectoryHandle,
  saveDirectoryHandle,
} from '../../workspace/workspacePersistence';
import { normalizeEvalPath } from '../inMemoryWorkspace';
import type { LiveEvalCase } from './cases';
import type { StoredLiveEvalReport } from './history';
import type { LiveEvalWorkspaceFactory, LiveEvalWorkspaceSession } from './runner';
import type { LiveEvalConfig, LiveEvalReport } from './types';

const ROOT_HANDLE_ID = 'cottage:live-eval-root';
const MARKER_FILE = 'eval-workspace.json';
const BASELINE_FILE = 'current.json';
const ROOT_KIND = 'open-cottage-live-eval-root';
const ROOT_SCHEMA = 1;

interface EvalRootMarker {
  schemaVersion: 1;
  kind: typeof ROOT_KIND;
  createdAt: string;
}

export interface PreparedDirectoryRun {
  batchId: string;
  runId: string;
  createWorkspace: LiveEvalWorkspaceFactory;
  writeReport(report: LiveEvalReport): Promise<void>;
}

export interface DirectoryStoredLiveEvalReport extends StoredLiveEvalReport {
  source: 'directory';
  batchId: string;
  runId: string;
}

export interface DirectoryLiveEvalBaseline {
  schemaVersion: 1;
  kind: 'open-cottage-live-eval-baseline';
  updatedAt: string;
  source: {
    reportId: string;
    generatedAt: string;
    batchId: string;
    runId: string;
  };
  report: LiveEvalReport;
}

const readText = async (
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<string | null> => {
  try {
    const handle = await directory.getFileHandle(name);
    return await (await handle.getFile()).text();
  } catch {
    return null;
  }
};

const writeText = async (
  directory: FileSystemDirectoryHandle,
  name: string,
  text: string,
): Promise<void> => {
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
};

const getDirectory = async (
  root: FileSystemDirectoryHandle,
  parts: readonly string[],
  create = false,
): Promise<FileSystemDirectoryHandle> => {
  let current = root;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, create ? { create: true } : undefined);
  }
  return current;
};

const resolveParent = async (
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
) => {
  const normalized = normalizeEvalPath(path);
  const parts = normalized.split('/');
  const name = parts.pop()!;
  return { parent: await getDirectory(root, parts, create), name, normalized };
};

const snapshotDirectory = async (
  root: FileSystemDirectoryHandle,
): Promise<Record<string, string>> => {
  const files: Array<[string, string]> = [];
  const walk = async (directory: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, handle] of directory.entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        await walk(handle as FileSystemDirectoryHandle, path);
      } else {
        files.push([path, await (await (handle as FileSystemFileHandle).getFile()).text()]);
      }
    }
  };
  await walk(root, '');
  return Object.fromEntries(files.sort(([a], [b]) => a.localeCompare(b)));
};

const createDirectoryWorkspaceSession = (
  root: FileSystemDirectoryHandle,
): LiveEvalWorkspaceSession => ({
  snapshot: () => snapshotDirectory(root),
  tools: [
    cottageTool(
      async ({ path }) => {
        const { parent, name, normalized } = await resolveParent(root, path, false);
        const content = await readText(parent, name);
        if (content === null) throw new Error(`文件不存在：${normalized}`);
        return { path: normalized, content };
      },
      {
        name: 'readFile',
        description: '读取隔离真实目录评测工作区中的文本文件。',
        schema: z.object({ path: z.string() }),
      },
    ),
    cottageTool(
      async ({ path, content }) => {
        const { parent, name, normalized } = await resolveParent(root, path, true);
        await writeText(parent, name, content);
        return { path: normalized, written: true };
      },
      {
        name: 'writeFile',
        description: '写入隔离真实目录评测工作区中的文本文件。',
        schema: z.object({ path: z.string(), content: z.string() }),
      },
    ),
    cottageTool(
      async ({ paths }) => {
        const deleted: string[] = [];
        for (const path of paths) {
          const { parent, name, normalized } = await resolveParent(root, path, false);
          try {
            await parent.removeEntry(name, { recursive: true });
            deleted.push(normalized);
          } catch {
            // Missing paths are reported as not deleted, matching the memory adapter.
          }
        }
        return { deleted };
      },
      {
        name: 'deleteFiles',
        description: '删除隔离真实目录评测工作区中的文件。',
        schema: z.object({ paths: z.array(z.string()).min(1) }),
      },
    ),
  ],
});

const writeFixture = async (
  root: FileSystemDirectoryHandle,
  files: Record<string, string>,
) => {
  for (const [path, content] of Object.entries(files)) {
    const { parent, name } = await resolveParent(root, path, true);
    await writeText(parent, name, content);
  }
};

export const validateEvalRootMarker = (value: unknown): value is EvalRootMarker => {
  if (!value || typeof value !== 'object') return false;
  const marker = value as Partial<EvalRootMarker>;
  return marker.schemaVersion === ROOT_SCHEMA &&
    marker.kind === ROOT_KIND &&
    typeof marker.createdAt === 'string';
};

const isLiveEvalReport = (value: unknown): value is LiveEvalReport => {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<LiveEvalReport>;
  return report.kind === 'live-model-eval' &&
    report.schemaVersion === 1 &&
    typeof report.generatedAt === 'string' &&
    Boolean(report.model && typeof report.model.model === 'string') &&
    Boolean(
      report.summary &&
      typeof report.summary.passed === 'boolean' &&
      typeof report.summary.caseCount === 'number' &&
      typeof report.summary.passedCount === 'number' &&
      report.summary.usage &&
      typeof report.summary.usage.modelCalls === 'number',
    ) &&
    Array.isArray(report.cases);
};

export const initializeLiveEvalRoot = async (
  root: FileSystemDirectoryHandle,
): Promise<void> => {
  const markerText = await readText(root, MARKER_FILE);
  if (markerText !== null) {
    let marker: unknown;
    try {
      marker = JSON.parse(markerText);
    } catch {
      throw new Error('所选目录的评测标记无法解析，请选择其他空目录');
    }
    if (!validateEvalRootMarker(marker)) {
      throw new Error('所选目录不是兼容的 Open Cottage 评测目录');
    }
  } else {
    const entries: string[] = [];
    for await (const [name] of root.entries()) entries.push(name);
    if (entries.length > 0) {
      throw new Error('首次初始化只允许选择空目录，避免误用项目或个人文件夹');
    }
    const marker: EvalRootMarker = {
      schemaVersion: ROOT_SCHEMA,
      kind: ROOT_KIND,
      createdAt: new Date().toISOString(),
    };
    await writeText(root, MARKER_FILE, `${JSON.stringify(marker, null, 2)}\n`);
  }
  await root.getDirectoryHandle('fixtures', { create: true });
  await root.getDirectoryHandle('runs', { create: true });
  await root.getDirectoryHandle('baselines', { create: true });
};

export const rememberLiveEvalRoot = (handle: FileSystemDirectoryHandle) =>
  saveDirectoryHandle(ROOT_HANDLE_ID, handle);

export const restoreLiveEvalRoot = async (): Promise<FileSystemDirectoryHandle | null> => {
  const handle = await loadDirectoryHandle(ROOT_HANDLE_ID);
  if (!handle) return null;
  const permission = await handle.queryPermission({ mode: 'readwrite' });
  return permission === 'granted' ? handle : null;
};

export const createLiveEvalBatchId = (): string =>
  `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}`;

export const prepareDirectoryRun = async (
  root: FileSystemDirectoryHandle,
  batchId: string,
  runNumber: number,
  config: LiveEvalConfig,
): Promise<PreparedDirectoryRun> => {
  await initializeLiveEvalRoot(root);
  const runId = `run-${String(runNumber).padStart(2, '0')}`;
  const fixturesRoot = await root.getDirectoryHandle('fixtures', { create: true });
  const runRoot = await getDirectory(root, ['runs', batchId, runId], true);
  const casesRoot = await runRoot.getDirectoryHandle('cases', { create: true });
  await writeText(runRoot, 'run.json', `${JSON.stringify({
    schemaVersion: 1,
    kind: 'open-cottage-live-eval-run',
    batchId,
    runId,
    createdAt: new Date().toISOString(),
    model: { provider: config.provider, model: config.model, connectionId: config.connectionId },
    selection: { caseIds: config.caseIds, tags: config.tags },
    budget: config.budget,
    minimumScore: config.minimumScore,
  }, null, 2)}\n`);

  const createWorkspace: LiveEvalWorkspaceFactory = async (item: LiveEvalCase) => {
    const fixture = await fixturesRoot.getDirectoryHandle(item.id, { create: true });
    await writeFixture(fixture, item.workspace);
    const caseRoot = await casesRoot.getDirectoryHandle(item.id, { create: true });
    const workspace = await caseRoot.getDirectoryHandle('workspace', { create: true });
    await writeFixture(workspace, item.workspace);
    return createDirectoryWorkspaceSession(workspace);
  };

  return {
    batchId,
    runId,
    createWorkspace,
    writeReport: (report) =>
      writeText(runRoot, 'report.json', `${JSON.stringify(report, null, 2)}\n`),
  };
};

export const loadDirectoryLiveEvalHistory = async (
  root: FileSystemDirectoryHandle,
): Promise<DirectoryStoredLiveEvalReport[]> => {
  const results: DirectoryStoredLiveEvalReport[] = [];
  let runs: FileSystemDirectoryHandle;
  try {
    runs = await root.getDirectoryHandle('runs');
  } catch {
    return [];
  }
  for await (const [batchId, batchHandle] of runs.entries()) {
    if (batchHandle.kind !== 'directory') continue;
    for await (const [runId, runHandle] of (batchHandle as FileSystemDirectoryHandle).entries()) {
      if (runHandle.kind !== 'directory') continue;
      const text = await readText(runHandle as FileSystemDirectoryHandle, 'report.json');
      if (!text) continue;
      try {
        const report: unknown = JSON.parse(text);
        if (!isLiveEvalReport(report)) continue;
        results.push({
          id: `directory:${batchId}:${runId}`,
          generatedAt: report.generatedAt,
          report,
          source: 'directory',
          batchId,
          runId,
        });
      } catch {
        // Ignore incomplete or manually edited reports; other runs remain readable.
      }
    }
  }
  return results
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
    .slice(0, 50);
};

export const deleteDirectoryLiveEvalRun = async (
  root: FileSystemDirectoryHandle,
  entry: DirectoryStoredLiveEvalReport,
): Promise<void> => {
  const batch = await getDirectory(root, ['runs', entry.batchId]);
  await batch.removeEntry(entry.runId, { recursive: true });
};

export const loadDirectoryLiveEvalBaseline = async (
  root: FileSystemDirectoryHandle,
): Promise<DirectoryLiveEvalBaseline | null> => {
  let baselines: FileSystemDirectoryHandle;
  try {
    baselines = await root.getDirectoryHandle('baselines');
  } catch {
    return null;
  }
  const text = await readText(baselines, BASELINE_FILE);
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('目录基线 baselines/current.json 无法解析');
  }
  if (!value || typeof value !== 'object') {
    throw new Error('目录基线 baselines/current.json 格式不兼容');
  }
  const baseline = value as Partial<DirectoryLiveEvalBaseline>;
  if (
    baseline.schemaVersion !== 1 ||
    baseline.kind !== 'open-cottage-live-eval-baseline' ||
    typeof baseline.updatedAt !== 'string' ||
    !baseline.source ||
    typeof baseline.source.reportId !== 'string' ||
    typeof baseline.source.generatedAt !== 'string' ||
    typeof baseline.source.batchId !== 'string' ||
    typeof baseline.source.runId !== 'string' ||
    !isLiveEvalReport(baseline.report)
  ) throw new Error('目录基线 baselines/current.json 格式不兼容');
  return baseline as DirectoryLiveEvalBaseline;
};

export const saveDirectoryLiveEvalBaseline = async (
  root: FileSystemDirectoryHandle,
  entry: DirectoryStoredLiveEvalReport,
): Promise<DirectoryLiveEvalBaseline> => {
  await initializeLiveEvalRoot(root);
  // UI 历史条目可能是 Vue 响应式 Proxy，structuredClone 无法克隆 Proxy。
  // 基线最终以 JSON 保存，因此按相同序列化边界生成纯数据快照。
  const reportSnapshot: unknown = JSON.parse(JSON.stringify(entry.report));
  if (!isLiveEvalReport(reportSnapshot)) {
    throw new Error('无法保存基线：评测报告格式不兼容');
  }
  const baseline: DirectoryLiveEvalBaseline = {
    schemaVersion: 1,
    kind: 'open-cottage-live-eval-baseline',
    updatedAt: new Date().toISOString(),
    source: {
      reportId: entry.id,
      generatedAt: entry.generatedAt,
      batchId: entry.batchId,
      runId: entry.runId,
    },
    report: reportSnapshot,
  };
  const baselines = await root.getDirectoryHandle('baselines', { create: true });
  await writeText(baselines, BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
  return baseline;
};

export const deleteDirectoryLiveEvalBaseline = async (
  root: FileSystemDirectoryHandle,
): Promise<void> => {
  const baselines = await root.getDirectoryHandle('baselines', { create: true });
  try {
    await baselines.removeEntry(BASELINE_FILE);
  } catch {
    // Clearing an already missing baseline is idempotent.
  }
};
