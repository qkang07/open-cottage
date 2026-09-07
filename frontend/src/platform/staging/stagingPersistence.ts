import { workspace } from '../../workspace/FileSystemWorkspace';
import { sessionStagingFile } from '../../config/constants';
import type { StagingStore, StagedEntry } from './stagingStore';

export interface PersistedStagingState {
  v: 1;
  status: 'pending';
  entries: StagedEntry[];
  updatedAt: number;
}

export interface StagingStatePersistence {
  save(sessionId: string, store: StagingStore): Promise<void>;
  load(sessionId: string): Promise<PersistedStagingState | null>;
  clear(sessionId: string): Promise<void>;
}

export const saveSessionStaging = async (
  sessionId: string,
  store: StagingStore,
): Promise<void> => {
  if (!workspace.isOpen) return;
  const entries = store.snapshot();
  if (entries.length === 0) {
    await clearSessionStaging(sessionId);
    return;
  }
  const state: PersistedStagingState = {
    v: 1,
    status: 'pending',
    entries,
    updatedAt: Date.now(),
  };
  await workspace.writeCottagePath(sessionStagingFile(sessionId), state);
};

export const loadSessionStaging = async (
  sessionId: string,
): Promise<PersistedStagingState | null> => {
  if (!workspace.isOpen) return null;
  const raw = await workspace.readCottagePath<PersistedStagingState>(
    sessionStagingFile(sessionId),
  );
  if (!raw || raw.v !== 1 || raw.status !== 'pending') return null;
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) return null;
  return raw;
};

export const clearSessionStaging = async (sessionId: string): Promise<void> => {
  if (!workspace.isOpen) return;
  // 写空 pending 占位会被 load 忽略；再尽量删掉文件减少噪音
  try {
    await workspace.writeCottagePath(sessionStagingFile(sessionId), {
      v: 1,
      status: 'cleared',
      entries: [],
      updatedAt: Date.now(),
    });
  } catch {
    // ignore
  }
  try {
    await workspace.deleteFile(`.cottage/${sessionStagingFile(sessionId)}`);
  } catch {
    // 删除失败时 cleared 快照已足够让 load 返回 null
  }
};

/** 默认浏览器工作区实现；可在确定性 eval 中注入独立内存实现。 */
export const workspaceStagingPersistence: StagingStatePersistence = {
  save: saveSessionStaging,
  load: loadSessionStaging,
  clear: clearSessionStaging,
};
