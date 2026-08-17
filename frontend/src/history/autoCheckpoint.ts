import { DEFAULT_COTTAGE_CONFIG } from '../config/constants';
import { getCottageConfig } from '../config/store';
import { workspace } from '../workspace/FileSystemWorkspace';
import type { SnapshotPatch } from '../workspace/snapshotPatch';
import {
  captureHistoryVersion,
  createManualCheckpoint,
  initializeHistory,
  isHistoryMutationSuppressed,
  resetHistoryService,
} from './historyService';

const pendingPaths = new Set<string>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let historyReady = false;
let unsubscribeWorkspace: (() => void) | null = null;

const config = () => ({
  ...DEFAULT_COTTAGE_CONFIG.history,
  ...(getCottageConfig().history ?? {}),
});

const patchPaths = (patch: SnapshotPatch): string[] => {
  switch (patch.type) {
    case 'addFile':
    case 'addDirectory':
      return [patch.path];
    case 'addFiles':
    case 'addDirectories':
    case 'remove':
      return patch.paths;
    case 'rename':
      return [patch.from, patch.to];
  }
};

const clearDebounce = () => {
  if (!debounceTimer) return;
  clearTimeout(debounceTimer);
  debounceTimer = null;
};

const scheduleManualFlush = () => {
  clearDebounce();
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushPending('手动编辑', 'manual');
  }, config().manualEditDebounceMs ?? 1500);
};

const queuePaths = (paths: string[]) => {
  for (const path of paths) {
    const normalized = path.replace(/\\/g, '/');
    if (!normalized || normalized === '.cottage' || normalized.startsWith('.cottage/')) {
      continue;
    }
    pendingPaths.add(normalized);
  }
};

const onWorkspaceChange = (patch: SnapshotPatch) => {
  if (
    !historyReady ||
    isHistoryMutationSuppressed() ||
    config().autoCheckpoint === false
  ) {
    return;
  }
  queuePaths(patchPaths(patch));
  scheduleManualFlush();
};

async function flushPending(
  label: string,
  source: 'manual' | 'agent',
): Promise<string | null> {
  if (!historyReady || pendingPaths.size === 0) return null;
  const paths = [...pendingPaths];
  pendingPaths.clear();
  return captureHistoryVersion(paths, label, source);
}

export async function initHistory(): Promise<boolean> {
  resetAutoCheckpoint();
  if (!workspace.isOpen || getCottageConfig().history?.enabled !== true) return false;
  const meta = await initializeHistory();
  // paused 仍保留监听；用户清理空间后服务会自动恢复捕获。
  historyReady = meta.status === 'ready' || meta.status === 'paused';
  if (historyReady) unsubscribeWorkspace = workspace.onDidChange(onWorkspaceChange);
  return historyReady;
}

/** Agent/工具写入后调用；覆盖工作区事件的手动防抖，统一到回合末提交。 */
export function trackMutation(paths: string[]): void {
  if (!historyReady || config().autoCheckpoint === false) return;
  queuePaths(paths);
  clearDebounce();
}

/** 兼容已有编辑器入口；其它工作区写入由 onDidChange 统一覆盖。 */
export function trackManualEdit(path: string): void {
  if (!historyReady || config().autoCheckpoint === false) return;
  queuePaths([path]);
  scheduleManualFlush();
}

export async function flushCheckpoint(summary?: string): Promise<string | null> {
  clearDebounce();
  return flushPending(summary?.trim() || 'Agent 修改', 'agent');
}

export function resetAutoCheckpoint(): void {
  pendingPaths.clear();
  clearDebounce();
  unsubscribeWorkspace?.();
  unsubscribeWorkspace = null;
  historyReady = false;
  resetHistoryService();
}

export function getPendingMutatedPaths(): string[] {
  return [...pendingPaths];
}

export { createManualCheckpoint };
