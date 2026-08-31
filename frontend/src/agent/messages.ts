import type { StoredFileReference } from '../chat/userMessageFormat';
import type { ChatAttachment } from '../chat/attachments';
import type { ToolCallInteraction } from '../chat/toolCallInteraction';
import type { OrchestrationState } from '../orchestrator/types';
import type { SpecDoc } from '../spec/types';
import type { PlanDefinition, PlanRun } from '../plan/types';
import {
  createCottageThinkStreamState,
  feedCottageThinkingChunk,
  flushCottageThinkingCarry,
  splitCottageThinking,
  type CottageThinkStreamState,
} from './cottageThinking';

/** 持久化与 UI 共用的消息结构（通过 runtime adapter 转换为模型消息） */

export type StoredMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type { StoredFileReference };

export interface StoredToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * 用户交互态（批准 / 提问等）。
   * 有 pending 且尚无对应 tool message 时，表示工具循环正等用户；
   * 用户操作结果写入 tool message，interaction 标为 resolved。
   * 不进入 LLM 请求体（storedToRuntime 忽略此字段即可）。
   */
  interaction?: ToolCallInteraction;
}

export interface StoredMessage {
  /** 稳定 id，用于 compaction 覆盖引用与事件日志关联 */
  id?: string;
  role: StoredMessageRole;
  content: string;
  /** 助手回合最终落盘时间（UI 展示用；不进入 LLM 请求体） */
  completedAt?: number;
  /** Kimi thinking 模式回传用；缺省时由请求层补占位空格 */
  reasoningContent?: string;
  /** 用户消息：输入框原文（UI） */
  userText?: string;
  /** 用户消息：引用文件列表（UI + 可解析） */
  fileReferences?: StoredFileReference[];
  activeFilePath?: string;
  /** 多模态附件（图片等） */
  attachments?: ChatAttachment[];
  toolCalls?: StoredToolCall[];
  toolCallId?: string;
  name?: string;
  /** 工具调用被 abort 中断，无真实结果 */
  interrupted?: boolean;
  /** 合成消息（compaction 摘要、system-reminder 等），UI 可特殊展示 */
  synthetic?: boolean;
  /** 由 compaction 生成的摘要消息 */
  compaction?: boolean;
  /**
   * 展示用错误文案（调用失败 / 停止 / 内容过滤等）。
   * 不进入 LLM 请求体；重建 UI 时还原错误横幅。
   */
  error?: string;
  /**
   * 文件写入工具的前后内容预览（UI diff）；不进入 LLM 请求体。
   * 仅 tool 消息使用。
   */
  writePreview?: {
    before?: string;
    after?: string;
    created?: boolean;
  };
}

/**
 * 旧版工具循环曾把 UI 气泡的累计正文整段落盘（A、A+B、A+B+C），
 * 新版改为每轮只写增量。加载时把可识别的旧累计链切成增量，便于重建直接 append。
 *
 * 判定（同一 user 回合内）：
 * - 出现连续相同非空 content（旧 bug 最常见）；或
 * - 至少 3 段非空且单调前缀增长，且长度和 ≥ 末段×2（平方膨胀）
 *
 * 无法区分的歧义（仅两段且为前缀关系、无重复）保持原样，避免误伤增量雪球复读。
 */
export const normalizeLegacyCumulativeAssistantDeltas = (
  history: readonly StoredMessage[],
): StoredMessage[] => {
  const turns: StoredMessage[][] = [];
  let turn: StoredMessage[] = [];
  const flush = () => {
    if (turn.length) turns.push(turn);
    turn = [];
  };
  for (const msg of history) {
    if (msg.role === 'user') {
      flush();
      turns.push([msg]);
      continue;
    }
    turn.push(msg);
  }
  flush();

  const isLegacyCumulative = (assistants: StoredMessage[]): boolean => {
    const nonempty = assistants
      .map((m) => m.content || '')
      .filter((c) => c.length > 0);
    if (nonempty.length < 2) return false;
    for (let i = 1; i < nonempty.length; i += 1) {
      if (nonempty[i] === nonempty[i - 1]) return true;
    }
    if (nonempty.length < 3) return false;
    for (let i = 1; i < nonempty.length; i += 1) {
      if (!nonempty[i].startsWith(nonempty[i - 1])) return false;
    }
    const last = nonempty[nonempty.length - 1]!;
    const sum = nonempty.reduce((s, c) => s + c.length, 0);
    return sum >= last.length * 2;
  };

  const toDeltas = (assistants: StoredMessage[]): StoredMessage[] => {
    let lastContent = '';
    let lastReasoning = '';
    return assistants.map((msg) => {
      if (msg.role !== 'assistant') return msg;
      let content = msg.content || '';
      let reasoningContent = msg.reasoningContent;
      if (content) {
        if (lastContent && content.startsWith(lastContent)) {
          content = content.slice(lastContent.length);
        } else if (content === lastContent) {
          content = '';
        }
        lastContent = msg.content || lastContent;
      }
      if (reasoningContent && reasoningContent.trim()) {
        let next = reasoningContent;
        if (lastReasoning && next.startsWith(lastReasoning)) {
          next = next.slice(lastReasoning.length);
        } else if (next === lastReasoning) {
          next = '';
        }
        lastReasoning = reasoningContent;
        reasoningContent = next.trim() ? next : undefined;
      }
      if (content === (msg.content || '') && reasoningContent === msg.reasoningContent) {
        return msg;
      }
      return { ...msg, content, reasoningContent };
    });
  };

  const out: StoredMessage[] = [];
  for (const group of turns) {
    if (group.length === 1 && group[0]?.role === 'user') {
      out.push(group[0]);
      continue;
    }
    const assistants = group.filter((m) => m.role === 'assistant');
    if (isLegacyCumulative(assistants)) {
      const remapped = toDeltas(group);
      out.push(...remapped);
    } else {
      out.push(...group);
    }
  }
  return out;
};

