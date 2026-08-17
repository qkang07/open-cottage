import type { ExecutionPlan } from './types';
import {
  activeInteractionKey,
  bumpInteractionRevision,
  interactionRevision,
  writeInteractionKey,
} from '../interaction/interactionScope';

export type PlanApprovalDecision = 'approved' | 'adjust' | 'cancel';

export interface PendingPlanApproval {
  plan: ExecutionPlan;
  resolve: (decision: PlanApprovalDecision) => void;
  reject: (reason: Error) => void;
}

/** 按会话隔离的待计划审批项 */
const pendingPlanApprovals = new Map<string, PendingPlanApproval>();

/** 供 Vue 组件订阅 pending 状态变化（单例非响应式，靠 ref 触发刷新） */
export const pendingPlanApprovalRevision = interactionRevision;

export interface RequestPlanApprovalInput {
  plan: ExecutionPlan;
  signal?: AbortSignal;
  /** 发起审批的会话 ID；缺省落入默认键 */
  sessionId?: string | null;
  onPending?: () => void;
}

export const requestPlanApproval = (
  input: RequestPlanApprovalInput,
): Promise<PlanApprovalDecision> =>
  new Promise<PlanApprovalDecision>((resolve, reject) => {
    const key = writeInteractionKey(input.sessionId);
    const { signal } = input;
    if (signal?.aborted) {
      reject(new Error('已取消'));
      return;
    }
    const onAbort = () => {
      pendingPlanApprovals.delete(key);
      bumpInteractionRevision();
      reject(new Error('已取消'));
    };
    signal?.addEventListener('abort', onAbort);

    pendingPlanApprovals.set(key, {
      plan: input.plan,
      resolve: (decision) => {
        signal?.removeEventListener('abort', onAbort);
        pendingPlanApprovals.delete(key);
        bumpInteractionRevision();
        resolve(decision);
      },
      reject: (reason) => {
        signal?.removeEventListener('abort', onAbort);
        pendingPlanApprovals.delete(key);
        bumpInteractionRevision();
        reject(reason);
      },
    });

    input.onPending?.();
    bumpInteractionRevision();
  });

const keyFor = (sessionId?: string | null): string =>
  sessionId === undefined ? activeInteractionKey() : writeInteractionKey(sessionId);

export const getPendingPlanApproval = (
  sessionId?: string | null,
):
  | Readonly<Pick<PendingPlanApproval, 'plan' | 'resolve' | 'reject'>>
  | null => pendingPlanApprovals.get(keyFor(sessionId)) ?? null;

export const resolvePendingPlanApproval = (
  decision: PlanApprovalDecision,
  sessionId?: string | null,
): void => {
  pendingPlanApprovals.get(keyFor(sessionId))?.resolve(decision);
};

export const hasPendingPlanApprovalFor = (sessionId: string): boolean =>
  pendingPlanApprovals.has(writeInteractionKey(sessionId));

export const cancelPendingPlanApproval = (
  reason?: string,
  sessionId?: string | null,
): void => {
  const key = sessionId ? writeInteractionKey(sessionId) : activeInteractionKey();
  pendingPlanApprovals.get(key)?.reject(new Error(reason || '用户取消了计划审批'));
};
