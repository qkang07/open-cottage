/**
 * 后台索引服务：打开工作区后自动建库，UI 可订阅进度
 */

import { getCottageConfig } from '../config/store';
import { buildIndex, isIndexing } from './indexer';
import type { IndexProgress } from './types';

export interface BackgroundIndexState {
  running: boolean;
  progress: IndexProgress | null;
  error: string | null;
  lastCompletedAt: number | null;
}

type Listener = (state: BackgroundIndexState) => void;

let state: BackgroundIndexState = {
  running: false,
  progress: null,
  error: null,
  lastCompletedAt: null,
};

const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener(state);
  }
}

export function getBackgroundIndexState(): BackgroundIndexState {
  return state;
}

export function subscribeBackgroundIndex(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

/** 工作区打开后调度后台索引（受 rag.indexing.autoOnOpen 控制） */
export function scheduleBackgroundIndex(): void {
  const config = getCottageConfig();
  if (config.rag?.enabled === false) return;
  if (config.rag?.indexing?.autoOnOpen === false) return;
  if (isIndexing() || state.running) return;
  void startBackgroundIndex(false);
}

/** 手动或 UI 触发后台建库 */
export async function startBackgroundIndex(
  force = false,
): Promise<{ totalChunks: number; filesIndexed: number } | null> {
  if (state.running || isIndexing()) {
    throw new Error('索引正在构建中');
  }

  state = {
    ...state,
    running: true,
    progress: { phase: 'init', current: 0, total: 1, detail: '准备嵌入环境…' },
    error: null,
  };
  emit();

  try {
    const result = await buildIndex((progress) => {
      state = { ...state, progress };
      emit();
    }, force);

    state = {
      running: false,
      progress: null,
      error: null,
      lastCompletedAt: Date.now(),
    };
    emit();
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== '已取消') {
      state = { ...state, running: false, progress: null, error: msg };
    } else {
      state = { ...state, running: false, progress: null };
    }
    emit();
    throw err;
  }
}
