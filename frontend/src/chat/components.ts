/**
 * 可落盘的聊天 UI 组件（批准弹窗、提问卡等）。
 * 与 LLM 历史分离：进入会话文件，不进入 storedToRuntime。
 * 打开历史时按 status 渲染；pending 时可继续交互。
 */
import type { AskUserOption } from './askUserOptions';

export type ChatComponentStatus =
  | 'pending'
  | 'resolved'
  | 'cancelled'
  | 'interrupted';

export type ChatComponentKind = 'tool_approval' | 'ask_user';

interface ChatComponentBase {
  id: string;
  kind: ChatComponentKind;
  status: ChatComponentStatus;
  /** 关联的工具调用 id（与 call section / toolCalls[].id 对齐） */
  linkedCallId: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface ToolApprovalComponent extends ChatComponentBase {
  kind: 'tool_approval';
  payload: {
    toolName: string;
    message: string;
    /** 发起审批时的工具参数快照，供刷新后继续执行 */
    args?: Record<string, unknown>;
  };
  decision?: { approved: boolean };
}

export interface AskUserComponent extends ChatComponentBase {
  kind: 'ask_user';
  payload: {
    question: string;
    options: AskUserOption[];
  };
  decision?: { chosen: string };
}

export type ChatComponent = ToolApprovalComponent | AskUserComponent;

export const isChatComponent = (value: unknown): value is ChatComponent => {
  if (!value || typeof value !== 'object') return false;
  const c = value as Partial<ChatComponent>;
  return (
    typeof c.id === 'string' &&
    (c.kind === 'tool_approval' || c.kind === 'ask_user') &&
    typeof c.status === 'string' &&
    typeof c.linkedCallId === 'string'
  );
};

export const parseChatComponents = (raw: unknown): ChatComponent[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isChatComponent);
};

export const pendingChatComponents = (
  components: readonly ChatComponent[],
): ChatComponent[] => components.filter((c) => c.status === 'pending');
