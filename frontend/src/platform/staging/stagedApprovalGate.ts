import type { StagingStore } from './stagingStore';
import {
  activeInteractionKey,
  bumpInteractionRevision,
  interactionRevision,
  writeInteractionKey,
} from '../interaction/interactionScope';

export type StagedApprovalDecision = 'approved' | 'discarded' | 'deferred';

export interface PendingStagedApproval {
  store: StagingStore;
  resolve: (decision: StagedApprovalDecision) => void;
  reject: (reason: Error) => void;
}

/** 按会话隔离的待暂存审批项 */
const pendingStagedApprovals = new Map<string, PendingStagedApproval>();

/** 供 Vue 组件订阅 pending 状态变化 */
export const pendingStagedApprovalRevision = interactionRevision;

export interface RequestStagedApprovalInput {
  store: StagingStore;
  signal?: AbortSignal;
  /** 发起审批的会话 ID；缺省落入默认键 */
  sessionId?: string | null;
  onPending?: () => void;
}

export const requestStagedChangesApproval = (
  input: RequestStagedApprovalInput,
): Promise<StagedApprovalDecision> =>
  new Promise<StagedApprovalDecision>((resolve, reject) => {
    const key = writeInteractionKey(input.sessionId);
    const { signal } = input;
    if (signal?.aborted) {
      reject(new Error('已取消'));
      return;
    }
    const onAbort = () => {
      pendingStagedApprovals.delete(key);
      bumpInteractionRevision();
      resolve('deferred');
    };
    signal?.addEventListener('abort', onAbort);

    pendingStagedApprovals.set(key, {
      store: input.store,
      resolve: (decision) => {
        signal?.removeEventListener('abort', onAbort);
        pendingStagedApprovals.delete(key);
        bumpInteractionRevision();
        resolve(decision);
      },
      reject: (reason) => {
        signal?.removeEventListener('abort', onAbort);
        pendingStagedApprovals.delete(key);
        bumpInteractionRevision();
        reject(reason);
      },
    });

    input.onPending?.();
    bumpInteractionRevision();
  });

/**
 * 解析待审批项所属会话键。
 * - 省略 sessionId（undefined）→ 回退到当前活跃交互会话（旧行为，保持兼容）。
 * - 传入具体 sessionId（含 null）→ 直接定位到该会话；null 落入默认键。
 *
 * UI 侧应显式传入「当前展示 Agent 自身的 sessionId」，避免依赖全局活跃交互会话，
 * 后者在多会话切换 / 新建空会话等场景可能与被阻塞的 Agent 漂移，导致审批面板取不到项。
 */
const keyFor = (sessionId?: string | null): string =>
  sessionId === undefined ? activeInteractionKey() : writeInteractionKey(sessionId);

export const getPendingStagedApproval = (
  sessionId?: string | null,
):
  | Readonly<Pick<PendingStagedApproval, 'store' | 'resolve' | 'reject'>>
  | null => pendingStagedApprovals.get(keyFor(sessionId)) ?? null;

export const hasPendingStagedApprovalFor = (sessionId: string): boolean =>
  pendingStagedApprovals.has(writeInteractionKey(sessionId));

export const resolvePendingStagedApproval = (
  decision: StagedApprovalDecision,
  sessionId?: string | null,
): void => {
  pendingStagedApprovals.get(keyFor(sessionId))?.resolve(decision);
};

export const cancelPendingStagedApproval = (
  reason?: string,
  sessionId?: string | null,
): void => {
  const key = sessionId ? writeInteractionKey(sessionId) : activeInteractionKey();
  pendingStagedApprovals.get(key)?.reject(new Error(reason || '用户丢弃了暂存改动'));
};

/**
 * 结束当前的等待状态，但保留暂存内容。
 * 用户停止回合或继续输入时，改动仍可在后续回合中审阅和继续修改。
 */
export const deferPendingStagedApproval = (
  sessionId?: string | null,
): void => {
  pendingStagedApprovals.get(keyFor(sessionId))?.resolve('deferred');
};

const finishIfReviewed = (sessionId?: string | null): void => {
  const pending = pendingStagedApprovals.get(keyFor(sessionId));
  if (!pending || pending.store.pendingEntriesList().length > 0) return;
  pending.resolve(pending.store.isEmpty() ? 'discarded' : 'approved');
};

/** 审批面板内就地编辑某文件 after 内容 */
export const updatePendingStagedAfter = (
  path: string,
  newAfter: string,
  sessionId?: string | null,
): void => {
  const pending = pendingStagedApprovals.get(keyFor(sessionId));
  if (!pending) return;
  pending.store.updateAfter(path, newAfter);
  bumpInteractionRevision();
};

/** 批准单个文件；approvedAfter 可传入仅保留已选 diff 区域后的最终内容。 */
export const approvePendingStagedEntry = (
  path: string,
  approvedAfter?: string,
  sessionId?: string | null,
): void => {
  const pending = pendingStagedApprovals.get(keyFor(sessionId));
  if (!pending) return;
  pending.store.approveEntry(path, approvedAfter);
  bumpInteractionRevision();
  finishIfReviewed(sessionId);
};

/** 审批面板内丢弃某文件（从暂存移除） */
export const discardPendingStagedEntry = (
  path: string,
  sessionId?: string | null,
): void => {
  const pending = pendingStagedApprovals.get(keyFor(sessionId));
  if (!pending) return;
  pending.store.discardEntry(path);
  bumpInteractionRevision();
  finishIfReviewed(sessionId);
};
