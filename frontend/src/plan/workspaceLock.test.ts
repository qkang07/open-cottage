import { beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceWriteCoordinator } from './workspaceLock';

describe('WorkspaceWriteCoordinator', () => {
  beforeEach(() => {
    const testNavigator = globalThis.navigator ?? {};
    if (!globalThis.navigator) {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: testNavigator,
      });
    }
  });

  it('does not substitute an in-memory lock when Web Locks is unavailable', async () => {
    Reflect.deleteProperty(globalThis.navigator, 'locks');
    const coordinator = new WorkspaceWriteCoordinator();
    expect(await coordinator.acquire('workspace', 'plan')).toBeNull();
    expect(coordinator.currentState.status).toBe('unsupported');
  });

  it('holds the browser lease until release', async () => {
    let callbackFinished = false;
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: object) => Promise<unknown>,
        ) => {
          await callback({});
          callbackFinished = true;
        },
      },
    });
    const coordinator = new WorkspaceWriteCoordinator();
    const lease = await coordinator.acquire('workspace', 'plan');
    expect(coordinator.currentState.status).toBe('held');
    expect(callbackFinished).toBe(false);
    lease?.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(callbackFinished).toBe(true);
  });
});

