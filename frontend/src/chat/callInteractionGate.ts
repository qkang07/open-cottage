/**
 * 按「工具调用 id」等待用户交互结果。
 * 同一 callId 上挂起 Promise；UI 操作 resolve 后，工具循环继续拿 tool result。
 */
import {
  bumpInteractionRevision,
  interactionRevision,
  writeInteractionKey,
} from '../platform/interaction/interactionScope';

export type CallInteractionDecision =
  | { kind: 'tool_approval'; approved: boolean }
  | { kind: 'ask_user'; chosen: string };

interface PendingCallInteraction {
  resolve: (decision: CallInteractionDecision) => void;
  reject: (reason: Error) => void;
}

const pendingByKey = new Map<string, PendingCallInteraction>();

const keyOf = (sessionId: string | null | undefined, callId: string) =>
  `${writeInteractionKey(sessionId)}::${callId}`;

export const pendingCallInteractionRevision = interactionRevision;

export const waitForCallInteraction = (input: {
  sessionId?: string | null;
  callId: string;
  signal?: AbortSignal;
}): Promise<CallInteractionDecision> =>
  new Promise((resolve, reject) => {
    const key = keyOf(input.sessionId, input.callId);
    if (input.signal?.aborted) {
      reject(new Error('已取消'));
      return;
    }
    const onAbort = () => {
      pendingByKey.delete(key);
      bumpInteractionRevision();
      reject(new Error('已取消'));
    };
    input.signal?.addEventListener('abort', onAbort);

    // 同 call 重复等待：替换旧 waiter
    pendingByKey.get(key)?.reject(new Error('已被新的等待替换'));
    pendingByKey.set(key, {
      resolve: (decision) => {
        input.signal?.removeEventListener('abort', onAbort);
        pendingByKey.delete(key);
        bumpInteractionRevision();
        resolve(decision);
      },
      reject: (reason) => {
        input.signal?.removeEventListener('abort', onAbort);
        pendingByKey.delete(key);
        bumpInteractionRevision();
        reject(reason);
      },
    });
    bumpInteractionRevision();
  });

export const resolveCallInteraction = (
  callId: string,
  decision: CallInteractionDecision,
  sessionId?: string | null,
): boolean => {
  const pending = pendingByKey.get(keyOf(sessionId, callId));
  if (!pending) return false;
  pending.resolve(decision);
  return true;
};

export const hasPendingCallInteraction = (
  callId: string,
  sessionId?: string | null,
): boolean => pendingByKey.has(keyOf(sessionId, callId));

export const cancelCallInteraction = (
  callId: string,
  reason?: string,
  sessionId?: string | null,
): void => {
  pendingByKey.get(keyOf(sessionId, callId))?.reject(new Error(reason || '已取消'));
};

export const cancelAllCallInteractionsForSession = (
  sessionId: string,
  reason?: string,
): void => {
  const prefix = `${writeInteractionKey(sessionId)}::`;
  for (const [key, pending] of [...pendingByKey.entries()]) {
    if (!key.startsWith(prefix)) continue;
    pending.reject(new Error(reason || '会话已关闭'));
  }
};
