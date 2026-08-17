import type { TaskToolSignals } from '../agent/taskToolSignals';
import type { TaskHandoff } from './types';

export interface TaskSignalState {
  completeRequested: boolean;
  failRequested: boolean;
  handoffRequested: boolean;
  failReason?: string;
  handoff?: TaskHandoff;
  reset: () => void;
  toToolSignals: () => TaskToolSignals;
}

export const createTaskSignalState = (): TaskSignalState => {
  const state = {
    completeRequested: false,
    failRequested: false,
    handoffRequested: false,
    failReason: undefined as string | undefined,
    handoff: undefined as TaskHandoff | undefined,
    reset() {
      state.completeRequested = false;
      state.failRequested = false;
      state.handoffRequested = false;
      state.failReason = undefined;
      state.handoff = undefined;
    },
    toToolSignals(): TaskToolSignals {
      return {
        onComplete: () => {
          state.completeRequested = true;
        },
        onFail: (reason: string) => {
          state.failRequested = true;
          state.failReason = reason;
        },
        onHandoff: (handoff: TaskHandoff) => {
          state.handoffRequested = true;
          state.handoff = handoff;
        },
      };
    },
  };
  return state;
};
