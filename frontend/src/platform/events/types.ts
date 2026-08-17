import type { TraceEvent } from '../trace/types';

/**
 * UI 专用事件（不落盘到 trace）。
 *
 * 这些事件由 CottageAgent 在关键节点 emit，供 UI 做细粒度动画
 * （状态条、工具进度、diff 预览）和供 Conversation Checkpoint 自动建点。
 */
export interface TaskStartedEvent {
  type: 'task_started';
  at: number;
  mode: 'chat' | 'task' | 'plan' | 'spec';
}

export interface TaskFinishedEvent {
  type: 'task_finished';
  at: number;
  endReason: string;
}

export interface ToolCallingEvent {
  type: 'tool_calling';
  at: number;
  toolName: string;
  callId: string;
  round: number;
}

export interface ToolStreamingEvent {
  type: 'tool_streaming';
  at: number;
  toolName: string;
  callId: string;
  chunkCount: number;
}

export interface ToolFinishedEvent {
  type: 'tool_finished';
  at: number;
  toolName: string;
  callId: string;
  status: 'ok' | 'error' | 'blocked';
}

export interface PatchAppliedEvent {
  type: 'patch_applied';
  at: number;
  toolName: string;
  path: string;
  created: boolean;
}

export interface NeedConfirmationEvent {
  type: 'need_confirmation';
  at: number;
  toolName: string;
  callId: string;
}

export interface CheckpointCreatedEvent {
  type: 'checkpoint_created';
  at: number;
  checkpointId: string;
  trigger: string;
  label: string;
}

export interface CheckpointRewoundEvent {
  type: 'checkpoint_rewound';
  at: number;
  checkpointId: string;
}

export interface SessionResumedEvent {
  type: 'session_resumed';
  at: number;
  sessionId: string;
  interrupted: boolean;
}

export interface SessionPausedEvent {
  type: 'session_paused';
  at: number;
  sessionId: string;
}

export interface NeedStagedReviewEvent {
  type: 'need_staged_review';
  at: number;
  fileCount: number;
}

export interface StagedCommittedEvent {
  type: 'staged_committed';
  at: number;
  fileCount: number;
}

export interface StagedDiscardedEvent {
  type: 'staged_discarded';
  at: number;
  fileCount: number;
}

export type UiEvent =
  | TaskStartedEvent
  | TaskFinishedEvent
  | ToolCallingEvent
  | ToolStreamingEvent
  | ToolFinishedEvent
  | PatchAppliedEvent
  | NeedConfirmationEvent
  | CheckpointCreatedEvent
  | CheckpointRewoundEvent
  | SessionResumedEvent
  | SessionPausedEvent
  | NeedStagedReviewEvent
  | StagedCommittedEvent
  | StagedDiscardedEvent;

/**
 * 统一事件类型：trace 持久化事件 + UI 专用事件。
 * EventBus 分发此联合类型；TraceRecorder 订阅后只处理 TraceEvent 子集。
 */
export type CottageEvent = TraceEvent | UiEvent;

/** 判断事件是否为 trace 持久化类型（用于 TraceRecorder 过滤） */
const TRACE_EVENT_TYPES = new Set([
  'tool_call',
  'plan',
  'verify',
  'turn_start',
  'turn_end',
  'model_call',
  'handoff',
  'compaction',
]);

export const isTraceEvent = (event: CottageEvent): event is TraceEvent =>
  TRACE_EVENT_TYPES.has(event.type);
