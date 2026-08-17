export interface WorkspaceWriteLease {
  id: string;
  workspaceId: string;
  planId: string;
  acquiredAt: number;
  release(): void;
}

export type WorkspaceWriteLockState =
  | { status: 'idle' }
  | { status: 'held'; workspaceId: string; planId: string; leaseId: string; tabId: string; acquiredAt: number }
  | { status: 'unsupported'; workspaceId: string };

type WebLockManager = {
  request<T>(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: unknown | null) => Promise<T>,
  ): Promise<T>;
};

const webLocks = (): WebLockManager | null => {
  if (typeof navigator === 'undefined') return null;
  return ((navigator as unknown as { locks?: WebLockManager }).locks ?? null);
};

export class WorkspaceWriteCoordinator {
  readonly tabId = crypto.randomUUID();
  private state: WorkspaceWriteLockState = { status: 'idle' };
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<(state: WorkspaceWriteLockState) => void>();
  private takeoverListeners = new Set<
    (request: { workspaceId: string; planId: string; requestedAt: number }) => void
  >();

  constructor() {
    if (typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined') {
      this.channel = new window.BroadcastChannel('open-cottage:plan-write-lock:v1');
      this.channel.onmessage = (event) => {
        if (event.data?.kind === 'takeover_request') {
          this.takeoverListeners.forEach((listener) => listener(event.data));
          return;
        }
        const state = event.data as WorkspaceWriteLockState;
        if (
          state?.status === 'idle' &&
          this.state.status === 'held' &&
          this.state.tabId === this.tabId
        ) {
          return;
        }
        if (state?.status) this.listeners.forEach((listener) => listener(state));
      };
    }
  }

  get currentState() {
    return this.state;
  }

  subscribe(listener: (state: WorkspaceWriteLockState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  subscribeTakeover(
    listener: (request: { workspaceId: string; planId: string; requestedAt: number }) => void,
  ) {
    this.takeoverListeners.add(listener);
    return () => this.takeoverListeners.delete(listener);
  }

  requestTakeover(workspaceId: string, planId: string) {
    this.channel?.postMessage({
      kind: 'takeover_request',
      workspaceId,
      planId,
      requestedAt: Date.now(),
    });
  }

  private publish(state: WorkspaceWriteLockState) {
    this.state = state;
    this.channel?.postMessage(state);
    this.listeners.forEach((listener) => listener(state));
  }

  async acquire(workspaceId: string, planId: string): Promise<WorkspaceWriteLease | null> {
    const manager = webLocks();
    if (!manager) {
      this.publish({ status: 'unsupported', workspaceId });
      return null;
    }
    const leaseId = crypto.randomUUID();
    let resolveLease!: (lease: WorkspaceWriteLease | null) => void;
    const leaseReady = new Promise<WorkspaceWriteLease | null>((resolve) => {
      resolveLease = resolve;
    });
    let releaseLock!: () => void;
    const released = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockName = `open-cottage:workspace-write:${workspaceId}`;

    void manager.request(lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock) {
        resolveLease(null);
        return;
      }
      const acquiredAt = Date.now();
      let releasedOnce = false;
      const lease: WorkspaceWriteLease = {
        id: leaseId,
        workspaceId,
        planId,
        acquiredAt,
        release: () => {
          if (releasedOnce) return;
          releasedOnce = true;
          releaseLock();
        },
      };
      this.publish({ status: 'held', workspaceId, planId, leaseId, tabId: this.tabId, acquiredAt });
      resolveLease(lease);
      await released;
      if (this.state.status === 'held' && this.state.leaseId === leaseId) {
        this.publish({ status: 'idle' });
      }
    });
    return leaseReady;
  }
}

export const workspaceWriteCoordinator = new WorkspaceWriteCoordinator();

// Compatibility exports for callers that only clear the old in-tab marker.
export const tryAcquirePlanWriter = () => false;
export const releasePlanWriter = (_planId?: string) => undefined;
export const currentPlanWriter = () => {
  const state = workspaceWriteCoordinator.currentState;
  return state.status === 'held' ? state.planId : null;
};