export type CottageSection =
  | { type: 'content'; text: string; streaming?: boolean }
  | { type: 'think'; text: string; streaming?: boolean }
  | {
      type: 'call';
      id: string;
      name: string;
      arguments: string;
      result?: string;
      running?: boolean;
      /** LLM 流式生成工具参数中 */
      argsStreaming?: boolean;
      /** 用户交互（批准/提问）：与 StoredToolCall.interaction 同步，工具循环的一部分 */
      interaction?: ToolCallInteraction;
      /** UI-only：文件写入前后内容，用于渲染 diff（不进入 LLM 结果文本） */
      before?: string;
      after?: string;
      /** UI-only：Worker 预计算的 unified diff */
      diffText?: string;
      /** UI-only：是否为新建文件 */
      created?: boolean;
    }
  | {
      type: 'orchestration';
      orchestrationId: string;
      state: OrchestrationState;
    }
  | {
      type: 'spec';
      specId: string;
      doc: SpecDoc;
    }
  | {
      type: 'plan';
      planId: string;
      definition: PlanDefinition;
      run: PlanRun;
    };

export type CottageMessageRole = 'user' | 'assistant' | 'system';

export interface CottageMessage {
  id: string;
  role: CottageMessageRole;
  sections: CottageSection[];
  userText?: string;
  fileReferences?: StoredFileReference[];
  activeFilePath?: string;
  /** 用户消息的图片附件（UI 缩略图展示） */
  attachments?: ChatAttachment[];
  error?: string;
  /** 助手最终输出完成时间（UI 工具行展示） */
  completedAt?: number;
  /** 流式解析 <cottage_thinking> 的内部状态（不持久化） */
  _thinkStream?: CottageThinkStreamState;
}

export const newMessageId = () => crypto.randomUUID();

export type UserMessagePayload = {
  llmContent: string;
  userText: string;
  fileReferences?: readonly StoredFileReference[];
  activeFilePath?: string;
  attachments?: ChatAttachment[];
};

export const createUserMessage = (payload: UserMessagePayload): CottageMessage => ({
  id: newMessageId(),
  role: 'user',
  userText: payload.userText,
  fileReferences: payload.fileReferences?.length
    ? [...payload.fileReferences]
    : undefined,
  activeFilePath: payload.activeFilePath,
  attachments: payload.attachments?.length
    ? payload.attachments.map((att) => ({ ...att }))
    : undefined,
  sections: [{ type: 'content', text: payload.llmContent }],
});

export const createAssistantMessage = (): CottageMessage => ({
  id: newMessageId(),
  role: 'assistant',
  sections: [],
});

const joinAdjacentThinkText = (left: string, right: string): string => {
  if (!left) return right;
  if (!right) return left;
  if (/\s$/.test(left) || /^\s/.test(right)) return left + right;
  return `${left}\n\n${right}`;
};

/**
 * 合并真正相邻的思考段；正文、工具调用等 section 都是不可跨越的边界。
 * 返回新数组且不改写传入 section，供历史恢复与渲染投影安全复用。
 */
export const mergeAdjacentThinkSections = (
  sections: readonly CottageSection[],
): CottageSection[] => {
  const merged: CottageSection[] = [];
  for (const section of sections) {
    const previous = merged[merged.length - 1];
    if (previous?.type === 'think' && section.type === 'think') {
      merged[merged.length - 1] = {
        type: 'think',
        text: joinAdjacentThinkText(previous.text, section.text),
        streaming: Boolean(previous.streaming || section.streaming),
      };
      continue;
    }
    merged.push(section);
  }
  return merged;
};

const appendStreamingContent = (msg: CottageMessage, chunk: string) => {
  if (!chunk) return;
  const last = msg.sections[msg.sections.length - 1];
  if (last?.type === 'content' && last.streaming) {
    last.text += chunk;
    return;
  }
  // 新开正文段前先收起旧段光标，避免工具轮次后多段同时闪烁
  sealAssistantTextStreaming(msg);
  msg.sections.push({ type: 'content', text: chunk, streaming: true });
};

