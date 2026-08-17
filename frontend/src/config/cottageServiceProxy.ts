/**
 * Cottage Service HTTP 代理运行时。
 * 将 fetch 请求经 Cottage Service POST /proxy 转发到目标 URL。
 */

/** 与 cottage-service `/proxy` 对齐：本地/内网目标被拦截时的稳定错误码 */
export const PRIVATE_NETWORK_BLOCKED_CODE = 'private_network_blocked' as const;

/** Cottage Service 因 SSRF 防护拦截了 localhost / 内网目标 */
export class CottageServicePrivateNetworkBlockedError extends Error {
  readonly code = PRIVATE_NETWORK_BLOCKED_CODE;
  readonly blocked = true as const;
  readonly host?: string;
  readonly statusCode = 403;

  constructor(message: string, host?: string) {
    super(message);
    this.name = 'CottageServicePrivateNetworkBlockedError';
    this.host = host;
  }
}

const DEFAULT_PRIVATE_BLOCKED_MESSAGE =
  '目标为 localhost/内网地址，已被 Cottage Service 拦截。请在服务控制台开启「允许代理访问内网 / localhost」，或设置环境变量 COTTAGE_SERVICE_PROXY_ALLOW_PRIVATE=1。';

type ProxyErrorBody = {
  error?: string;
  message?: string;
  code?: string;
  blocked?: boolean;
  host?: string;
  hint?: string;
};

const isPrivateNetworkBlockedPayload = (body: ProxyErrorBody | null, text: string): boolean => {
  if (!body) {
    return /private.?network|localhost.*blocked|PROXY_ALLOW_PRIVATE/i.test(text);
  }
  if (body.code === PRIVATE_NETWORK_BLOCKED_CODE || body.blocked === true) return true;
  const msg = `${body.error ?? ''} ${body.message ?? ''}`;
  return /private.?network|localhost.*blocked|PROXY_ALLOW_PRIVATE/i.test(msg);
};

/** 运行时 Cottage Service HTTP 代理（由 store 注入） */
let serviceBaseUrl: string | undefined;
let httpProxyEnabled = false;

/** 设置 Cottage Service HTTP 代理状态 */
export const setCottageServiceHttpProxy = (
  enabled: boolean,
  baseUrl?: string,
): void => {
  httpProxyEnabled = enabled;
  serviceBaseUrl = enabled && baseUrl?.trim()
    ? baseUrl.trim().replace(/\/+$/, '')
    : undefined;
};

/** 检查 HTTP 代理是否已启用 */
export const isCottageServiceHttpProxyEnabled = (): boolean =>
  httpProxyEnabled && Boolean(serviceBaseUrl);

/** 获取 Cottage Service Base URL（未启用时返回 undefined） */
export const getCottageServiceBaseUrl = (): string | undefined =>
  httpProxyEnabled ? serviceBaseUrl : undefined;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

interface EncodedProxyBody {
  body?: string;
  bodyEncoding?: 'base64';
  /** 二进制/FormData 时从 Request 解析出的 Content-Type（含 multipart boundary） */
  contentType?: string;
}

/**
 * 编码代理请求体。
 * FormData / Blob / ArrayBuffer 走 base64，避免 JSON 代理通道损坏二进制。
 */
