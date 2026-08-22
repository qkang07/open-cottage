import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import {
  activeInteractionKey,
  bumpInteractionRevision,
  interactionRevision,
  writeInteractionKey,
} from '../platform/interaction/interactionScope';
import {
  normalizeAskUserOptions,
  type AskUserOption,
} from '../chat/askUserOptions';

export type AskUserArgs = {
  question: string;
  options: AskUserOption[];
};

interface PendingAsk extends AskUserArgs {
  resolve: (choice: string) => void;
  reject: (reason: Error) => void;
}

/** 按会话隔离的待回答项：后台会话的提问不会劫持活跃会话 UI */
const pendingAsks = new Map<string, PendingAsk>();

/** 供 Vue 组件订阅 pending 状态变化（单例非响应式） */
export const pendingAskRevision = interactionRevision;

export function parseAskUserArgs(raw?: string): AskUserArgs | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { question?: unknown; options?: unknown };
    const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
    if (!question) return null;
    const options = normalizeAskUserOptions(parsed.options);
    return { question, options };
  } catch {
    const match = raw.match(/"question"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (!match) return null;
    try {
      return {
        question: JSON.parse(`"${match[1]}"`) as string,
        options: [],
      };
    } catch {
      return { question: match[1], options: [] };
    }
  }
}

export const createAskUserCottageTool = (
  sessionId?: string | null,
): CottageTool =>
  cottageTool(
    async ({ question, options }, config) => {
      const trimmedQuestion = question?.trim();
      if (!trimmedQuestion) {
        throw new Error('question 不能为空');
      }
      const normalizedOptions = normalizeAskUserOptions(options);
      const key = writeInteractionKey(sessionId);
      return new Promise((resolve, reject) => {
        const signal = config?.signal;
        if (signal?.aborted) {
          reject(new Error('用户取消了操作'));
          return;
        }
        const onAbort = () => {
          pendingAsks.delete(key);
          bumpInteractionRevision();
          reject(new Error('用户取消了操作'));
        };
        signal?.addEventListener('abort', onAbort);

        pendingAsks.set(key, {
          question: trimmedQuestion,
          options: normalizedOptions,
          resolve: (choice) => {
            signal?.removeEventListener('abort', onAbort);
            pendingAsks.delete(key);
            bumpInteractionRevision();
            resolve({ question: trimmedQuestion, chosen: choice });
          },
          reject: (reason) => {
            signal?.removeEventListener('abort', onAbort);
            pendingAsks.delete(key);
            bumpInteractionRevision();
            reject(reason);
          },
        });
        bumpInteractionRevision();
      });
    },
    {
      name: 'askUser',
      description:
        '当你不确定某件事情、需要用户做选择或补充说明时，向用户提出问题。可提供选项供快速选择；用户也可在输入框中自由回答。调用后等待用户在界面回复，回复内容会作为工具结果返回给你。',
      schema: z.object({
        question: z
          .string()
          .describe('要向用户询问的问题，清晰描述你的不确定点或需要用户决策的事项'),
        options: z
          .array(
            z.union([
              z.string(),
              z.object({
                label: z.string(),
                description: z.string().optional(),
              }),
            ]),
          )
          .optional()
          .describe(
            '可选：供用户快速选择的选项列表。每项可为字符串，或 { label, description? }；' +
              'label 是返回给工具的选择，description 用于向用户说明该选项。',
          ),
      }),
    },
  );

const keyFor = (sessionId?: string | null): string =>
  sessionId === undefined ? activeInteractionKey() : writeInteractionKey(sessionId);

export const getPendingAsk = (
  sessionId?: string | null,
):
  | Readonly<Pick<PendingAsk, 'question' | 'options' | 'resolve' | 'reject'>>
  | null => pendingAsks.get(keyFor(sessionId)) ?? null;

export const resolvePendingAsk = (
  choice: string,
  sessionId?: string | null,
) => {
  const trimmed = choice.trim();
  if (!trimmed) return;
  pendingAsks.get(keyFor(sessionId))?.resolve(trimmed);
};

export const hasPendingAskFor = (sessionId: string): boolean =>
  pendingAsks.has(writeInteractionKey(sessionId));

export const cancelPendingAsk = (reason?: string, sessionId?: string | null) => {
  const key = sessionId ? writeInteractionKey(sessionId) : activeInteractionKey();
  pendingAsks.get(key)?.reject(new Error(reason || '用户取消了操作'));
};
