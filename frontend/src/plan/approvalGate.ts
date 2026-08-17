import {
  activeInteractionKey,
  bumpInteractionRevision,
  interactionRevision,
  writeInteractionKey,
} from '../platform/interaction/interactionScope';
import type { PlanDefinition, PlanRun } from './types';

export type PlanApprovalDecision = 'approved' | 'adjust' | 'cancel';

export interface PendingPlanApproval {
  definition: PlanDefinition;
  run: PlanRun;
  resolve: (decision: PlanApprovalDecision) => void;
  reject: (reason: Error) => void;
}

const pending = new Map<string, PendingPlanApproval>();
export const pendingPlanApprovalRevision = interactionRevision;

export const requestPlanApproval = (input: {
  definition: PlanDefinition;
  run: PlanRun;
  signal?: AbortSignal;
  sessionId?: string | null;
}): Promise<PlanApprovalDecision> =>
  new Promise((resolve, reject) => {
    const key = writeInteractionKey(input.sessionId);
    if (input.signal?.aborted) {
      reject(new DOMException('已取消', 'AbortError'));
      return;
    }
    const abort = () => {
      pending.delete(key);
      bumpInteractionRevision();
      reject(new DOMException('已取消', 'AbortError'));
    };
    input.signal?.addEventListener('abort', abort, { once: true });
    pending.set(key, {
      definition: input.definition,
      run: input.run,
      resolve: (decision) => {
        input.signal?.removeEventListener('abort', abort);
        pending.delete(key);
        bumpInteractionRevision();
        resolve(decision);
      },
      reject: (reason) => {
        input.signal?.removeEventListener('abort', abort);
        pending.delete(key);
        bumpInteractionRevision();
        reject(reason);
      },
    });
    bumpInteractionRevision();
  });

export const getPendingPlanApproval = (sessionId?: string | null) => {
  void pendingPlanApprovalRevision.value;
  return pending.get(
    sessionId === undefined ? activeInteractionKey() : writeInteractionKey(sessionId),
  ) ?? null;
};

export const hasPendingPlanApprovalFor = (sessionId?: string | null) =>
  pending.has(writeInteractionKey(sessionId));

export const resolvePendingPlanApproval = (
  decision: PlanApprovalDecision,
  sessionId?: string | null,
) => {
  const key = sessionId === undefined ? activeInteractionKey() : writeInteractionKey(sessionId);
  const item = pending.get(key);
  if (!item) return false;
  item.resolve(decision);
  return true;
};

export const cancelPendingPlanApproval = (
  reason = new Error('计划审批已取消'),
  sessionId?: string | null,
) => {
  const key = sessionId === undefined ? activeInteractionKey() : writeInteractionKey(sessionId);
  const item = pending.get(key);
  if (!item) return false;
  item.reject(reason);
  return true;
};

