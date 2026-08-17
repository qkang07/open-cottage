import { newMessageId, type StoredMessage } from '../../agent/messages';
import type { ToolCallInteraction } from '../../chat/toolCallInteraction';
import type { ChatSessionRuntimeMeta } from '../../config/constants';
import type { TraceEvent } from '../../platform/trace/types';
import {
  isDiagnosticEvent,
  type SessionEvent,
  type SessionMessageEvent,
} from './types';

export interface SessionProjectedState {
  /** 聊天面板完整上下文（含压缩前消息） */
  transcript: StoredMessage[];
  /** 发给模型的上下文投影（自下而上应用 compaction） */
  llmHistory: StoredMessage[];
  /** 最新 runtime 快照 */
  runtime: ChatSessionRuntimeMeta | null;
  /** 执行/诊断事件 */
  diagnostics: TraceEvent[];
  events: SessionEvent[];
}

export const ensureMessageId = (message: StoredMessage): StoredMessage => {
  if (message.id) return message;
  return { ...message, id: newMessageId() };
};

export const ensureMessageIds = (
  messages: readonly StoredMessage[],
): StoredMessage[] => messages.map((message) => ensureMessageId(message));

const patchToolInteraction = (
  messages: StoredMessage[],
  callId: string,
  interaction: ToolCallInteraction,
): boolean => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.toolCalls?.length) continue;
    const callIndex = msg.toolCalls.findIndex((call) => call.id === callId);
    if (callIndex < 0) continue;
    const toolCalls = msg.toolCalls.slice();
    toolCalls[callIndex] = { ...toolCalls[callIndex], interaction };
    messages[i] = { ...msg, toolCalls };
    return true;
  }
  return false;
};

/** 正序折叠 message 事件；末尾可附带最新 draft；应用 tool_interaction 补丁 */
export const projectTranscript = (events: readonly SessionEvent[]): StoredMessage[] => {
  const transcript: StoredMessage[] = [];
  // tool_interaction 可能在对应 message/draft 落盘前抵达。保留每个调用的
  // 最新状态，并在消息齐全后再补一次，避免已回答的问询卡片在恢复后丢失。
  const interactionPatches = new Map<string, ToolCallInteraction>();
  let draft: StoredMessage | null = null;
  let draftAt = -1;
  let lastMessageAt = -1;

  for (const event of events) {
    if (event.type === 'message') {
      transcript.push(ensureMessageId(event.message));
      lastMessageAt = event.at;
      if (draft && draftAt <= lastMessageAt) {
        draft = null;
        draftAt = -1;
      }
    } else if (event.type === 'draft') {
      draft = ensureMessageId(event.message);
      draftAt = event.at;
    } else if (event.type === 'tool_interaction') {
      interactionPatches.set(event.callId, event.interaction);
      if (!patchToolInteraction(transcript, event.callId, event.interaction) && draft) {
        const draftList: StoredMessage[] = [draft];
        if (patchToolInteraction(draftList, event.callId, event.interaction)) {
          draft = draftList[0] ?? draft;
        }
      }
    }
  }

  // 回放顺序不能保证交互事件一定晚于消息事件；这里以事件流中最后一次
  // 状态为准，给已投影的消息和尾部草稿统一回填。
  for (const [callId, interaction] of interactionPatches) {
    patchToolInteraction(transcript, callId, interaction);
    if (draft) {
      const draftList: StoredMessage[] = [draft];
      if (patchToolInteraction(draftList, callId, interaction)) {
        draft = draftList[0] ?? draft;
      }
    }
  }

  if (draft && draftAt > lastMessageAt) {
    transcript.push(draft);
  }
  return transcript;
};

/**
 * 按时间正序应用事件，得到 LLM 上下文：
 * - message → 追加
 * - compaction → 用 summary 替换 coveredMessageIds 对应消息
 * - tool_interaction → 同步补丁（不进 LLM 请求体，但保持投影一致）
 */
export const projectLlmHistory = (events: readonly SessionEvent[]): StoredMessage[] => {
  let llm: StoredMessage[] = [];
  const interactionPatches = new Map<string, ToolCallInteraction>();

  for (const event of events) {
    if (event.type === 'message') {
      llm.push(ensureMessageId(event.message));
      continue;
    }
    if (event.type === 'tool_interaction') {
      interactionPatches.set(event.callId, event.interaction);
      patchToolInteraction(llm, event.callId, event.interaction);
      continue;
    }
    if (event.type !== 'compaction') continue;
    const summary = event.summaryMessage
      ? ensureMessageId(event.summaryMessage)
      : null;
    const covered = new Set(event.coveredMessageIds ?? []);
    if (covered.size === 0 && !summary) continue;
    const kept = llm.filter((message) => !message.id || !covered.has(message.id));
    llm = summary ? [summary, ...kept] : kept;
  }

  for (const [callId, interaction] of interactionPatches) {
    patchToolInteraction(llm, callId, interaction);
  }

  return llm;
};

export const projectRuntime = (
  events: readonly SessionEvent[],
): ChatSessionRuntimeMeta | null => {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event.type === 'runtime') return event.runtime;
  }
  return null;
};

export const projectDiagnostics = (events: readonly SessionEvent[]): TraceEvent[] =>
  events.filter(isDiagnosticEvent);

export const projectSessionState = (
  events: readonly SessionEvent[],
): SessionProjectedState => ({
  transcript: projectTranscript(events),
  llmHistory: projectLlmHistory(events),
  runtime: projectRuntime(events),
  diagnostics: projectDiagnostics(events),
  events: [...events],
});

/** 从旧版扁平 history 合成 message 事件（迁移用） */
export const messagesToEvents = (
  messages: readonly StoredMessage[],
  baseAt = Date.now(),
): SessionMessageEvent[] =>
  ensureMessageIds(messages).map((message, index) => ({
    type: 'message' as const,
    at: baseAt + index,
    message,
  }));
