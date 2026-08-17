import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  files: new Map<string, unknown>(),
  failPath: null as string | null,
}));

vi.mock('../workspace/FileSystemWorkspace', () => ({
  workspace: {
    isOpen: true,
    writeCottagePath: async (path: string, value: unknown) => {
      if (testState.failPath && path.endsWith(testState.failPath)) throw new Error(`injected:${path}`);
      testState.files.set(path, structuredClone(value));
    },
    readCottagePath: async <T>(path: string): Promise<T | null> =>
      testState.files.has(path) ? structuredClone(testState.files.get(path)) as T : null,
    appendCottageText: async (path: string, value: string) => {
      if (testState.failPath && path.endsWith(testState.failPath)) throw new Error(`injected:${path}`);
      testState.files.set(path, `${String(testState.files.get(path) ?? '')}${value}`);
    },
    listCottageFiles: async (prefix: string) =>
      [...testState.files.keys()].filter((path) => path.startsWith(prefix)),
  },
}));

vi.mock('../history/storage', () => ({
  hashBytes: async (bytes: Uint8Array) => {
    let hash = 2166136261;
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  },
}));

import { createPlanDefinition, createPlanRun } from './state';
import { PlanRepository, PlanRepositoryError } from './repository';

const definition = () =>
  createPlanDefinition(
    {
      goal: '事务恢复',
      requirements: [],
      design: '',
      allowedPathPrefixes: ['frontend/src'],
      steps: [{ id: 'a', title: '实现', kind: 'implementation' }],
      finalAcceptance: [],
    },
    { sessionId: 's', workspaceId: 'w', capabilities: [] },
  );

describe('PlanRepository commit/head recovery', () => {
  beforeEach(() => {
    testState.files.clear();
    testState.failPath = null;
  });

  it('loads from commit/head when run.json compatibility projection fails', async () => {
    const repository = new PlanRepository();
    const plan = definition();
    testState.failPath = '/run.json';
    const committed = await repository.commit({
      definition: plan,
      run: createPlanRun(plan),
      event: { type: 'submitted', at: 1 },
    });
    expect((await repository.load(plan.id))?.run.commitId).toBe(committed.run.commitId);
  });

  it('keeps the previous authoritative head if a later head write fails', async () => {
    const repository = new PlanRepository();
    const plan = definition();
    const first = await repository.commit({
      definition: plan,
      run: createPlanRun(plan),
      event: { type: 'submitted', at: 1 },
    });
    testState.failPath = '/head.json';
    await expect(repository.commit({
      definition: plan,
      run: { ...first.run, status: 'paused' },
      event: { type: 'paused', at: 2 },
    })).rejects.toThrow('injected');
    expect((await repository.load(plan.id))?.run.commitId).toBe(first.run.commitId);
  });

  it('does not publish head when an immutable manifest attachment fails', async () => {
    const repository = new PlanRepository();
    const plan = definition();
    testState.failPath = '.manifest.json';
    await expect(repository.commit({
      definition: plan,
      run: createPlanRun(plan),
      event: { type: 'submitted', at: 1 },
      manifest: {
        planId: plan.id,
        revision: plan.revision,
        paths: ['frontend/src/a.ts'],
        generatedAt: 1,
      },
    })).rejects.toThrow('injected');
    expect(await repository.loadHead(plan.id)).toBeNull();
  });

  it('refuses a commit with a corrupt checksum', async () => {
    const repository = new PlanRepository();
    const plan = definition();
    const committed = await repository.commit({
      definition: plan,
      run: createPlanRun(plan),
      event: { type: 'submitted', at: 1 },
    });
    const path = `plans/v1/${plan.id}/commits/${committed.commit!.commitId}.json`;
    testState.files.set(path, {
      ...(testState.files.get(path) as object),
      checksum: 'corrupt',
    });
    await expect(repository.load(plan.id)).rejects.toBeInstanceOf(PlanRepositoryError);
  });

  it('rejects stale writers, including legacy runs without a commit id', async () => {
    const repository = new PlanRepository();
    const plan = definition();
    const legacyRun = createPlanRun(plan);
    const first = await repository.commit({
      definition: plan,
      run: legacyRun,
      event: { type: 'submitted', at: 1 },
    });

    await expect(repository.commit({
      definition: plan,
      run: { ...legacyRun, status: 'paused' },
      event: { type: 'paused', at: 2 },
    })).rejects.toMatchObject({
      detail: {
        actualCommitId: first.run.commitId,
      },
    });
  });
});
