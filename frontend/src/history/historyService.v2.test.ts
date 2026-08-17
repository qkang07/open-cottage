import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  files: new Map<string, { bytes: Uint8Array; modified: number }>(),
  history: new Map<string, Uint8Array>(),
  config: {
    history: {
      enabled: true,
      autoCheckpoint: true,
      manualEditDebounceMs: 1500,
      trackGlobs: ['**'],
      ignoreGlobs: [],
      maxTrackedFiles: 100,
      limits: {
        maxFileBytes: 20 * 1024 * 1024,
        maxBytesPerFile: 100 * 1024 * 1024,
        maxPoolBytes: 500 * 1024 * 1024,
      },
    },
  },
}));

const copy = (bytes: Uint8Array) => new Uint8Array(bytes);
const objectPath = (id: string) => `objects/${id.slice(0, 2)}/${id}`;

vi.mock('../config/store', () => ({
  getCottageConfig: () => fixture.config,
}));

vi.mock('../workspace/FileSystemWorkspace', () => ({
  workspace: {
    isOpen: true,
    listFiles: async () => [...fixture.files.keys()].sort(),
    statFile: async (path: string) => {
      const file = fixture.files.get(path);
      return file
        ? { path, size: file.bytes.byteLength, modified: file.modified }
        : null;
    },
    readFileBytes: async (path: string) =>
      copy(fixture.files.get(path)?.bytes ?? new Uint8Array()),
    writeFileBytes: async (path: string, bytes: Uint8Array) => {
      fixture.files.set(path, { bytes: copy(bytes), modified: Date.now() });
    },
    deleteFile: async (path: string) => {
      fixture.files.delete(path);
    },
  },
}));

vi.mock('./storage', () => ({
  historyV2Exists: async () => fixture.history.size > 0,
  readHistoryJson: async <T>(path: string): Promise<T | null> => {
    const bytes = fixture.history.get(path);
    return bytes ? JSON.parse(new TextDecoder().decode(bytes)) as T : null;
  },
  writeHistoryJson: async (path: string, value: unknown) => {
    fixture.history.set(path, new TextEncoder().encode(JSON.stringify(value)));
  },
  deleteHistoryPath: async (path: string) => fixture.history.delete(path),
  listHistoryFiles: async (prefix = '') =>
    [...fixture.history.keys()].filter((path) => !prefix || path.startsWith(`${prefix}/`)),
  historyFileSize: async (path: string) => fixture.history.get(path)?.byteLength ?? 0,
  hashBytes: async (bytes: Uint8Array) => {
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  },
  ensureHistoryObject: async (id: string, bytes: Uint8Array) => {
    if (!fixture.history.has(objectPath(id))) fixture.history.set(objectPath(id), copy(bytes));
  },
  readHistoryObject: async (id: string) => {
    const bytes = fixture.history.get(objectPath(id));
    return bytes ? copy(bytes) : null;
  },
  deleteHistoryObject: async (id: string) => fixture.history.delete(objectPath(id)),
}));

import {
  captureHistoryVersion,
  deleteFileHistoryRevision,
  deleteHistoryVersion,
  getHistoryPoolStats,
  initializeHistory,
  listFileHistory,
  listHistoryVersions,
  loadHistoryMeta,
  loadHistorySnapshot,
  readFileVersionBytes,
  resetHistoryService,
  restoreFile,
  restoreTree,
} from './historyService';

const put = (path: string, bytes: number[], modified = Date.now()) => {
  fixture.files.set(path, { bytes: new Uint8Array(bytes), modified });
};

beforeEach(() => {
  fixture.files.clear();
  fixture.history.clear();
  fixture.config.history.enabled = true;
  fixture.config.history.maxTrackedFiles = 100;
  fixture.config.history.limits = {
    maxFileBytes: 20 * 1024 * 1024,
    maxBytesPerFile: 100 * 1024 * 1024,
    maxPoolBytes: 500 * 1024 * 1024,
  };
  resetHistoryService();
});

describe('history v2 object storage', () => {
  it('keeps binary bytes unchanged and deduplicates identical content', async () => {
    put('a.bin', [0, 255, 1, 128], 1);
    put('b.bin', [0, 255, 1, 128], 1);

    await initializeHistory();
    const [version] = await listHistoryVersions();
    const bytes = await readFileVersionBytes(version.id, 'a.bin');
    const stats = await getHistoryPoolStats();
    const index = JSON.parse(
      new TextDecoder().decode(fixture.history.get('index.json')),
    ) as { fileHistory: Record<string, string[]>; objectRefs: Record<string, { count: number }> };

    expect([...bytes!]).toEqual([0, 255, 1, 128]);
    expect(stats.objectCount).toBe(1);
    expect(index.fileHistory['a.bin']).toHaveLength(1);
    expect(Object.values(index.objectRefs)[0].count).toBe(2);
  });

  it('rebuilds a missing index from base and version records', async () => {
    put('note.txt', [65], 1);
    await initializeHistory();
    put('note.txt', [66], 2);
    await captureHistoryVersion(['note.txt'], 'second', 'manual');
    fixture.history.delete('index.json');

    expect(await listHistoryVersions()).toHaveLength(2);
    expect(fixture.history.has('index.json')).toBe(true);
  });

  it('recovers a version record committed before an interrupted index update', async () => {
    put('note.txt', [65], 1);
    await initializeHistory();
    fixture.history.set(
      'versions/interrupted.json',
      new TextEncoder().encode(JSON.stringify({
        schema: 2,
        id: 'interrupted',
        at: Date.now() + 1,
        source: 'manual',
        label: 'interrupted',
        changes: {},
        changeTypes: {},
      })),
    );

    expect(await listHistoryVersions()).toHaveLength(2);
  });

  it('collects unreferenced objects during initialization', async () => {
    fixture.history.set('objects/aa/aa-orphan', new Uint8Array([9]));
    put('note.txt', [65], 1);

    await initializeHistory();
    expect(fixture.history.has('objects/aa/aa-orphan')).toBe(false);
  });
});

