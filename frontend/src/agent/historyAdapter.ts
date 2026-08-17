import type { ChatAttachment } from '../chat/attachments';
import {
  isAttachmentPath,
  resolveAttachmentDataUrl,
} from '../chat/attachmentStorage';
import type { StoredMessage, StoredToolCall } from './messages';
import type { CottageModelMessage } from './runtime/model';

/** 附件已落盘的工作区路径（模型可用文件工具按路径操作原图） */
export const attachmentWorkspacePath = (
  att: ChatAttachment,
): string | undefined =>
  att.sourcePath ?? (isAttachmentPath(att.data) ? att.data : undefined);

/** 可直接发给模型的附件（仅 data URL / http(s)，路径态未 hydrate 则跳过） */
const sendableAttachments = (
  attachments: readonly ChatAttachment[] | undefined,
): ChatAttachment[] =>
  (attachments ?? []).filter(
    (a) => a.data.startsWith('data:') || /^https?:\/\//.test(a.data),
  );

const imagePartsOf = (attachments: readonly ChatAttachment[]) =>
  attachments.map((a) => ({
    type: 'image' as const,
    url: a.data,
    mediaType: a.mimeType,
  }));

/**
 * 附件说明文本（每件一行）：标注文件名与落盘路径，
 * 使模型能用文件工具（copy 等）或 saveChatAttachment 操作附件。
 */
export const attachmentNoteText = (
  attachments: readonly ChatAttachment[],
): string =>
  attachments
    .map((a) => {
      const path = attachmentWorkspacePath(a);
      return path ? `[图片附件 ${a.filename}: ${path}]` : `[图片附件 ${a.filename}]`;
    })
    .join('\n');

/** 工具图片 synthetic user message 的说明文本（含附件路径注记） */
export const toolImagesNoteText = (
  toolName: string | undefined,
  attachments: readonly ChatAttachment[],
): string =>
  [`[工具 ${toolName ?? 'tool'} 返回的图片]`, attachmentNoteText(attachments)]
    .filter(Boolean)
    .join('\n');

export const storedToRuntime = (
  messages: readonly StoredMessage[],
): CottageModelMessage[] =>
  messages.flatMap((msg): CottageModelMessage[] => {
    if (msg.role === 'system') {
      return [{ role: 'system', content: msg.content }];
    }
    if (msg.role === 'user') {
      // 多模态消息：包含图片附件时构建多内容格式，text part 附带附件路径注记
      const sendable = sendableAttachments(msg.attachments);
      if (sendable.length) {
        const text = [msg.content, attachmentNoteText(sendable)]
          .filter(Boolean)
          .join('\n');
        return [
          {
            role: 'user',
            content: [
              ...(text ? [{ type: 'text' as const, text }] : []),
              ...imagePartsOf(sendable),
            ],
          },
        ];
      }
      return [{ role: 'user', content: msg.content }];
    }
    if (msg.role === 'tool') {
      const toolMsg: CottageModelMessage = {
        role: 'tool',
        content: msg.content,
        toolCallId: msg.toolCallId ?? '',
        name: msg.name,
        isError: Boolean(msg.error),
      };
      // OpenAI 协议 tool 消息不支持图片：紧跟一条 synthetic user message 携带图片
      const sendable = sendableAttachments(msg.attachments);
      if (sendable.length) {
        return [
          toolMsg,
          {
            role: 'user',
            content: [
              {
                type: 'text' as const,
                text: toolImagesNoteText(msg.name, sendable),
              },
              ...imagePartsOf(sendable),
            ],
          },
        ];
      }
      return [toolMsg];
    }
    const toolCalls = msg.toolCalls?.map((call) => ({
      id: call.id,
      name: call.name,
      args: call.args,
    }));
    return [
      {
        role: 'assistant',
        content: msg.content,
        toolCalls,
        reasoningContent: msg.reasoningContent,
      },
    ];
  });

/**
 * 发送 LLM 前的附件 hydrate：路径态附件异步解析回 data URL；
 * 当前模型不支持 vision 时直接剔除附件（避免请求 400）；解析失败的图跳过。
 */
