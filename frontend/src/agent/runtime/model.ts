import type { CottageTool } from './tool';
import type { z } from 'zod';

export interface CottageModelRuntimeIdentity {
  provider: string;
  model: string;
  connectionId?: string;
  presetId?: string;
  presetName?: string;
  /** 已移除 query、hash 与用户信息，可安全写入诊断日志。 */
  baseUrl: string;
}

export interface CottageModelMetrics {
  requestId: string;
  startedAt: number;
  durationMs: number;
  firstTokenMs?: number;
}

export type CottageMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image'; url: string; mediaType?: string }
    >;

export interface CottageToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type CottageModelMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: CottageMessageContent }
  | {
      role: 'assistant';
      content: string;
      reasoningContent?: string;
      toolCalls?: CottageToolCall[];
    }
  | {
      role: 'tool';
      content: string;
      toolCallId: string;
      name?: string;
      isError?: boolean;
    };

export interface CottageModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  raw?: Record<string, unknown>;
}

export interface CottageAssistantResponse {
  content: string;
  reasoningContent?: string;
  toolCalls?: CottageToolCall[];
  finishReason?: string;
  rawFinishReason?: string;
  usage?: CottageModelUsage;
  metrics?: CottageModelMetrics;
}

export interface CottageStructuredResponse<T> {
  value: T;
  reasoningContent?: string;
  finishReason?: string;
  usage?: CottageModelUsage;
  metrics?: CottageModelMetrics;
}

export interface CottageStructuredRequest<T> {
  messages: CottageModelMessage[];
  schema: z.ZodType<T>;
  schemaName?: string;
  schemaDescription?: string;
}

export type CottageModelEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-input-start'; id: string; name: string }
  | { type: 'tool-input-delta'; id: string; delta: string }
  | { type: 'tool-call'; call: CottageToolCall }
  | { type: 'error'; error: unknown }
  | {
      type: 'finish';
      finishReason?: string;
      rawFinishReason?: string;
      usage?: CottageModelUsage;
      metrics?: CottageModelMetrics;
    };

export interface CottageModelRequest {
  messages: CottageModelMessage[];
  tools?: CottageTool[];
}

export interface CottageModelDriver {
  getRuntimeIdentity(): CottageModelRuntimeIdentity;
  stream(
    request: CottageModelRequest,
    signal?: AbortSignal,
  ): AsyncIterable<CottageModelEvent>;
  generate(
    request: CottageModelRequest,
    signal?: AbortSignal,
  ): Promise<CottageAssistantResponse>;
  generateObject<T>(
    request: CottageStructuredRequest<T>,
    signal?: AbortSignal,
  ): Promise<CottageStructuredResponse<T>>;
}

export class CottageModelBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CottageModelBindingError';
  }
}

export const assertModelRuntimeIdentity = (
  identity: CottageModelRuntimeIdentity,
  expected: { provider: string; model: string; connectionId?: string },
): void => {
  const actualConnection = identity.connectionId?.trim() || undefined;
  const expectedConnection = expected.connectionId?.trim() || undefined;
  if (
    identity.provider !== expected.provider ||
    identity.model !== expected.model ||
    actualConnection !== expectedConnection
  ) {
    throw new CottageModelBindingError(
      `模型运行时已过期：界面选择 ${expected.provider} / ${expected.model}` +
        `（连接 ${expectedConnection ?? '默认'}），实际运行时为 ` +
        `${identity.provider} / ${identity.model}（连接 ${actualConnection ?? '默认'}）。` +
        '请重新切换模型后再发送。',
    );
  }
};

export const assistantResponseMessage = (
  response: CottageAssistantResponse,
): CottageModelMessage => ({
  role: 'assistant',
  content: response.content,
  reasoningContent: response.reasoningContent,
  toolCalls: response.toolCalls,
});

export const toolResultMessage = (options: {
  content: string;
  toolCallId: string;
  name?: string;
  isError?: boolean;
}): CottageModelMessage => ({ role: 'tool', ...options });