const appendStreamingThinkFromTag = (msg: CottageMessage, chunk: string) => {
  if (!chunk) return;
  // 标签流式思考：优先追加到末尾正在 streaming 的 think；
  // 若当前 think 由 API reasoning 占用且已有内容，则新开一个 think section。
  const last = msg.sections[msg.sections.length - 1];
  if (last?.type === 'think' && last.streaming) {
    last.text += chunk;
    return;
  }
  const streamingThink = findStreamingThink(msg);
  if (streamingThink && !streamingThink.text) {
    streamingThink.text += chunk;
    return;
  }
  msg.sections.push({ type: 'think', text: chunk, streaming: true });
};

export const appendAssistantText = (msg: CottageMessage, chunk: string) => {
  if (!chunk) return;
  if (!msg._thinkStream) {
    msg._thinkStream = createCottageThinkStreamState();
  }
  const parts = feedCottageThinkingChunk(msg._thinkStream, chunk);
  for (const part of parts) {
    if (part.type === 'think') {
      appendStreamingThinkFromTag(msg, part.text);
    } else {
      appendStreamingContent(msg, part.text);
    }
  }
};

/** 把不含标签解析状态的完整文本拆成 content/think sections（历史恢复用） */
export const pushContentWithCottageThinking = (
  msg: CottageMessage,
  text: string,
  opts?: { preferExistingThink?: boolean },
) => {
  if (!text) return;
  const parts = splitCottageThinking(text);
  const hasThinkParts = parts.some((p) => p.type === 'think' && p.text.trim());
  for (const part of parts) {
    if (part.type === 'think') {
      if (opts?.preferExistingThink && hasThinkParts) {
        // 已有 reasoningContent 时仍剥离正文标签，但不再重复插入 think
        continue;
      }
      if (!part.text.trim()) continue;
      msg.sections.push({ type: 'think', text: part.text });
    } else if (part.text) {
      msg.sections.push({ type: 'content', text: part.text.replace(/^\n+/, '') });
    }
  }
};

export const finalizeAssistantStreaming = (msg: CottageMessage) => {
  if (msg._thinkStream) {
    const flushed = flushCottageThinkingCarry(msg._thinkStream);
    if (flushed) {
      if (flushed.type === 'think') {
        appendStreamingThinkFromTag(msg, flushed.text);
      } else {
        appendStreamingContent(msg, flushed.text);
      }
    }
    delete msg._thinkStream;
  }
  sealAssistantTextStreaming(msg);
  for (const section of msg.sections) {
    if (section.type === 'call') {
      section.running = false;
      section.argsStreaming = false;
    }
  }
  for (let i = msg.sections.length - 1; i >= 0; i--) {
    const section = msg.sections[i];
    if (section.type === 'think' && !section.text.trim()) {
      msg.sections.splice(i, 1);
    }
  }
  msg.sections.splice(
    0,
    msg.sections.length,
    ...mergeAdjacentThinkSections(msg.sections),
  );
};

/** 收起正文/思考的流式光标（工具调用开始或新开段时调用） */
export const sealAssistantTextStreaming = (msg: CottageMessage) => {
  for (const section of msg.sections) {
    if (section.type === 'content' || section.type === 'think') {
      section.streaming = false;
    }
  }
};

const insertThinkSection = (
  msg: CottageMessage,
  section: Extract<CottageSection, { type: 'think' }>,
) => {
  const firstContentIdx = msg.sections.findIndex((s) => s.type === 'content');
  if (firstContentIdx >= 0) {
    msg.sections.splice(firstContentIdx, 0, section);
  } else {
    msg.sections.push(section);
  }
};

const findStreamingThink = (msg: CottageMessage) =>
  msg.sections.find(
    (s): s is Extract<CottageSection, { type: 'think' }> =>
      s.type === 'think' && Boolean(s.streaming),
  );

export const beginAssistantThinkStreaming = (msg: CottageMessage) => {
  if (findStreamingThink(msg)) return;
  insertThinkSection(msg, { type: 'think', text: '', streaming: true });
};

/** API reasoning delta：同一流追加；新流仅在与上一思考相邻时合并。 */
export const appendAssistantThink = (msg: CottageMessage, chunk: string) => {
  if (!chunk) return;
  const existing = findStreamingThink(msg);
  if (existing) {
    existing.text += chunk;
    return;
  }

  const firstContentIdx = msg.sections.findIndex((s) => s.type === 'content');
  const insertAt = firstContentIdx >= 0 ? firstContentIdx : msg.sections.length;
  const previous = msg.sections[insertAt - 1];
  if (previous?.type === 'think') {
    previous.text = joinAdjacentThinkText(previous.text, chunk);
    previous.streaming = true;
    return;
  }
  msg.sections.splice(insertAt, 0, {
    type: 'think',
    text: chunk,
    streaming: true,
  });
};
