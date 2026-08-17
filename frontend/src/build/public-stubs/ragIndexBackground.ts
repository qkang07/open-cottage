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

export const getBackgroundIndexState = (): BackgroundIndexState => state;

export const subscribeBackgroundIndex = (
  listener: (value: BackgroundIndexState) => void,
): (() => void) => {
  listener(state);
  return () => {};
};