export const hydrateAttachmentsForLlm = async (
  messages: readonly StoredMessage[],
  supportsVision: boolean,
  resolve: (att: ChatAttachment) => Promise<string | null> = resolveAttachmentDataUrl,
): Promise<StoredMessage[]> =>
  Promise.all(
    messages.map(async (msg) => {
      if (!msg.attachments?.length) return msg;
      if (!supportsVision) return { ...msg, attachments: undefined };
      const resolved = await Promise.all(
        msg.attachments.map(async (att) => {
          const data = await resolve(att);
          if (!data) return null;
          // 路径态附件解析后保留原路径，供消息注记/工具操作引用
          return isAttachmentPath(att.data)
            ? { ...att, data, sourcePath: att.data }
            : { ...att, data };
        }),
      );
      const kept = resolved.filter((att): att is ChatAttachment => att !== null);
      return { ...msg, attachments: kept.length ? kept : undefined };
    }),
  );

export const runtimeToStored = (
  messages: readonly CottageModelMessage[],
): StoredMessage[] =>
  messages
    .filter((message) => message.role !== 'system')
    .map((message): StoredMessage => {
      if (message.role === 'user') {
        const content =
          typeof message.content === 'string'
            ? message.content
            : message.content
                .filter((part) => part.type === 'text')
                .map((part) => part.text)
                .join('');
        return { role: 'user', content };
      }
      if (message.role === 'tool') {
        return {
          role: 'tool',
          content: message.content,
          toolCallId: message.toolCallId,
          name: message.name,
          error: message.isError ? message.content : undefined,
        };
      }
      return {
        role: 'assistant',
        content: message.content,
        toolCalls: message.toolCalls,
        reasoningContent: message.reasoningContent,
      };
    });

export const extractSystemPrompt = (
  messages: readonly StoredMessage[],
): { system: string; rest: StoredMessage[] } => {
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const system = systemMsgs.map((m) => m.content).join('\n\n');
  return { system, rest };
};

/**
 * 修复对话历史：确保每个带 tool_calls 的 assistant 消息后面都有对应 tool_call_id 的 tool 消息。
 * 如果缺失（例如异常中断、持久化不完整），插入占位 tool message，避免后续发给 LLM 时触发
 * "tool_call_ids did not have response messages" 错误。
 *
 * 仍带 pending interaction 的 call 不补占位——那是工具循环在等用户。
 */
export const repairToolCallHistory = (
  messages: readonly StoredMessage[],
  options?: { skipCallIds?: ReadonlySet<string> },
): StoredMessage[] => {
  const result: StoredMessage[] = [];
  let pendingToolCalls: StoredToolCall[] = [];
  const skipCallIds = options?.skipCallIds;

  const shouldSkip = (call: StoredToolCall) =>
    Boolean(skipCallIds?.has(call.id)) ||
    call.interaction?.status === 'pending';

  const flushPending = () => {
    for (const call of pendingToolCalls) {
      if (shouldSkip(call)) continue;
      result.push({
        role: 'tool',
        content: '[已中断或缺失]',
        toolCallId: call.id,
        name: call.name,
        interrupted: true,
      });
    }
    pendingToolCalls = [];
  };

  for (const message of messages) {
    if (message.role === 'tool') {
      const matchedIndex = message.toolCallId
        ? pendingToolCalls.findIndex((call) => call.id === message.toolCallId)
        : pendingToolCalls.length === 1
          ? 0
          : -1;
      if (matchedIndex >= 0) {
        const matched = pendingToolCalls[matchedIndex]!;
        result.push({
          ...message,
          toolCallId: matched.id,
          name: message.name ?? matched.name,
        });
        pendingToolCalls.splice(matchedIndex, 1);
      }
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      flushPending();
      pendingToolCalls = message.toolCalls.map((call) => ({
        ...call,
        id: call.id?.trim() || crypto.randomUUID(),
      }));
      // 写入 result 的必须是独立数组副本：后续匹配到 tool 结果时会从
      // pendingToolCalls 里 splice，若共享同一引用，会把已入列 assistant
      // 消息的 toolCalls 一并清空，导致重建 UI 时工具调用卡片全部丢失。
      result.push({ ...message, toolCalls: [...pendingToolCalls] });
      continue;
    }

    flushPending();
    result.push(message);
  }

  flushPending();
  return result;
};

/** 历史中仍在等待用户的工具调用 id */
export const pendingInteractionCallIds = (
  messages: readonly StoredMessage[],
): Set<string> => {
  const ids = new Set<string>();
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.toolCallId) answered.add(m.toolCallId);
  }
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (const call of m.toolCalls) {
      if (call.interaction?.status === 'pending' && !answered.has(call.id)) {
        ids.add(call.id);
      }
    }
  }
  return ids;
};
