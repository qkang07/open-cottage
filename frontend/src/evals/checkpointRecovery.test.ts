import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  workspaceFiles: new Map<string, Uint8Array>(),
  cottageJson: new Map<string, unknown>(),
  checkpointObjects: new Map<string, Uint8Array>(),
}));

const cloneBytes = (bytes: Uint8Array) => new Uint8Array(bytes);

class FakeFileHandle {
  constructor(private readonly path: string) {}

  async getFile() {
    const bytes = state.checkpointObjects.get(this.path) ?? new Uint8Array();
    return {
      size: bytes.byteLength,
      arrayBuffer: async () => cloneBytes(bytes).buffer,
    };
  }

  async createWritable() {
    let next = new Uint8Array();
    return {
      write: async (bytes: Uint8Array) => {
        next = cloneBytes(bytes);
      },
      close: async () => {
        state.checkpointObjects.set(this.path, next);
      },
    };
  }
}

class FakeDirectoryHandle {
  constructor(private readonly path = '') {}

  async getDirectoryHandle(name: string) {
    return new FakeDirectoryHandle(this.path ? `${this.path}/${name}` : name);
  }

  async getFileHandle(name: string) {
    return new FakeFileHandle(this.path ? `${this.path}/${name}` : name);
  }

  async removeEntry(name: string) {
    state.checkpointObjects.delete(this.path ? `${this.path}/${name}` : name);
  }
}

vi.mock('../workspace/FileSystemWorkspace', () => ({
  workspace: {
    ensureCottageDir: async () => new FakeDirectoryHandle(),
    readCottagePath: async <T>(path: string): Promise<T | null> =>
      state.cottageJson.has(path)
        ? structuredClone(state.cottageJson.get(path)) as T
        : null,
    writeCottagePath: async (path: string, value: unknown) => {
      state.cottageJson.set(path, structuredClone(value));
    },
    listCottageFiles: async (prefix: string) => [
      ...[...state.cottageJson.keys()].filter((path) => path.startsWith(prefix)),
      ...[...state.checkpointObjects.keys()].filter((path) => path.startsWith(prefix)),
    ],
    getEntryKind: async (path: string) => {
      if (state.workspaceFiles.has(path)) return 'file';
      return [...state.workspaceFiles.keys()].some((entry) => entry.startsWith(`${path}/`))
        ? 'directory'
        : null;
    },
    listFiles: async (path: string) =>
      [...state.workspaceFiles.keys()].filter((entry) => entry.startsWith(`${path}/`)),
    statFile: async (path: string) => {
      const bytes = state.workspaceFiles.get(path);
      return bytes ? { size: bytes.byteLength, modified: 0 } : null;
    },
    readFileBytes: async (path: string) => cloneBytes(state.workspaceFiles.get(path)!),
    exists: async (path: string) =>
      state.workspaceFiles.has(path) ||
      [...state.workspaceFiles.keys()].some((entry) => entry.startsWith(`${path}/`)),
    deleteEntry: async (path: string) => {
      for (const entry of [...state.workspaceFiles.keys()]) {
        if (entry === path || entry.startsWith(`${path}/`)) state.workspaceFiles.delete(entry);
      }
    },
    mkdir: async () => undefined,
    writeFileBytes: async (path: string, bytes: Uint8Array) => {
      state.workspaceFiles.set(path, cloneBytes(bytes));
    },
  },
}));

import {
  capturePlanStepPaths,
  loadPlanStepCheckpoint,
  restorePlanStepCheckpoint,
} from '../plan/checkpoints';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const setFile = (path: string, content: string) =>
  state.workspaceFiles.set(path, encoder.encode(content));
const readFile = (path: string) => decoder.decode(state.workspaceFiles.get(path));

describe('deterministic Plan checkpoint recovery', () => {
  beforeEach(() => {
    state.workspaceFiles.clear();
    state.cottageJson.clear();
    state.checkpointObjects.clear();
  });

  it('restores a captured directory from immutable objects', async () => {
    setFile('src/a.txt', 'before-a');
    setFile('src/b.txt', 'before-b');
    await capturePlanStepPaths('plan-1', 'step-1', ['src']);

    setFile('src/a.txt', 'after-a');
    setFile('src/b.txt', 'after-b');
    setFile('src/new.txt', 'new');
    await restorePlanStepCheckpoint('plan-1', 'step-1');

    expect(readFile('src/a.txt')).toBe('before-a');
    expect(readFile('src/b.txt')).toBe('before-b');
    expect(state.workspaceFiles.has('src/new.txt')).toBe(false);
  });

  it('validates every object before deleting or overwriting any file', async () => {
    setFile('src/a.txt', 'before-a');
    setFile('src/b.txt', 'before-b');
    await capturePlanStepPaths('plan-2', 'step-1', ['src']);
    const checkpoint = await loadPlanStepCheckpoint('plan-2', 'step-1');
    const corruptId = checkpoint?.entries.find((entry) => entry.path === 'src/b.txt')?.objectId;
    expect(corruptId).toBeTruthy();
    state.checkpointObjects.set(
      `plans/v1/plan-2/checkpoints/objects/${corruptId!.slice(0, 2)}/${corruptId}`,
      encoder.encode('corrupt'),
    );

    setFile('src/a.txt', 'current-a');
    setFile('src/b.txt', 'current-b');
    await expect(restorePlanStepCheckpoint('plan-2', 'step-1')).rejects.toThrow(
      '检查点对象损坏：src/b.txt',
    );
    expect(readFile('src/a.txt')).toBe('current-a');
    expect(readFile('src/b.txt')).toBe('current-b');
  });

  it('removes a path that was missing at checkpoint time', async () => {
    await capturePlanStepPaths('plan-3', 'step-1', ['generated.txt']);
    setFile('generated.txt', 'created later');
    await restorePlanStepCheckpoint('plan-3', 'step-1');
    expect(state.workspaceFiles.has('generated.txt')).toBe(false);
  });
});
