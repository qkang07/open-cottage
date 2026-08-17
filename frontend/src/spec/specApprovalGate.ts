import type { SpecDoc } from './types';
import {
  activeInteractionKey,
  bumpInteractionRevision,
  interactionRevision,
  writeInteractionKey,
} from '../platform/interaction/interactionScope';

export type SpecApprovalDecision = 'approved' | 'adjust' | 'cancel';

export interface PendingSpecApproval {
  doc: SpecDoc;
  resolve: (decision: SpecApprovalDecision) => void;
  reject: (reason: Error) => void;
}

/** 按会话隔离的待方案审批项 */
const pendingSpecApprovals = new Map<string, PendingSpecApproval>();

/** 供 Vue 组件订阅 pending 状态变化（单例非响应式，靠 ref 触发刷新） */
export const pendingSpecApprovalRevision = interactionRevision;

export interface RequestSpecApprovalInput {
  doc: SpecDoc;
  signal?: AbortSignal;
  /** 发起审批的会话 ID；缺省落入默认键 */
  sessionId?: string | null;
  onPending?: () => void;
}

/** 提交方案后阻塞等待用户在 UI 上批准。 */
export const requestSpecApproval = (
  input: RequestSpecApprovalInput,
): Promise<SpecApprovalDecision> =>
  new Promise<SpecApprovalDecision>((resolve, reject) => {
    const key = writeInteractionKey(input.sessionId);
    const { signal } = input;
    if (signal?.aborted) {
      reject(new Error('已取消'));
      return;
    }
    const onAbort = () => {
      pendingSpecApprovals.delete(key);
      bumpInteractionRevision();
      reject(new Error('已取消'));
    };
    signal?.addEventListener('abort', onAbort);

    pendingSpecApprovals.set(key, {
      doc: input.doc,
      resolve: (decision) => {
        signal?.removeEventListener('abort', onAbort);
        pendingSpecApprovals.delete(key);
        bumpInteractionRevision();
        resolve(decision);
      },
      reject: (reason) => {
        signal?.removeEventListener('abort', onAbort);
        pendingSpecApprovals.delete(key);
        bumpInteractionRevision();
        reject(reason);
      },
    });

    input.onPending?.();
    bumpInteractionRevision();
  });

const keyFor = (sessionId?: string | null): string =>
  sessionId === undefined ? activeInteractionKey() : writeInteractionKey(sessionId);

export const getPendingSpecApproval = (
  sessionId?: string | null,
):
  | Readonly<Pick<PendingSpecApproval, 'doc' | 'resolve' | 'reject'>>
  | null => pendingSpecApprovals.get(keyFor(sessionId)) ?? null;

export const resolvePendingSpecApproval = (
  decision: SpecApprovalDecision,
  sessionId?: string | null,
): void => {
  pendingSpecApprovals.get(keyFor(sessionId))?.resolve(decision);
};

export const hasPendingSpecApprovalFor = (sessionId: string): boolean =>
  pendingSpecApprovals.has(writeInteractionKey(sessionId));

export const cancelPendingSpecApproval = (
  reason?: string,
  sessionId?: string | null,
): void => {
  const key = sessionId ? writeInteractionKey(sessionId) : activeInteractionKey();
  pendingSpecApprovals.get(key)?.reject(new Error(reason || '用户取消了方案审批'));
};
