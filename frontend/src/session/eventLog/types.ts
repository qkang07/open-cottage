import type { StoredMessage } from '../../agent/messages';
import type { ToolCallInteraction } from '../../chat/toolCallInteraction';
import type { ChatSessionRuntimeMeta } from '../../config/constants';
import type { TraceEvent } from '../../platform/trace/types';

/**
 * 会话单一 append-only 事件日志。
 *
 * - message：展示 transcript（永不删除）
 * - draft：在途助手草稿
 * - runtime：模型/系统提示等元信息快照
 * - tool_interaction：审批 / 提问状态变更（刷新后可恢复）
 * - 其余 TraceEvent：执行节点
 */
export interface SessionMessageEvent {
  type: 'message';
  at: number;
  message: StoredMessage;
}

export interface SessionDraftEvent {
  type: 'draft';
  at: number;
  message: StoredMessage;
}

export interface SessionRuntimeEvent {
  type: 'runtime';
  at: number;
  runtime: ChatSessionRuntimeMeta;
}

/** 工具调用上的用户交互态落盘（pending → resolved/cancelled） */
export interface SessionToolInteractionEvent {
  type: 'tool_interaction';
  at: number;
  callId: string;
  interaction: ToolCallInteraction;
}

export type SessionEvent =
  | SessionMessageEvent
  | SessionDraftEvent
  | SessionRuntimeEvent
  | SessionToolInteractionEvent
  | TraceEvent;

export const DIAGNOSTIC_EVENT_TYPES = new Set<string>([
  'tool_call',
  'plan',
  'verify',
  'turn_start',
  'turn_end',
  'model_call',
  'handoff',
  'compaction',
]);

export const isDiagnosticEvent = (event: SessionEvent): event is TraceEvent =>
  DIAGNOSTIC_EVENT_TYPES.has(event.type);

export const isSessionEvent = (value: unknown): value is SessionEvent => {
  if (!value || typeof value !== 'object') return false;
  const event = value as { type?: unknown; at?: unknown };
  return typeof event.type === 'string' && typeof event.at === 'number';
};
