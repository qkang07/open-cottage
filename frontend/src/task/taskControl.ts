export type WakeReason =
  | 'verify-failed'
  | 'operator-instruction'
  | 'stalled-recovery'
  | 'subtask-done';

export interface TaskRunControl {
  pauseRequested: boolean;
  cancelRequested: boolean;
  pendingWake: boolean;
  lastWakeReason?: WakeReason;
  reset: () => void;
  requestPause: () => void;
  requestCancel: () => void;
  shouldStop: () => boolean;
  wake: (reason: WakeReason) => void;
  consumeWake: () => WakeReason | undefined;
}

export const createTaskRunControl = (): TaskRunControl => {
  const state = {
    pauseRequested: false,
    cancelRequested: false,
    pendingWake: false,
    lastWakeReason: undefined as WakeReason | undefined,
    reset() {
      state.pauseRequested = false;
      state.cancelRequested = false;
      state.pendingWake = false;
      state.lastWakeReason = undefined;
    },
    requestPause() {
      state.pauseRequested = true;
    },
    requestCancel() {
      state.cancelRequested = true;
    },
    shouldStop() {
      return state.pauseRequested || state.cancelRequested;
    },
    wake(reason: WakeReason) {
      state.pendingWake = true;
      state.lastWakeReason = reason;
    },
    consumeWake(): WakeReason | undefined {
      if (!state.pendingWake) return undefined;
      const reason = state.lastWakeReason;
      state.pendingWake = false;
      state.lastWakeReason = undefined;
      return reason;
    },
  };
  return state;
};
