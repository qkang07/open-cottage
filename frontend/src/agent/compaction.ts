import type { StoredMessage } from './messages';
import { countTokens } from './tokenCounter';

export const COMPACTION_THRESHOLD = 0.8;
export const COMPACTION_KEEP_RECENT_TURNS = 4;

const PRESERVE_TOOL_NAMES = new Set([
  'submitExecutionPlan',
  'submitPlan',
  'completePlanStep',
  'blockPlanStep',
  'requestPlanRevision',
  'completePlanRun',
  'failPlanRun',
  'taskSetPlan',
  'taskComplete',
  'taskHandoff',
]);

const isVerifyFeedbackUserMessage = (message: StoredMessage): boolean =>
  message.role === 'user' &&
  (message.content.includes('验收未通过') ||
    message.content.includes('✗') ||
    message.content.includes('completePlanStep') ||
    message.content.includes('taskComplete'));

const isPreservedMessage = (message: StoredMessage): boolean => {
  if (message.compaction) return true;
  if (isVerifyFeedbackUserMessage(message)) return true;
  if (message.role === 'assistant') {
    return (
      message.toolCalls?.some((call) => PRESERVE_TOOL_NAMES.has(call.name)) ??
      false
    );
  }
  if (message.role === 'tool') {
    return PRESERVE_TOOL_NAMES.has(message.name ?? '');
  }
  return false;
};

/** 以 user 消息为轮次边界，返回最近 N 轮起始下标。 */
const findRecentTurnStartIndex = (
  messages: readonly StoredMessage[],
  keepRecentTurns: number,
): number => {
  const userIndexes: number[] = [];
  messages.forEach((message, index) => {
    if (message.role === 'user') userIndexes.push(index);
  });
  if (userIndexes.length <= keepRecentTurns) return 0;
  return userIndexes[userIndexes.length - keepRecentTurns] ?? 0;
};

const formatMessagesForSummary = (messages: readonly StoredMessage[]): string =>
  messages
    .map((message, index) => {
      const role =
        message.role === 'tool'
          ? `tool(${message.name ?? 'unknown'})`
          : message.role;
      const toolHint =
        message.role === 'assistant' && message.toolCalls?.length
          ? `\n  tool_calls: ${message.toolCalls
              .map((call) => call.name)
              .join(', ')}`
          : '';
      return `[${index + 1}] ${role}: ${message.content.slice(0, 4000)}${toolHint}`;
    })
    .join('\n\n');

const buildSummaryPrompt = (
  toSummarize: readonly StoredMessage[],
  pinned: readonly StoredMessage[],
): string => {
  const pinnedBlock =
    pinned.length > 0
      ? `\n\n以下片段必须保留在摘要中（可改写但不可丢弃）：\n${formatMessagesForSummary(pinned)}`
      : '';
  return [
    '请将以下 Agent 对话历史压缩为简洁的中文摘要，供后续轮次继续任务。',
    '要求：',
    '- 保留所有文件路径、函数名、变量名、任务目标与验收结论',
    '- 保留已完成的计划步骤与未完成项',
    '- 不要编造未出现的信息',
    pinnedBlock,
    '',
    '待摘要历史：',
    formatMessagesForSummary(toSummarize),
  ].join('\n');
};

export interface CompactHistoryOptions {
  keepRecentTurns?: number;
  summarize: (prompt: string) => Promise<string>;
}

export interface CompactHistoryResult {
  summary: string;
  kept: StoredMessage[];
  droppedCount: number;
}

export async function compactHistory(
  storedHistory: readonly StoredMessage[],
  options: CompactHistoryOptions,
): Promise<CompactHistoryResult> {
  const keepRecentTurns = options.keepRecentTurns ?? COMPACTION_KEEP_RECENT_TURNS;
  const recentStart = findRecentTurnStartIndex(storedHistory, keepRecentTurns);
  const recent = storedHistory.slice(recentStart);
  const older = storedHistory.slice(0, recentStart);

  if (older.length === 0) {
    return {
      summary: '',
      kept: [...storedHistory],
      droppedCount: 0,
    };
  }

  const pinned = older.filter(isPreservedMessage);
  const toSummarize = older.filter((message) => !isPreservedMessage(message));
  const summaryPrompt = buildSummaryPrompt(toSummarize, pinned);
  const summaryBody = await options.summarize(summaryPrompt);

  const summaryMessage: StoredMessage = {
    role: 'user',
    content: `[上下文已压缩，以下为较早对话摘要]\n\n${summaryBody}`,
    userText: `已压缩上下文（丢弃 ${older.length} 条较早消息）`,
    synthetic: true,
    compaction: true,
    id: crypto.randomUUID(),
  };

  return {
    summary: summaryBody,
    kept: [summaryMessage, ...recent],
    droppedCount: older.length,
  };
}

export const estimateCompactionBenefit = (
  storedHistory: readonly StoredMessage[],
  keepRecentTurns = COMPACTION_KEEP_RECENT_TURNS,
): { before: number; afterEstimate: number; droppedCount: number } => {
  const recentStart = findRecentTurnStartIndex(storedHistory, keepRecentTurns);
  const older = storedHistory.slice(0, recentStart);
  const recent = storedHistory.slice(recentStart);
  const before = storedHistory.reduce(
    (sum, message) => sum + countTokens(message.content ?? ''),
    0,
  );
  const afterEstimate =
    countTokens('[summary placeholder]') +
    recent.reduce((sum, message) => sum + countTokens(message.content ?? ''), 0);
  return { before, afterEstimate, droppedCount: older.length };
};
