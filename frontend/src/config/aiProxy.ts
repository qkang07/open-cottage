/**
 * LLM 请求代理配置。
 *
 * 前端不再内置由构建变量指定的 LLM 网关；如需绕过浏览器 CORS，
 * 可由用户在设置中启用 Cottage Service 的通用 HTTP 转发。
 */

import type { LlmProviderId } from './llmProviders';
import { getProviderDefinition } from './llmProviders';
import type { ThirdPartySearchProviderId } from './constants';
import {
  createCottageServiceProxiedFetch,
  getCottageServiceBaseUrl,
  isCottageServiceHttpProxyEnabled,
} from './cottageServiceProxy';

/** 标准化 Base URL（去除尾部斜杠） */
const normalizeBase = (baseUrl: string): string => baseUrl.trim().replace(/\/$/, '');

export interface OpenAiClientProxyConfig {
  baseURL: string;
  fetch: typeof fetch;
}

const STAINLESS_HEADER_PREFIX = 'x-stainless-';

const isStainlessHeader = (name: string): boolean =>
  name.toLowerCase().startsWith(STAINLESS_HEADER_PREFIX);

export const stripStainlessHeaders = (headers: Headers): void => {
  for (const key of [...headers.keys()]) {
    if (isStainlessHeader(key)) headers.delete(key);
  }
};

const mergeRequestHeaders = (input: RequestInfo | URL, init?: RequestInit): Headers => {
  const merged = new Headers();
  if (input instanceof Request) input.headers.forEach((value, key) => merged.set(key, value));
  if (init?.headers) new Headers(init.headers).forEach((value, key) => merged.set(key, value));
  stripStainlessHeaders(merged);
  return merged;
};

export const sanitizeLlmFetch = (
  baseFetch: typeof fetch = globalThis.fetch.bind(globalThis),
  withoutAuthorization = false,
): typeof fetch =>
  (input, init) => {
    const headers = mergeRequestHeaders(input, init);
    if (withoutAuthorization) {
      headers.delete('authorization');
      headers.delete('x-api-key');
      headers.delete('x-goog-api-key');
    }
    if (input instanceof Request) return baseFetch(new Request(input, { ...init, headers }));
    return baseFetch(input, { ...init, headers });
  };

export const isLlmProxyEnabled = (): boolean => isCottageServiceHttpProxyEnabled();

export const isCottageServiceLlmProxyEnabled = (): boolean =>
  isCottageServiceHttpProxyEnabled();

const wrapFetchForLlm = (
  _providerId: LlmProviderId,
  _directBaseUrl: string,
  withoutAuthorization = false,
): typeof fetch => {
  let fetch = sanitizeLlmFetch(undefined, withoutAuthorization);
  const serviceBase = getCottageServiceBaseUrl();
  if (isCottageServiceHttpProxyEnabled() && serviceBase) {
    fetch = createCottageServiceProxiedFetch(serviceBase, fetch);
  }
  return fetch;
};

export const resolveOpenAiClientProxy = (
  providerId: LlmProviderId,
  directBaseUrl: string,
  withoutAuthorization = false,
): OpenAiClientProxyConfig => ({
  baseURL: normalizeBase(directBaseUrl),
  fetch: wrapFetchForLlm(providerId, directBaseUrl, withoutAuthorization),
});

export const resolveAnthropicProxy = (
  providerId: LlmProviderId,
  directBaseUrl: string,
  withoutAuthorization = false,
): { clientOptions?: { baseURL?: string; fetch?: typeof fetch } } => ({
  clientOptions: {
    baseURL: normalizeBase(directBaseUrl),
    fetch: wrapFetchForLlm(providerId, directBaseUrl, withoutAuthorization),
  },
});

export const resolveGoogleProxy = (
  providerId: LlmProviderId,
  directBaseUrl: string,
  withoutAuthorization = false,
): { baseUrl?: string; fetch?: typeof fetch } => {
  const fetch = wrapFetchForLlm(providerId, directBaseUrl, withoutAuthorization);
  return { baseUrl: normalizeBase(directBaseUrl), fetch };
};

export const SEARCH_PROVIDER_BASE_URLS: Record<ThirdPartySearchProviderId, string> = {
  tavily: 'https://api.tavily.com', bing: 'https://api.bing.microsoft.com',
  brave: 'https://api.search.brave.com', serper: 'https://google.serper.dev', exa: 'https://api.exa.ai',
};

export const resolveSearchProxyUrl = (provider: ThirdPartySearchProviderId, path: string): string => {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${SEARCH_PROVIDER_BASE_URLS[provider]}${p}`;
};

export const resolveTavilyProxyUrl = (path: string): string => resolveSearchProxyUrl('tavily', path);

export const defaultOpenAiBaseForProvider = (providerId: LlmProviderId): string => {
  const def = getProviderDefinition(providerId);
  return def.kind === 'openai' ? 'https://api.openai.com/v1' : def.defaultBaseUrl ?? '';
};
