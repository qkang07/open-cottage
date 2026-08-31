import type { Tiktoken, TiktokenEncoding } from 'js-tiktoken/lite';
import type { StoredMessage } from './messages';
import type { CottageModelMessage } from './runtime/model';

/**
 * OpenAI 新一代模型（gpt-4o / gpt-4.1 / gpt-5 / o1·o3·o4 系列）改用 o200k_base 编码，
 * 用旧的 cl100k_base 估算会有明显偏差；其余模型仍近似用 cl100k_base。
 * model id 可能带有 provider 前缀（如 openai/gpt-4o），故用包含匹配。
 */
const O200K_PATTERN =
  /gpt-4o|gpt-4\.1|gpt-5|chatgpt-4o|(?:^|[-/])o[1345](?:$|[-])/i;

function resolveEncodingName(modelId?: string): TiktokenEncoding {
  if (modelId && O200K_PATTERN.test(modelId)) return 'o200k_base';
  return 'cl100k_base';
}

const encoderCache = new Map<TiktokenEncoding, Tiktoken>();
const encoderLoads = new Map<TiktokenEncoding, Promise<Tiktoken>>();

/**
 * 按需加载当前模型对应的分词词表。
 *
 * 不从 js-tiktoken 主入口导入 getEncoding，避免把所有词表打进首屏。
 * 调用方应在聊天实例可发送消息前 await 本方法；countTokens 保留降级估算，
 * 以防运行时配置切换与预加载发生短暂交错。
 */
export async function prepareTokenCounter(modelId?: string): Promise<void> {
  const name = resolveEncodingName(modelId);
  if (encoderCache.has(name)) return;

  let loading = encoderLoads.get(name);
  if (!loading) {
    loading = (async () => {
      const [{ Tiktoken }, rankModule] = await Promise.all([
        import('js-tiktoken/lite'),
        name === 'o200k_base'
          ? import('js-tiktoken/ranks/o200k_base')
          : import('js-tiktoken/ranks/cl100k_base'),
      ]);
      const encoder = new Tiktoken(rankModule.default);
      encoderCache.set(name, encoder);
      return encoder;
    })();
    encoderLoads.set(name, loading);
    void loading.then(
      () => encoderLoads.delete(name),
      () => encoderLoads.delete(name),
    );
  }

  await loading;
}

/** 词表尚在预加载时的保守估算；正常聊天路径会在计数前完成 prepare。 */
function estimateTokensBeforeReady(text: string): number {
  return Math.ceil(text.length / 3);
}

/** 单条文本 token 数缓存，避免长上下文下重复编码相同内容（按编码名区分） */
const tokenCache = new Map<string, number>();
const MAX_TOKEN_CACHE_SIZE = 2000;

export function countTokens(text: string, modelId?: string): number {
  if (!text) return 0;
  const encodingName = resolveEncodingName(modelId);
  const cacheKey = `${encodingName}\u0000${text}`;
  const cached = tokenCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const encoder = encoderCache.get(encodingName);
  if (!encoder) {
    void prepareTokenCounter(modelId);
    return estimateTokensBeforeReady(text);
  }
  const tokens = encoder.encode(text).length;
  if (tokenCache.size >= MAX_TOKEN_CACHE_SIZE) {
    const firstKey = tokenCache.keys().next().value as string | undefined;
    if (firstKey) tokenCache.delete(firstKey);
  }
  tokenCache.set(cacheKey, tokens);
  return tokens;
}

export interface ContextUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * 把各厂商格式迥异的 usage 字段归一化。
 * OpenAI / OpenAI-compatible: prompt_tokens / completion_tokens / total_tokens
 * Anthropic: input_tokens / output_tokens
 * Google Gemini: promptTokenCount / candidatesTokenCount / totalTokenCount
 * Cottage runtime: inputTokens / outputTokens / totalTokens
 */
