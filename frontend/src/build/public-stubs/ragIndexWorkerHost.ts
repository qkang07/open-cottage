import type { IndexProgress } from '../../rag/types';

export const getIndexWorkerActiveRequestKind = (): null => null;

export const getIndexWorkerStatus = (): {
  alive: boolean;
  initializing: boolean;
  pendingRequests: number;
  busy: boolean;
  lastProgress: IndexProgress | null;
} => ({
  alive: false,
  initializing: false,
  pendingRequests: 0,
  busy: false,
  lastProgress: null,
});

export const terminateIndexWorker = (): void => {};
export const abortIndexWorker = (): void => {};

