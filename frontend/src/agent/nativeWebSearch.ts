/**
 * 第一层「模型原生联网搜索」注入。
 *
 * 各厂商启用方式分三类：顶层请求字段、AI SDK provider-defined tool，以及
 * OpenAI-compatible chat/completions 请求体注入。厂商原生工具不会进入 Cottage
 * 本地执行器；runtime adapter 会过滤 provider-executed tool call 事件。
 *
 * 均为 best-effort：不支持或参数被拒时由上游报错，用户可切换其它来源。
 */

import type { LlmProviderId } from '../config/llmProviders';

export interface NativeSearchInjection {
  /** 合并进 modelKwargs 的顶层字段（不含 tools，避免覆盖已绑定的函数工具） */
  modelKwargs?: Record<string, unknown>;
  /** 厂商原生工具规格，用于兼容测试与能力判断；运行时由 direct provider factory 创建。 */
  toolSpecs?: unknown[];
  /**
   * 在 fetch 层注入的厂商原生工具规格。
   * OpenAI-compatible 厂商的非 function 工具必须走这里，确保请求仍发往
   * chat/completions，而不是改变 API 路径。
   */
  fetchInjectedTools?: Record<string, unknown>[];
}

/** 解析指定厂商的原生搜索注入片段 */
export const resolveNativeSearchInjection = (
  providerId: LlmProviderId,
  _model?: string,
): NativeSearchInjection => {
  switch (providerId) {
    case 'dashscope':
      // 阿里通义千问：OpenAI 兼容模式顶层字段 enable_search
      return { modelKwargs: { enable_search: true } };
    case 'zhipu':
      // 智谱 GLM：web_search 内置工具，经 request transform 注入 chat/completions。
      return {
        fetchInjectedTools: [
          { type: 'web_search', web_search: { enable: true } },
        ],
      };
    case 'anthropic':
      // Claude Messages API 服务端 web_search 工具
      return {
        toolSpecs: [{ type: 'web_search_20250305', name: 'web_search' }],
      };
    case 'google':
      // Gemini google_search 工具（best-effort）
      return { toolSpecs: [{ googleSearch: {} }] };
    case 'openai':
      // OpenAI web_search_options（仅 *-search-preview 系列受支持，实验性）
      return { modelKwargs: { web_search_options: {} } };
    case 'moonshot':
      // Kimi $web_search 内置函数（官方标注升级中、需回环，实验性）。
      // 必须经请求体注入，保持 Moonshot chat/completions 路径不变。
      return {
        fetchInjectedTools: [
          { type: 'builtin_function', function: { name: '$web_search' } },
        ],
      };
    default:
      return {};
  }
};

/** 仅返回需并入 modelKwargs 的顶层字段（createModel 用） */
export const resolveNativeSearchModelKwargs = (
  providerId: LlmProviderId,
  model?: string,
): Record<string, unknown> | undefined =>
  resolveNativeSearchInjection(providerId, model).modelKwargs;

/** 返回 direct provider 对应的原生工具规格（兼容测试与能力判断用）。 */
export const resolveNativeSearchToolSpecs = (
  providerId: LlmProviderId,
  model?: string,
): unknown[] => resolveNativeSearchInjection(providerId, model).toolSpecs ?? [];

/** 仅返回需在 fetch 层注入的原生工具规格（createModel 用） */
export const resolveNativeSearchFetchInjectedTools = (
  providerId: LlmProviderId,
  model?: string,
): Record<string, unknown>[] =>
  resolveNativeSearchInjection(providerId, model).fetchInjectedTools ?? [];

/** 判断是否为 POST chat/completions 请求 */
const isChatCompletionsRequest = (
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

/** 将厂商内置工具规格并入请求体 tools 数组（已存在则去重跳过） */
export const applyInjectedToolsToBody = (
  body: Record<string, unknown>,
  injectedTools: readonly Record<string, unknown>[],
): Record<string, unknown> => {
  const rawTools = Array.isArray(body.tools) ? body.tools : [];
  const tools = [...rawTools];
  for (const spec of injectedTools) {
    const specJson = JSON.stringify(spec);
    const exists = tools.some((t) => JSON.stringify(t) === specJson);
    if (!exists) tools.push(spec);
  }
  return { ...body, tools };
};

/** 在 chat/completions 请求体上注入厂商内置工具规格。 */
export const wrapFetchWithInjectedTools = (
  baseFetch: typeof fetch,
  injectedTools: readonly Record<string, unknown>[],
): typeof fetch =>
  async (input, init) => {
    if (!injectedTools.length || !isChatCompletionsRequest(input, init)) {
      return baseFetch(input, init);
    }
    const rawBody = init?.body ?? (input instanceof Request ? input.body : null);
    if (typeof rawBody !== 'string') {
      return baseFetch(input, init);
    }
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      const patched = applyInjectedToolsToBody(parsed, injectedTools);
      const body = JSON.stringify(patched);
      if (input instanceof Request) {
        return baseFetch(new Request(input, { ...init, body }));
      }
      return baseFetch(input, { ...init, body });
    } catch {
      return baseFetch(input, init);
    }
  };
