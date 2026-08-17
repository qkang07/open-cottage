/**
 * Kimi / Moonshot thinking 模式：默认开启 thinking，并补全历史 assistant 的 reasoning_content。
 * @see https://platform.moonshot.cn/docs/guide/kimi-k2-thinking
 */

const KIMI_THINKING_MODEL_RE = /^kimi-k2/i;
const MOONSHOT_V1_THINKING_RE = /^moonshot-v1.*thinking/i;

/** API 要求存在该字段；空字符串部分网关不接受，使用单空格占位 */
const PLACEHOLDER_REASONING = ' ';

/** @param {string | undefined} model */
function supportsMoonshotThinking(model) {
  if (!model || typeof model !== 'string') return false;
  const m = model.toLowerCase();
  if (KIMI_THINKING_MODEL_RE.test(m) || m.startsWith('kimi-thinking')) {
    return true;
  }
  if (MOONSHOT_V1_THINKING_RE.test(m)) {
    return true;
  }
  return false;
}

/** @param {string | undefined} model */
function defaultThinkingForModel(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('k2.6') || m.includes('k2-6')) {
    return { type: 'enabled', keep: 'all' };
  }
  return { type: 'enabled' };
}

/** @param {unknown[]} messages */
function ensureAssistantReasoningContent(messages, reasoningPatch) {
  if (!Array.isArray(messages)) return;
  let assistantIdx = 0;
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || msg.role !== 'assistant') continue;
    if (msg.reasoning_content != null && msg.reasoning_content !== '') continue;
    const fromPatch = Array.isArray(reasoningPatch)
      ? reasoningPatch[assistantIdx]
      : undefined;
    msg.reasoning_content =
      typeof fromPatch === 'string' && fromPatch.length > 0
        ? fromPatch
        : PLACEHOLDER_REASONING;
    assistantIdx += 1;
  }
}

/**
 * @param {Record<string, unknown>} body
 * @param {string[] | undefined} reasoningPatch
 * @returns {Record<string, unknown>}
 */
function applyMoonshotThinkingBody(body, reasoningPatch) {
  if (!body || typeof body !== 'object') return body;

  const out = { ...body };
  if (Array.isArray(out.messages)) {
    out.messages = out.messages.map((m) =>
      m && typeof m === 'object' ? { ...m } : m,
    );
    ensureAssistantReasoningContent(out.messages, reasoningPatch);
  }

  const model = typeof out.model === 'string' ? out.model : '';
  if (supportsMoonshotThinking(model) && out.thinking == null) {
    out.thinking = defaultThinkingForModel(model);
  }

  return out;
}

module.exports = {
  PLACEHOLDER_REASONING,
  supportsMoonshotThinking,
  defaultThinkingForModel,
  ensureAssistantReasoningContent,
  applyMoonshotThinkingBody,
};