describe('history v2 version chain', () => {
  it('compacts a deleted middle version without changing the later snapshot', async () => {
    put('note.txt', [65], 1);
    await initializeHistory();
    put('note.txt', [66], 2);
    const middle = await captureHistoryVersion(['note.txt'], 'middle', 'manual');
    put('note.txt', [67], 3);
    const latest = await captureHistoryVersion(['note.txt'], 'latest', 'manual');

    await deleteHistoryVersion(middle!);
    const snapshot = await loadHistorySnapshot(latest!);
    const state = snapshot?.files.get('note.txt');
    expect(state?.state).toBe('stored');
    if (state?.state === 'stored') {
      const bytes = await readFileVersionBytes(latest!, 'note.txt');
      expect([...bytes!]).toEqual([67]);
    }
  });

  it('marks a workspace version partial when one file revision is deleted', async () => {
    put('note.txt', [65], 1);
    await initializeHistory();
    const [version] = await listHistoryVersions();

    await deleteFileHistoryRevision('note.txt', version.id);
    const [next] = await listHistoryVersions();
    expect(next.complete).toBe(false);
    expect((await listFileHistory('note.txt'))[0].restorable).toBe(false);
  });
});

describe('history v2 quotas', () => {
  it('records an oversize event without storing its content', async () => {
    fixture.config.history.limits.maxFileBytes = 2;
    put('large.bin', [1, 2, 3], 1);

    await initializeHistory();
    const [version] = await listHistoryVersions();
    expect(version.complete).toBe(false);
    expect(await readFileVersionBytes(version.id, 'large.bin')).toBeNull();
  });

  it('protects the latest version and pauses when the pool cannot fit it', async () => {
    fixture.config.history.limits.maxPoolBytes = 1;
    put('only.bin', [1, 2, 3], 1);

    await initializeHistory();
    expect(await listHistoryVersions()).toHaveLength(1);
    expect((await loadHistoryMeta()).status).toBe('paused');
  });

  it('prunes the oldest file content while retaining its newest restorable revision', async () => {
    fixture.config.history.limits.maxBytesPerFile = 5;
    put('asset.bin', [1, 1, 1], 1);
    await initializeHistory();
    put('asset.bin', [2, 2, 2], 2);

    await captureHistoryVersion(['asset.bin'], 'second', 'manual');
    const revisions = await listFileHistory('asset.bin');
    expect(revisions[0].restorable).toBe(true);
    expect(revisions.at(-1)?.state.state).toBe('unavailable');
  });
});

describe('history v2 restore safety', () => {
  it.each(['image.png', 'document.docx', 'archive.zip'])(
    'restores raw bytes for %s and creates protection history',
    async (path) => {
    put(path, [0, 1, 255], 1);
    await initializeHistory();
    const [initial] = await listHistoryVersions();
    put(path, [9, 9], 2);
    await captureHistoryVersion([path], 'changed', 'manual');

    expect(await restoreFile(initial.id, path)).toBe(true);
    expect([...fixture.files.get(path)!.bytes]).toEqual([0, 1, 255]);
    expect((await listHistoryVersions()).length).toBeGreaterThan(2);
    },
  );

  it('blocks restore when the current file cannot fit in a protection version', async () => {
    put('archive.zip', [1], 1);
    await initializeHistory();
    const [initial] = await listHistoryVersions();
    fixture.config.history.limits.maxFileBytes = 2;
    put('archive.zip', [9, 9, 9], 2);

    await expect(restoreFile(initial.id, 'archive.zip')).rejects.toThrow('无法安全恢复');
    expect([...fixture.files.get('archive.zip')!.bytes]).toEqual([9, 9, 9]);
  });

  it('restores a historical deletion by removing the current file', async () => {
    put('removed.txt', [1], 1);
    await initializeHistory();
    fixture.files.delete('removed.txt');
    const deletedVersion = await captureHistoryVersion(
      ['removed.txt'],
      'deleted',
      'manual',
    );
    put('removed.txt', [2], 2);

    expect(await restoreFile(deletedVersion!, 'removed.txt')).toBe(true);
    expect(fixture.files.has('removed.txt')).toBe(false);
  });

  it('restores only the tracked workspace scope and leaves .cottage untouched', async () => {
    put('a.txt', [1], 1);
    put('b.txt', [2], 1);
    put('.cottage/private.bin', [7], 1);
    await initializeHistory();
    const [initial] = await listHistoryVersions();
    put('a.txt', [9], 2);
    fixture.files.delete('b.txt');
    put('c.txt', [3], 2);
    put('.cottage/private.bin', [8], 2);

    expect(await restoreTree(initial.id)).toBe(true);
    expect([...fixture.files.get('a.txt')!.bytes]).toEqual([1]);
    expect([...fixture.files.get('b.txt')!.bytes]).toEqual([2]);
    expect(fixture.files.has('c.txt')).toBe(false);
    expect([...fixture.files.get('.cottage/private.bin')!.bytes]).toEqual([8]);
  });
});
