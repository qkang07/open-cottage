import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredMessage } from './messages';

const store = new Map<string, unknown>();

vi.mock('../workspace/FileSystemWorkspace', () => ({
  workspace: {
    readCottagePath: async <T>(path: string): Promise<T | null> => {
      if (!store.has(path)) return null;
      return store.get(path) as T;
    },
    writeCottagePath: async (path: string, data: unknown): Promise<void> => {
      store.set(path, structuredClone(data));
    },
  },
}));

vi.mock('../history/historyService', () => ({
  restoreTree: vi.fn(),
}));

import {
  createConversationCheckpoint,
  listCheckpoints,
  loadCheckpointSnapshot,
} from './conversationCheckpoint';

const sessionId = 'test-session';

const msg = (id: string, content: string): StoredMessage => ({
  id,
  role: 'user',
  content,
});

describe('conversationCheckpoint v2', () => {
  beforeEach(() => {
    store.clear();
  });

  it('writes v2 full for the first checkpoint', async () => {
    const history = [msg('m1', 'hello')];
    const entry = await createConversationCheckpoint({
      sessionId,
      trigger: 'pre_turn',
      label: 'first',
      history,
      contextUsage: null,
      planState: null,
      workspaceCheckpointOid: null,
    });

    const file = store.get(entry.historyRef) as {
      v: number;
      kind: string;
      history: StoredMessage[];
    };
    expect(file.v).toBe(2);
    expect(file.kind).toBe('full');
    expect(file.history).toHaveLength(1);
    expect(entry.contextUsage).toBeUndefined();
    expect(entry.planState).toBeUndefined();
    expect(entry.lastMessageId).toBe('m1');
  });

  it('writes delta for pure append and expands on load', async () => {
    const a = await createConversationCheckpoint({
      sessionId,
      trigger: 'pre_turn',
      label: 'a',
      history: [msg('m1', 'one')],
      contextUsage: null,
      planState: null,
      workspaceCheckpointOid: null,
    });

    const b = await createConversationCheckpoint({
      sessionId,
      trigger: 'post_turn',
      label: 'b',
      history: [msg('m1', 'one'), msg('m2', 'two')],
      contextUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      planState: null,
      workspaceCheckpointOid: null,
    });

    const file = store.get(b.historyRef) as {
      v: number;
      kind: string;
      baseId: string;
      prefixLen: number;
      append: StoredMessage[];
    };
    expect(file.kind).toBe('delta');
    expect(file.baseId).toBe(a.id);
    expect(file.prefixLen).toBe(1);
    expect(file.append).toHaveLength(1);
    expect(file.append[0]?.id).toBe('m2');

    const snap = await loadCheckpointSnapshot(b);
    expect(snap.history.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(snap.contextUsage?.totalTokens).toBe(3);
  });

  it('reuses historyRef when history content is identical', async () => {
    const history = [msg('m1', 'one'), msg('m2', 'two')];
    const a = await createConversationCheckpoint({
      sessionId,
      trigger: 'pre_risky_tool',
      label: 'a',
      history,
      contextUsage: null,
      planState: null,
      workspaceCheckpointOid: null,
    });
    const beforeKeys = [...store.keys()];

    const b = await createConversationCheckpoint({
      sessionId,
      trigger: 'pre_risky_tool',
      label: 'b',
      history: [...history],
      contextUsage: null,
      planState: null,
      workspaceCheckpointOid: null,
    });

    expect(b.historyRef).toBe(a.historyRef);
    expect([...store.keys()].sort()).toEqual(beforeKeys.sort());

    const entries = await listCheckpoints(sessionId);
    expect(entries).toHaveLength(2);
    expect(entries[1]?.historyRef).toBe(a.historyRef);
  });

  it('writes full when history is not a prefix of the previous checkpoint', async () => {
    await createConversationCheckpoint({
      sessionId,
      trigger: 'pre_turn',
      label: 'a',
      history: [msg('m1', 'one'), msg('m2', 'two')],
      contextUsage: null,
      planState: null,
      workspaceCheckpointOid: null,
    });

    const rewound = await createConversationCheckpoint({
      sessionId,
      trigger: 'pre_rewind',
      label: 'rewound',
      history: [msg('m1', 'one')],
      contextUsage: null,
      planState: null,
      workspaceCheckpointOid: null,
    });

    const file = store.get(rewound.historyRef) as { kind: string; history: StoredMessage[] };
    expect(file.kind).toBe('full');
    expect(file.history.map((m) => m.id)).toEqual(['m1']);
  });

  it('loads legacy v1 full snapshots', async () => {
    const historyRef = `sessions/${sessionId}/history/legacy.json`;
    store.set(historyRef, {
      history: [msg('old', 'legacy')],
      contextUsage: null,
      planState: null,
    });
    store.set(`sessions/${sessionId}/checkpoints.json`, [
      {
        id: 'legacy-id',
        sessionId,
        at: 1,
        trigger: 'manual',
        label: 'legacy',
        historyRef,
        workspaceCheckpointOid: null,
        messageCount: 1,
        contextUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 9 },
        planState: null,
      },
    ]);

    const entries = await listCheckpoints(sessionId);
    const snap = await loadCheckpointSnapshot(entries[0]!);
    expect(snap.history[0]?.id).toBe('old');
    expect(snap.contextUsage).toBeNull();
  });

  it('expands a chain of deltas', async () => {
    await createConversationCheckpoint({
      sessionId,
      trigger: 'pre_turn',
      label: 'a',
      history: [msg('m1', '1')],
      contextUsage: null,
      planState: null,
      workspaceCheckpointOid: null,
    });
    await createConversationCheckpoint({
      sessionId,
      trigger: 'post_turn',
      label: 'b',
      history: [msg('m1', '1'), msg('m2', '2')],
      contextUsage: null,
      planState: null,
      workspaceCheckpointOid: null,
    });
    const c = await createConversationCheckpoint({
      sessionId,
      trigger: 'post_turn',
      label: 'c',
      history: [msg('m1', '1'), msg('m2', '2'), msg('m3', '3')],
      contextUsage: null,
      planState: null,
      workspaceCheckpointOid: null,
    });

    const snap = await loadCheckpointSnapshot(c);
    expect(snap.history.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });
});
