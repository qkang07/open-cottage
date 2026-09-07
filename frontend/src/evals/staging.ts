import { z } from 'zod';
import { cottageTool, type CottageTool } from '../agent/runtime/tool';
import type { ExplorerEntry } from '../workspace/explorerTypes';
import type { EntryKind } from '../workspace/FileSystemWorkspace';
import {
  StagingStore,
  StagingWorkspace,
  type PersistedStagingState,
  type StagingStatePersistence,
  type StagingWorkspaceBackend,
} from '../platform/staging';
import { EvalMemoryWorkspace } from './inMemoryWorkspace';

const encoder = new TextEncoder();

const normalizeDir = (path = ''): string =>
  path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

export const createEvalStagingBackend = (
  memory: EvalMemoryWorkspace,
): StagingWorkspaceBackend => ({
  async exists(path) {
    return memory.exists(path);
  },
  async readFile(path) {
    return { path, content: memory.readText(path) };
  },
  async getEntryKind(path): Promise<EntryKind> {
    const normalized = normalizeDir(path);
    if (memory.exists(normalized)) return 'file';
    const prefix = normalized ? `${normalized}/` : '';
    return Object.keys(memory.snapshot()).some((entry) => entry.startsWith(prefix))
      ? 'directory'
      : null;
  },
  async readFileBytes(path) {
    return encoder.encode(memory.readText(path));
  },
  async statFile(path) {
    if (!memory.exists(path)) return null;
    return { size: encoder.encode(memory.readText(path)).length, modified: 0 };
  },
  async listDirectoryContents(dirPath = ''): Promise<ExplorerEntry[]> {
    const base = normalizeDir(dirPath);
    const prefix = base ? `${base}/` : '';
    const entries = new Map<string, ExplorerEntry>();
    for (const path of Object.keys(memory.snapshot())) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const [name] = rest.split('/');
      if (!name) continue;
      const nested = rest.includes('/');
      entries.set(name, {
        name,
        path: prefix + name,
        kind: nested ? 'directory' : 'file',
        size: nested ? null : encoder.encode(memory.readText(path)).length,
        modified: 0,
        extension: nested || !name.includes('.') ? '' : (name.split('.').pop() ?? ''),
      });
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
  async writeFile(path, content) {
    memory.writeText(path, content);
  },
  async deleteFile(path) {
    memory.delete(path);
  },
  async listFiles(prefix = '') {
    const base = normalizeDir(prefix);
    return Object.keys(memory.snapshot()).filter(
      (path) => !base || path === base || path.startsWith(`${base}/`),
    );
  },
});

export class EvalStagingPersistence implements StagingStatePersistence {
  private readonly states = new Map<string, PersistedStagingState>();

  async save(sessionId: string, store: StagingStore): Promise<void> {
    const entries = store.snapshot();
    if (entries.length === 0) {
      this.states.delete(sessionId);
      return;
    }
    this.states.set(sessionId, {
      v: 1,
      status: 'pending',
      entries: structuredClone(entries),
      updatedAt: Date.now(),
    });
  }

  async load(sessionId: string): Promise<PersistedStagingState | null> {
    const state = this.states.get(sessionId);
    return state ? structuredClone(state) : null;
  }

  async clear(sessionId: string): Promise<void> {
    this.states.delete(sessionId);
  }

  pendingPaths(sessionId: string): string[] {
    return (this.states.get(sessionId)?.entries ?? [])
      .map((entry) => entry.path)
      .sort((a, b) => a.localeCompare(b));
  }
}

export const createEvalStagingRuntime = (
  memory: EvalMemoryWorkspace,
  persistence: EvalStagingPersistence,
) => {
  const store = new StagingStore();
  const stagingWorkspace = new StagingWorkspace(
    store,
    createEvalStagingBackend(memory),
  );
  return { store, stagingWorkspace, persistence };
};

export const createEvalStagingTools = (
  stagingWorkspace: StagingWorkspace,
): CottageTool[] => [
  cottageTool(
    ({ path }) => stagingWorkspace.readFile(path),
    {
      name: 'readFile',
      description: '读取确定性评测暂存工作区中的文本文件。',
      schema: z.object({ path: z.string() }),
    },
  ),
  cottageTool(
    ({ path, content }) => stagingWorkspace.writeFile(path, content),
    {
      name: 'writeFile',
      description: '将文本写入确定性评测暂存层。',
      schema: z.object({ path: z.string(), content: z.string() }),
    },
  ),
  cottageTool(
    async ({ paths }) => {
      for (const path of paths) await stagingWorkspace.deleteFile(path);
      return { deleted: paths };
    },
    {
      name: 'deleteFiles',
      description: '在确定性评测暂存层中标记删除文件。',
      schema: z.object({ paths: z.array(z.string()).min(1) }),
    },
  ),
];
