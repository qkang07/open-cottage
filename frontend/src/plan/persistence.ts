import { workspace } from '../workspace/FileSystemWorkspace';
import type { PlanRun } from './types';
import { createPlanRun, isTerminalPlanStatus, recoverInterruptedPlan } from './state';
import {
  PlanRepositoryError,
  planRepository,
  type StoredPlan,
} from './repository';

const root = (planId: string) => `plans/v1/${planId}`;
const definitionPath = (planId: string, revision: number) =>
  `${root(planId)}/definition.${revision}.json`;
const runPath = (planId: string) => `${root(planId)}/run.json`;
const eventsPath = (planId: string) => `${root(planId)}/events.jsonl`;
const verifyPath = (planId: string) => `${root(planId)}/verify.json`;
const manifestPath = (planId: string) => `${root(planId)}/manifest.json`;

export const loadPlanDefinition = (planId: string, revision: number) =>
  planRepository.loadDefinition(planId, revision);

export const loadLatestPlanDefinition = (planId: string) =>
  planRepository.loadLatestDefinition(planId);

export const loadPlanRun = (planId: string): Promise<PlanRun | null> =>
  workspace.readCottagePath<PlanRun>(runPath(planId));

export type { StoredPlan } from './repository';

export const loadStoredPlan = (planId: string): Promise<StoredPlan | null> =>
  planRepository.load(planId);

export const listSessionPlans = async (sessionId: string): Promise<StoredPlan[]> => {
  if (!workspace.isOpen) return [];
  const ids = await planRepository.listPlanIds();
  const plans = (await Promise.all(ids.map(async (id) => {
    try {
      return await planRepository.load(id);
    } catch (error) {
      if (!(error instanceof PlanRepositoryError)) throw error;
      const head = await planRepository.loadHead(id);
      const pointedCommit = head
        ? await planRepository.loadCommit(id, head.commitId)
        : null;
      const definition = head
        ? await planRepository.loadDefinition(
            id,
            pointedCommit?.definitionRevision ?? head.approvedRevision,
          )
        : await planRepository.loadLatestDefinition(id);
      if (!definition) return null;
      const run: PlanRun = {
        ...createPlanRun(definition),
        approvedRevision: head?.approvedRevision ?? 0,
        status: 'paused',
        recoveryRequired: true,
        repositoryCorrupt: true,
        pendingReason: `recovery_required：${error.message}`,
        updatedAt: Date.now(),
      };
      return { definition, run, head: head ?? undefined };
    }
  }))).filter(
    (item): item is StoredPlan => Boolean(item),
  );
  return plans
    .filter((item) => item.run.sessionId === sessionId)
    .sort((a, b) => b.run.updatedAt - a.run.updatedAt);
};

export const listActiveSessionPlans = async (sessionId: string) =>
  (await listSessionPlans(sessionId)).filter(
    (item) => !item.run.archivedAt && !isTerminalPlanStatus(item.run.status),
  );

export const recoverStoredPlan = async (planId: string): Promise<StoredPlan | null> => {
  const stored = await planRepository.load(planId);
  if (!stored) return null;
  const recovered = recoverInterruptedPlan(stored.run);
  if (recovered === stored.run) return stored;
  return planRepository.commit({
    definition: stored.definition,
    run: recovered,
    writeDefinition: false,
    event: {
      type: 'recovered_interrupted',
      at: Date.now(),
      revision: recovered.approvedRevision,
    },
  });
};

// Kept for callers that display the physical v1 layout.
export const planStoragePaths = {
  root,
  definitionPath,
  runPath,
  eventsPath,
  verifyPath,
  manifestPath,
};
