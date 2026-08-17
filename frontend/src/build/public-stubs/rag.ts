import type { IndexProgress } from '../../rag/types';

export interface BackgroundIndexState {
  running: boolean;
  progress: IndexProgress | null;
  error: string | null;
  lastCompletedAt: number | null;
}

const state: BackgroundIndexState = {
  running: false,
  progress: null,
  error: null,
  lastCompletedAt: null,
};

export const getIndexStats = async (): Promise<null> => null;
export const getIndexStorageInfo = async (): Promise<null> => null;
export const getExpectedEmbeddingModelId = (): null => null;
export const abortIndexing = (): void => {};
export const clearIndex = async (): Promise<void> => {};

export const subscribeBackgroundIndex = (
  listener: (value: BackgroundIndexState) => void,
): (() => void) => {
  listener(state);
  return () => {};
};

export const startBackgroundIndex = async (): Promise<never> => {
  throw new Error('当前构建未包含本地向量索引');
};