export function normalizeUsage(usage: unknown): ContextUsage | null {
  if (!usage || typeof usage !== 'object') return null;
  const u = usage as Record<string, unknown>;

  const promptTokens =
    (typeof u.inputTokens === 'number' ? u.inputTokens : undefined) ??
    (typeof u.prompt_tokens === 'number' ? u.prompt_tokens : undefined) ??
    (typeof u.input_tokens === 'number' ? u.input_tokens : undefined) ??
    (typeof u.promptTokenCount === 'number' ? u.promptTokenCount : undefined) ??
    (typeof u.inputTokenCount === 'number' ? u.inputTokenCount : undefined) ??
    0;

  const completionTokens =
    (typeof u.outputTokens === 'number' ? u.outputTokens : undefined) ??
    (typeof u.completion_tokens === 'number' ? u.completion_tokens : undefined) ??
    (typeof u.output_tokens === 'number' ? u.output_tokens : undefined) ??
    (typeof u.candidatesTokenCount === 'number'
      ? u.candidatesTokenCount
      : undefined) ??
    (typeof u.outputTokenCount === 'number' ? u.outputTokenCount : undefined) ??
    0;

  const totalTokens =
    (typeof u.totalTokens === 'number' ? u.totalTokens : undefined) ??
    (typeof u.total_tokens === 'number' ? u.total_tokens : undefined) ??
    (typeof u.totalTokenCount === 'number' ? u.totalTokenCount : undefined) ??
    (promptTokens + completionTokens || 0);

  if (totalTokens <= 0 && promptTokens <= 0 && completionTokens <= 0) {
    return null;
  }

  return { promptTokens, completionTokens, totalTokens };
}

/** 单条消息除 content 外的格式开销（角色名、分隔符等近似值） */
const MESSAGE_OVERHEAD_TOKENS = 4;

/** 图片 token 取决于厂商、尺寸和 detail；真实 usage 返回前只给保守占位。 */
const IMAGE_INPUT_ESTIMATE_TOKENS = 1024;

/**
 * 估算即将发送给模型的运行时消息。
 *
 * 与 estimateContextTokens 的持久化历史视角不同，这里覆盖当前工具 loop 中
 * 尚未落盘完成的 assistant/tool 消息，用于流式阶段即时刷新 UI。工具定义、
 * 图片等厂商特有开销最终仍以每次请求返回的真实 usage 为准。
 */
export function estimateRuntimeMessagesTokens(
  messages: readonly CottageModelMessage[],
  modelId?: string,
): number {
  let total = 0;
  for (const message of messages) {
    total += MESSAGE_OVERHEAD_TOKENS;
    if (typeof message.content === 'string') {
      total += countTokens(message.content, modelId);
    } else {
      for (const part of message.content) {
        total += part.type === 'text'
          ? countTokens(part.text, modelId)
          : IMAGE_INPUT_ESTIMATE_TOKENS;
      }
    }
    if (message.role === 'assistant') {
      if (message.reasoningContent) {
        total += countTokens(message.reasoningContent, modelId);
      }
      for (const call of message.toolCalls ?? []) {
        total += countTokens(call.name, modelId);
        total += countTokens(JSON.stringify(call.args ?? {}), modelId);
      }
    } else if (message.role === 'tool' && message.name) {
      total += countTokens(message.name, modelId);
    }
  }
  return total;
}

function estimateMessageTokens(message: StoredMessage, modelId?: string): number {
  let tokens = MESSAGE_OVERHEAD_TOKENS;
  tokens += countTokens(message.content ?? '', modelId);
  if (message.reasoningContent) {
    tokens += countTokens(message.reasoningContent, modelId);
  }
  if (message.toolCalls?.length) {
    for (const call of message.toolCalls) {
      tokens += countTokens(call.name, modelId);
      tokens += countTokens(JSON.stringify(call.args ?? {}), modelId);
    }
  }
  return tokens;
}

/**
 * 估算当前完整上下文的 token 数。
 * 根据 model id 选择匹配的编码器（o200k_base / cl100k_base）做统一估算，
 * 覆盖 system prompt、历史消息、工具调用等。
 */
export function estimateContextTokens(
  systemPrompt: string,
  messages: readonly StoredMessage[],
  modelId?: string,
): number {
  let total = countTokens(systemPrompt, modelId);
  for (const message of messages) {
    total += estimateMessageTokens(message, modelId);
  }
  return total;
}

