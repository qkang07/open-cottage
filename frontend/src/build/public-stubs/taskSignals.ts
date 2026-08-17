import type { TaskToolSignals } from '../../agent/taskToolSignals';
import type { TaskHandoff } from '../../task/types';

export interface TaskSignalState {
  completeRequested: boolean;
  failRequested: boolean;
  handoffRequested: boolean;
  failReason?: string;
  handoff?: TaskHandoff;
  reset: () => void;
  toToolSignals: () => TaskToolSignals;
}

export const createTaskSignalState = (): TaskSignalState => ({
  completeRequested: false,
  failRequested: false,
  handoffRequested: false,
  reset() {},
  toToolSignals: () => ({}),
});

