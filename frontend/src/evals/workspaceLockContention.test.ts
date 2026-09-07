import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceWriteCoordinator } from '../plan/workspaceLock';

class DeterministicLockManager {
  private readonly held = new Set<string>();

  async request<T>(
    name: string,
    _options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: object | null) => Promise<T>,
  ): Promise<T> {
    if (this.held.has(name)) return callback(null);
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
    }
  }
}

describe('deterministic workspace lock contention', () => {
  beforeEach(() => {
    const target = globalThis.navigator ?? {};
    if (!globalThis.navigator) {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: target });
    }
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: new DeterministicLockManager(),
    });
  });

  it('allows only one plan lease per workspace and releases it for the next writer', async () => {
    const first = new WorkspaceWriteCoordinator();
    const second = new WorkspaceWriteCoordinator();
    const firstLease = await first.acquire('workspace-1', 'plan-a');
    expect(firstLease).not.toBeNull();
    expect(first.currentState).toMatchObject({ status: 'held', planId: 'plan-a' });

    expect(await second.acquire('workspace-1', 'plan-b')).toBeNull();
    expect(second.currentState.status).toBe('idle');

    firstLease?.release();
    await Promise.resolve();
    await Promise.resolve();
    const secondLease = await second.acquire('workspace-1', 'plan-b');
    expect(secondLease).not.toBeNull();
    expect(second.currentState).toMatchObject({ status: 'held', planId: 'plan-b' });
    secondLease?.release();
  });

  it('does not serialize unrelated workspaces behind one global lock', async () => {
    const first = new WorkspaceWriteCoordinator();
    const second = new WorkspaceWriteCoordinator();
    const firstLease = await first.acquire('workspace-a', 'plan-a');
    const secondLease = await second.acquire('workspace-b', 'plan-b');
    expect(firstLease).not.toBeNull();
    expect(secondLease).not.toBeNull();
    firstLease?.release();
    secondLease?.release();
  });
});