const encodeProxyBody = async (
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  method: string,
): Promise<EncodedProxyBody> => {
  if (method === 'GET' || method === 'HEAD') return {};

  const rawBody =
    init?.body !== undefined && init?.body !== null
      ? init.body
      : input instanceof Request
        ? input.body
        : null;
  if (rawBody == null) return {};

  if (typeof rawBody === 'string') {
    return { body: rawBody };
  }

  // FormData / Blob / 二进制：用 Request 物化，拿到正确 Content-Type（含 boundary）与字节
  if (
    (typeof FormData !== 'undefined' && rawBody instanceof FormData) ||
    (typeof Blob !== 'undefined' && rawBody instanceof Blob) ||
    rawBody instanceof ArrayBuffer ||
    ArrayBuffer.isView(rawBody)
  ) {
    const headers = new Headers(init?.headers);
    if (input instanceof Request) {
      input.headers.forEach((v, k) => {
        if (!headers.has(k)) headers.set(k, v);
      });
    }
    const materialized = new Request('https://cottage.invalid/proxy-body', {
      method: 'POST',
      headers,
      body: rawBody as BodyInit,
    });
    const contentType = materialized.headers.get('content-type') ?? undefined;
    const bytes = new Uint8Array(await materialized.arrayBuffer());
    return {
      body: bytesToBase64(bytes),
      bodyEncoding: 'base64',
      contentType,
    };
  }

  // 其它 ReadableStream 等：尽力转文本
  try {
    const text = await new Response(rawBody as BodyInit).text();
    return { body: text };
  } catch {
    return {};
  }
};

/** 检测是否为流式请求（通过 Accept 头或 body 中的 stream 字段） */
const detectStreamRequest = (
  method: string,
  body: string | undefined,
  bodyEncoding: string | undefined,
  headers: Record<string, string>,
): boolean => {
  const accept = (headers.accept ?? headers.Accept ?? '').toLowerCase();
  if (accept.includes('text/event-stream')) return true;
  if (bodyEncoding === 'base64') return false;
  if (body && method !== 'GET' && method !== 'HEAD') {
    try {
      const parsed = JSON.parse(body) as { stream?: boolean };
      if (parsed.stream === true) return true;
    } catch {
      // 非 JSON body
    }
  }
  return false;
};

/**
 * 将 fetch 经 Cottage Service POST /proxy 转发到目标 URL。
 * 浏览器只与 Service 通信；Service 去掉浏览器特征头后访问上游。
 */
export const createCottageServiceProxiedFetch = (
  baseUrl: string,
  baseFetch: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch =>
  async (input, init) => {
    const service = baseUrl.replace(/\/+$/, '');
    const method = (
      init?.method ??
      (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();

    let targetUrl: string;
    const headers = new Headers();
    if (input instanceof Request) {
      targetUrl = input.url;
      input.headers.forEach((v, k) => headers.set(k, v));
    } else {
      targetUrl = typeof input === 'string' ? input : input.href;
    }
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    }

    const encoded = await encodeProxyBody(input, init, method);
    if (encoded.contentType) {
      headers.set('Content-Type', encoded.contentType);
    }

    const headerObj: Record<string, string> = {};
    headers.forEach((v, k) => {
      headerObj[k] = v;
    });

    const stream = detectStreamRequest(
      method,
      encoded.body,
      encoded.bodyEncoding,
      headerObj,
    );

    const proxyRes = await baseFetch(`${service}/proxy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: '*/*' },
      body: JSON.stringify({
        url: targetUrl,
        method,
        headers: headerObj,
        body: encoded.body,
        ...(encoded.bodyEncoding ? { bodyEncoding: encoded.bodyEncoding } : {}),
        stream,
      }),
      signal: init?.signal,
    });

    if (proxyRes.ok) return proxyRes;

    // 代理层自身错误（含内网拦截）与上游错误都会走到这里；先读 body 再重建 Response。
    const text = await proxyRes.text();
    let parsed: ProxyErrorBody | null = null;
    try {
      parsed = JSON.parse(text) as ProxyErrorBody;
    } catch {
      // 非 JSON（多为上游透传）
    }

    if (isPrivateNetworkBlockedPayload(parsed, text)) {
      throw new CottageServicePrivateNetworkBlockedError(
        DEFAULT_PRIVATE_BLOCKED_MESSAGE,
        typeof parsed?.host === 'string' ? parsed.host : undefined,
      );
    }

    if (stream) {
      const detail = parsed?.error ?? parsed?.message ?? text;
      throw new Error(detail || `Cottage Service 代理失败：HTTP ${proxyRes.status}`);
    }

    return new Response(text, {
      status: proxyRes.status,
      statusText: proxyRes.statusText,
      headers: proxyRes.headers,
    });
  };