/** 默认上下文窗口：128k */
const DEFAULT_CONTEXT_WINDOW = 128 * 1024;

/**
 * 常见模型上下文窗口映射。
 * 键为不区分大小写的 model id 子串匹配；优先匹配前面的规则。
 */
const MODEL_CONTEXT_WINDOWS: { pattern: RegExp; window: number }[] = [
  { pattern: /gemini-2\.0-pro/i, window: 2_097_152 },
  { pattern: /gemini-2\.0|gemini-1\.5/i, window: 1_048_576 },
  { pattern: /gemini-1\.0/i, window: 32_768 },
  { pattern: /claude-3-5-sonnet|claude-sonnet-4|claude-opus-4/i, window: 200_000 },
  { pattern: /claude-3/i, window: 200_000 },
  { pattern: /gpt-4o|gpt-4-turbo/i, window: 128_000 },
  { pattern: /gpt-4-32k/i, window: 32_768 },
  { pattern: /gpt-4-/i, window: 8_192 },
  { pattern: /gpt-4$/i, window: 8_192 },
  { pattern: /deepseek-reasoner|deepseek-r1/i, window: 64_000 },
  { pattern: /deepseek-chat|deepseek-v3/i, window: 64_000 },
  { pattern: /deepseek-coder/i, window: 16_000 },
  { pattern: /moonshot-v1-128k/i, window: 128_000 },
  { pattern: /moonshot-v1-32k/i, window: 32_000 },
  { pattern: /moonshot-v1-8k/i, window: 8_000 },
  { pattern: /moonshot-v1/i, window: 8_000 },
  { pattern: /glm-4/i, window: 128_000 },
  { pattern: /glm-4-flash/i, window: 128_000 },
  { pattern: /qwen-max|qwen-plus/i, window: 131_072 },
  { pattern: /qwen-turbo|qwen-2\.5|qwen2\.5/i, window: 131_072 },
  { pattern: /doubao-1-5-pro-256k|doubao-pro-256k/i, window: 256_000 },
  { pattern: /doubao-1-5-pro-128k|doubao-pro-128k/i, window: 128_000 },
  { pattern: /doubao-1-5-pro-32k|doubao-pro-32k/i, window: 32_000 },
  { pattern: /doubao-1-5-lite/i, window: 128_000 },
  { pattern: /ernie-4\.0-8k/i, window: 8_192 },
  { pattern: /ernie-4\.0-32k/i, window: 32_768 },
  { pattern: /ernie-4/i, window: 8_192 },
  { pattern: /hunyuan-pro|hunyuan-standard|hunyuan-lite/i, window: 32_000 },
  { pattern: /abab6/i, window: 8_192 },
  { pattern: /yi-large/i, window: 32_000 },
  { pattern: /step-2/i, window: 32_000 },
  { pattern: /baichuan4/i, window: 128_000 },
  { pattern: /llama-3\.1-405b/i, window: 128_000 },
  { pattern: /llama-3\.1/i, window: 128_000 },
];

function parseWindowFromModelId(modelId: string): number | null {
  const lower = modelId.toLowerCase();

  // 显式标注的窗口大小，如 "xxx-32k"、"xxx-128k"、"xxx-1m"、"xxx-2m"
  const suffixMatch = lower.match(/-(\d+(?:\.\d+)?)(k|m)\b/);
  if (suffixMatch) {
    const value = parseFloat(suffixMatch[1]);
    const unit = suffixMatch[2];
    if (!Number.isNaN(value)) {
      return unit === 'm' ? Math.round(value * 1_000_000) : Math.round(value * 1_000);
    }
  }

  for (const { pattern, window } of MODEL_CONTEXT_WINDOWS) {
    if (pattern.test(modelId)) return window;
  }

  return null;
}

/**
 * 根据 model id 解析上下文窗口大小。
 * 无法识别时返回 128k 默认值。
 */
export function resolveContextWindow(modelId: string | undefined): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW;
  return parseWindowFromModelId(modelId) ?? DEFAULT_CONTEXT_WINDOW;
}
