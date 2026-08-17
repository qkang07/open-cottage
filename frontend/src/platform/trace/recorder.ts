/**
 * 兼容旧名 TraceRecorder：实际写入 sessions/{id}/events.jsonl，且不再截断。
 */
import { SessionEventLog } from '../../session/eventLog';
import type { SessionEvent } from '../../session/eventLog';
import type { TraceEvent } from './types';
import {
  loadSessionEvents,
  ensureSessionEventsMigrated,
} from '../../session/eventLog';
import { isDiagnosticEvent } from '../../session/eventLog';

export class TraceRecorder extends SessionEventLog {
  /** @deprecated 使用 append(SessionEvent)；保留以兼容旧调用 */
  override append(event: SessionEvent | TraceEvent): void {
    super.append(event);
  }
}

/** 读取诊断事件（从 events.jsonl 投影；必要时先迁移旧数据） */
export const loadTraceEvents = async (sessionId: string): Promise<TraceEvent[]> => {
  const events = await ensureSessionEventsMigrated(sessionId);
  return events.filter(isDiagnosticEvent);
};

/** 原始事件（含 message/draft/runtime） */
export { loadSessionEvents };
