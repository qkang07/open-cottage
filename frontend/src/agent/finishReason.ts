import type { CottageAssistantResponse } from './runtime/model';

export type FinishReasonKind =
  | 'tool_calls'
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'refusal'
  | 'empty';

export interface ClassifiedFinishReason {
  kind: FinishReasonKind;
  raw?: string;
}

const mapRawFinishReason = (raw: string): FinishReasonKind | undefined => {
  const lower = raw.toLowerCase();
  if (
    lower.includes('content_filter') ||
    lower.includes('content-filter') ||
    lower.includes('content filter') ||
    lower.includes('safety') ||
    lower.includes('moderation')
  ) {
    return 'content_filter';
  }
  if (lower.includes('refusal') || lower.includes('refused')) {
    return 'refusal';
  }
  if (
    lower === 'length' ||
    lower.includes('max_tokens') ||
    lower.includes('max tokens') ||
    lower.includes('token limit')
  ) {
    return 'length';
  }
  if (lower === 'stop' || lower === 'end_turn') {
    return 'stop';
  }
  if (
    lower === 'tool_calls' ||
    lower === 'tool-calls' ||
    lower === 'function_call'
  ) {
    return 'tool_calls';
  }
  return undefined;
};

/** 归一化各厂商 finish reason，与 normalizeUsage 同层。 */
export const normalizeFinishReason = (
  message: CottageAssistantResponse,
): ClassifiedFinishReason => {
  const raw = message.rawFinishReason ?? message.finishReason;

  if (message.toolCalls?.length) {
    return { kind: 'tool_calls', raw };
  }

  const text = message.content.trim();
  if (!text) {
    return { kind: 'empty', raw };
  }

  if (raw) {
    const mapped = mapRawFinishReason(raw);
    if (mapped) return { kind: mapped, raw };
  }

  return { kind: 'stop', raw };
};

export const classifyFinishReason = normalizeFinishReason;

export const finishReasonUserMessage = (kind: FinishReasonKind): string => {
  switch (kind) {
    case 'content_filter':
      return '模型输出被内容安全策略拦截，请修改任务描述或缩小范围后重试。';
    case 'refusal':
      return '模型拒绝响应当前请求，请调整目标或约束后重试。';
    case 'length':
      return '模型输出因长度限制被截断，请缩小单轮任务范围。';
    case 'empty':
      return '模型未产生有效输出，请继续推进任务。';
    default:
      return '模型未产生有效输出。';
  }
};
