import { sessionEventsFile } from '../../config/constants';
import type { CottageEvent } from '../../platform/events/types';
import { isTraceEvent } from '../../platform/events/types';
import { workspace } from '../../workspace/FileSystemWorkspace';
import { isSessionEvent, type SessionEvent } from './types';

/**
 * 会话级 append-only 事件日志。
 * 缓冲后定时 flush，写入 `.cottage/sessions/{id}/events.jsonl`。
 * 不做字段截断：Debug / 回放需要完整真相。
 *
 * flush 必须串行：`appendCottageText` 是读 size → seek → write，
 * 并发 flush 会写到同一偏移并互相覆盖，导致恢复时丢失最后几条消息。
 */
export class SessionEventLog {
  private buffer: string[] = [];
  private flushTimer: number | undefined;
  private readonly flushDelayMs: number;
  /** 串行化所有 flush，避免并发 append 覆盖 */
  private flushChain: Promise<void> = Promise.resolve();
  /** 正在执行 flushOnce（buffer 已清空但尚未写完） */
  private writing = false;

  constructor(
    private readonly sessionId: string,
    options?: { flushDelayMs?: number },
  ) {
    this.flushDelayMs = options?.flushDelayMs ?? 300;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /** 缓冲中或正在写盘时仍有未完成落盘 */
  hasPending(): boolean {
    return this.buffer.length > 0 || this.writing;
  }

  append(event: SessionEvent): void {
    this.buffer.push(JSON.stringify(event));
    this.scheduleFlush();
  }

  appendMany(events: readonly SessionEvent[]): void {
    if (events.length === 0) return;
    for (const event of events) {
      this.buffer.push(JSON.stringify(event));
    }
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.flushTimer !== undefined) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    // 排队执行；前一次失败也不要卡死后续 flush
    const run = this.flushChain.catch(() => undefined).then(() => this.flushOnce());
    this.flushChain = run;
    await run;
  }

  private async flushOnce(): Promise<void> {
    if (this.buffer.length === 0) return;
    const pending = this.buffer;
    this.buffer = [];
    if (!workspace.isOpen) {
      // 工作区未打开时把缓冲放回，避免静默丢事件
      this.buffer = pending.concat(this.buffer);
      return;
    }
    const text = `${pending.join('\n')}\n`;
    this.writing = true;
    try {
      await workspace.appendCottageText(sessionEventsFile(this.sessionId), text);
    } catch {
      // 写盘失败时恢复缓冲，下次 flush 再试；不阻断主流程
      this.buffer = pending.concat(this.buffer);
    } finally {
      this.writing = false;
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, this.flushDelayMs);
  }

  /** 订阅 EventBus，持久化诊断类 TraceEvent */
  attach(bus: {
    subscribe: (handler: (event: CottageEvent) => void) => () => void;
  }): () => void {
    return bus.subscribe((event) => {
      if (isTraceEvent(event)) {
        this.append(event);
      }
    });
  }
}

export const parseSessionEventsText = (text: string | null | undefined): SessionEvent[] => {
  if (!text?.trim()) return [];
  const events: SessionEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isSessionEvent(parsed)) events.push(parsed);
    } catch {
      // 跳过半行损坏
    }
  }
  return events.sort((a, b) => a.at - b.at);
};

export const loadSessionEvents = async (
  sessionId: string,
): Promise<SessionEvent[]> => {
  if (!workspace.isOpen) return [];
  const text = await workspace.readCottageText(sessionEventsFile(sessionId));
  return parseSessionEventsText(text);
};

export const sessionEventsFileExists = async (
  sessionId: string,
): Promise<boolean> => {
  if (!workspace.isOpen) return false;
  const text = await workspace.readCottageText(sessionEventsFile(sessionId));
  // 空文件也算存在（新建会话 touch 占位）
  return text !== null;
};
