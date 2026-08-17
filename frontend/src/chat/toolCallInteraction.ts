/**
 * 工具调用上的用户交互态。
 * 批准 / 提问等 = 特殊工具调用：渲染组件，用户操作结果即 tool result，
 * 因此交互是工具循环的一部分，而非旁路内存闸门或独立 components 列表。
 */

export type ToolCallInteractionStatus =
  | 'pending'
  | 'resolved'
  | 'cancelled';

export type ToolApprovalInteraction = {
  kind: 'tool_approval';
  status: ToolCallInteractionStatus;
  message: string;
  /** 卡片标题；缺省为「需要确认：{工具名}」 */
  title?: string;
  /** 细分审批来源，便于 UI 文案 */
  approvalKind?: 'policy' | 'doom_loop';
  decision?: { approved: boolean };
};

export type AskUserInteraction = {
  kind: 'ask_user';
  status: ToolCallInteractionStatus;
  question: string;
  options: string[];
  decision?: { chosen: string };
};

export type ToolCallInteraction = ToolApprovalInteraction | AskUserInteraction;

export const isPendingInteraction = (
  interaction?: ToolCallInteraction | null,
): boolean => interaction?.status === 'pending';

export const parseToolCallInteraction = (
  raw: unknown,
): ToolCallInteraction | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Partial<ToolCallInteraction>;
  if (o.kind === 'tool_approval' && typeof o.message === 'string') {
    return {
      kind: 'tool_approval',
      status: o.status === 'resolved' || o.status === 'cancelled' ? o.status : 'pending',
      message: o.message,
      title: typeof o.title === 'string' ? o.title : undefined,
      approvalKind:
        o.approvalKind === 'doom_loop' || o.approvalKind === 'policy'
          ? o.approvalKind
          : undefined,
      decision:
        o.decision && typeof (o.decision as { approved?: unknown }).approved === 'boolean'
          ? { approved: (o.decision as { approved: boolean }).approved }
          : undefined,
    };
  }
  if (o.kind === 'ask_user' && typeof o.question === 'string') {
    return {
      kind: 'ask_user',
      status: o.status === 'resolved' || o.status === 'cancelled' ? o.status : 'pending',
      question: o.question,
      options: Array.isArray(o.options)
        ? o.options.filter((x): x is string => typeof x === 'string')
        : [],
      decision:
        o.decision && typeof (o.decision as { chosen?: unknown }).chosen === 'string'
          ? { chosen: (o.decision as { chosen: string }).chosen }
          : undefined,
    };
  }
  return undefined;
};
