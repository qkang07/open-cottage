/**
 * Kimi / Moonshot thinking：默认开启 thinking，并补全历史 assistant 的 reasoning_content。
 */

/** 占位推理内容（用于历史 assistant 消息补全） */
export const MOONSHOT_PLACEHOLDER_REASONING = ' ';

const KIMI_THINKING_MODEL_RE = /^kimi-k2/i;
const MOONSHOT_V1_THINKING_RE = /^moonshot-v1.*thinking/i;

/** 检查是否为 Moonshot API Base URL */
export const isMoonshotApiBaseUrl = (baseUrl: string): boolean =>
  /moonshot\.(cn|ai)/i.test(baseUrl);

/** 检查指定模型是否支持 Moonshot Thinking 模式 */
export const supportsMoonshotThinking = (model: string): boolean => {
  const m = model.toLowerCase();
  if (KIMI_THINKING_MODEL_RE.test(m) || m.startsWith('kimi-thinking')) {
    return true;
  }
  if (MOONSHOT_V1_THINKING_RE.test(m)) {
    return true;
  }
  return false;
};

/** 获取指定模型的默认 Thinking 配置 */
export const defaultThinkingForModel = (
  model: string,
): { type: 'enabled'; keep?: 'all' } => {
  const m = model.toLowerCase();
  if (m.includes('k2.6') || m.includes('k2-6')) {
    return { type: 'enabled', keep: 'all' };
  }
  return { type: 'enabled' };
};

type OpenAiChatMessage = {
  role?: string;
  reasoning_content?: string;
  [key: string]: unknown;
};

/** 与请求中 assistant 消息顺序对齐，用于回传已保存的 reasoning */
let assistantReasoningPatch: string[] = [];

/** 设置 assistant 消息的推理内容补丁（与请求中 assistant 消息顺序对齐） */
export const setMoonshotAssistantReasoningPatch = (
  values: readonly string[],
): void => {
  assistantReasoningPatch = [...values];
};

/** 清空 assistant 推理内容补丁 */
export const clearMoonshotAssistantReasoningPatch = (): void => {
  assistantReasoningPatch = [];
};

/** 确保 assistant 消息包含 reasoning_content（缺失时用补丁或占位符填充） */
const ensureAssistantReasoningContent = (
  messages: OpenAiChatMessage[],
  patch: readonly string[],
): void => {
  let assistantIdx = 0;
  for (const msg of messages) {
    if (msg.role !== 'assistant') continue;
    if (msg.reasoning_content != null && msg.reasoning_content !== '') {
      assistantIdx += 1;
      continue;
    }
    const fromPatch = patch[assistantIdx];
    msg.reasoning_content =
      typeof fromPatch === 'string' && fromPatch.length > 0
        ? fromPatch
        : MOONSHOT_PLACEHOLDER_REASONING;
    assistantIdx += 1;
  }
};

/** 为 Moonshot 请求应用 Thinking 配置和 reasoning_content 补全 */
export const applyMoonshotThinkingBody = (
  body: Record<string, unknown>,
): Record<string, unknown> => {
  const out = { ...body };
  const rawMessages = out.messages;
  if (Array.isArray(rawMessages)) {
    const messages = rawMessages.map((m) =>
      m && typeof m === 'object' ? { ...(m as OpenAiChatMessage) } : m,
    ) as OpenAiChatMessage[];
    ensureAssistantReasoningContent(messages, assistantReasoningPatch);
    out.messages = messages;
  }

  const model = typeof out.model === 'string' ? out.model : '';
  if (supportsMoonshotThinking(model) && out.thinking == null) {
    out.thinking = defaultThinkingForModel(model);
  }

  return out;
};

/** 检查是否为 Moonshot chat/completions 请求 */
const isMoonshotChatCompletionsRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
): boolean => {
  const method =
    init?.method ??
    (input instanceof Request ? input.method : undefined) ??
    'GET';
  if (method.toUpperCase() !== 'POST') return false;
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return /chat\/completions/i.test(url);
};

/** 在发往 Moonshot 的 chat/completions 请求上注入 thinking 与 reasoning_content */
export const wrapFetchWithMoonshotThinking = (
  baseFetch: typeof fetch,
): typeof fetch =>
  async (input, init) => {
    if (!isMoonshotChatCompletionsRequest(input, init)) {
      return baseFetch(input, init);
    }
    const rawBody = init?.body ?? (input instanceof Request ? input.body : null);
    if (typeof rawBody !== 'string') {
      return baseFetch(input, init);
    }
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      const patched = applyMoonshotThinkingBody(parsed);
      const body = JSON.stringify(patched);
      if (input instanceof Request) {
        return baseFetch(
          new Request(input, { ...init, body }),
        );
      }
      return baseFetch(input, { ...init, body });
    } catch {
      return baseFetch(input, init);
    }
  };

/** 检查是否应应用 Moonshot Thinking 处理 */
export const shouldApplyMoonshotThinking = (
  providerId: string,
  baseUrl?: string,
): boolean =>
  providerId === 'moonshot' ||
  Boolean(baseUrl && isMoonshotApiBaseUrl(baseUrl));
