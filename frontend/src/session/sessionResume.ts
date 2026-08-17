import { workspace } from '../workspace/FileSystemWorkspace';
import { loadLastCheckpoint, loadCheckpointSnapshot, loadPlanState } from '../agent/conversationCheckpoint';
import { getSession, clearInterrupted } from './sessionRegistry';
import type { SessionMeta } from './sessionRegistry';
import type { StoredMessage } from '../agent/messages';
import type { ContextUsage } from '../agent/tokenCounter';
import type { PlanStateSnapshot } from '../agent/conversationCheckpoint';
import type { EventBus } from '../platform/events';

export interface ResumedSession {
  session: SessionMeta;
  history: StoredMessage[];
  contextUsage: ContextUsage | null;
  planState: PlanStateSnapshot | null;
  interrupted: boolean;
}

/**
 * 加载会话最近一次 checkpoint，还原对话历史和 plan 状态。
 *
 * 若会话标记为 interrupted（上次 busy 时崩溃），返回 interrupted: true，
 * 由调用方决定提示"上次未完成，可继续或回滚"。
 */
export async function resumeSession(
  sessionId: string,
): Promise<ResumedSession | null> {
  const session = await getSession(sessionId);
  if (!session) return null;

  const checkpoint = await loadLastCheckpoint(sessionId);
  let history: StoredMessage[] = [];
  let contextUsage: ContextUsage | null = null;
  let planState: PlanStateSnapshot | null = null;

  if (checkpoint) {
    const snapshot = await loadCheckpointSnapshot(checkpoint);
    history = snapshot.history;
    contextUsage = snapshot.contextUsage;
    planState = snapshot.planState;
  }

  // 若 checkpoint 没有 planState，尝试从 plan.json 加载
  if (!planState) {
    planState = await loadPlanState(sessionId);
  }

  return {
    session,
    history,
    contextUsage,
    planState,
    interrupted: session.interrupted ?? false,
  };
}

/**
 * 会话恢复成功后清除 interrupted 标记，并发出 SessionResumed 事件。
 */
export async function completeResume(
  sessionId: string,
  eventBus?: EventBus | null,
): Promise<void> {
  await clearInterrupted(sessionId);
  eventBus?.emit({
    type: 'session_resumed',
    at: Date.now(),
    sessionId,
    interrupted: false,
  });
}

/**
 * 检测旧 trace 路径并迁移到 sessions/{id}/trace.jsonl。
 * 迁移失败时静默，读取时先试新路径再回退旧路径（见 todo 16）。
 */
export async function migrateTraceFile(sessionId: string): Promise<void> {
  const newPath = `sessions/${sessionId}/trace.jsonl`;
  const existing = await workspace.readCottageText(newPath);
  if (existing) return; // 新路径已有，无需迁移

  // 尝试旧路径
  const { traceFile } = await import('../config/constants');
  const oldPath = traceFile(sessionId);
  const oldText = await workspace.readCottageText(oldPath);
  if (!oldText?.trim()) return;

  await workspace.writeCottageText(newPath, oldText);
}
