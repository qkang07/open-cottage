/**
 * LLM API 错误分类、友好提示与智能重试。
 *
 * 各家厂商的错误格式差异较大，这里做通用“鸭子类型”解析：
 * - OpenAI 兼容 API：{ error: { message, code, type }, status }
 * - Anthropic：{ error: { type, message }, status }
 * - Google Gemini：{ error: { message, code }, status }
 * - 网络层：fetch failed / timeout / ECONNREFUSED 等
 */

import { CottageServicePrivateNetworkBlockedError } from '../config/cottageServiceProxy';

export type LlmErrorKind =
  | 'auth'        // 401/403：API Key 无效、认证失败
  | 'quota'       // 402/429(额度)：余额不足、欠费
  | 'rate_limit'  // 429：速率限制（可重试）
  | 'server'      // 5xx：厂商服务端错误（可重试）
  | 'network'     // 网络/连接/超时错误（可重试）
  | 'content'     // 400：内容审核、安全拦截
  | 'proxy'       // Cottage Service 代理策略拦截（如内网地址）
  | 'unknown';    // 其他未识别错误

export interface LlmErrorInfo {
  kind: LlmErrorKind;
  statusCode?: number;
  code?: string;
  originalMessage: string;
}

export class LlmCallError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    readonly statusCode: number | undefined,
    originalMessage: string,
  ) {
    super(originalMessage);
    this.name = 'LlmCallError';
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 从任意错误对象中提取 status / code / message */
function extractErrorMeta(error: unknown): {
  message: string;
  statusCode?: number;
  code?: string;
} {
  let message = '';
  let statusCode: number | undefined;
  let code: string | undefined;

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === 'string') {
    message = error;
  } else {
    message = String(error);
  }

  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;

    if (typeof e.status === 'number') statusCode = e.status;
    if (typeof e.statusCode === 'number') statusCode = e.statusCode;
    if (typeof e.code === 'string') code = e.code;

    // OpenAI SDK 风格：error.response.status
    if (typeof e.response === 'object' && e.response !== null) {
      const resp = e.response as Record<string, unknown>;
      if (typeof resp.status === 'number') statusCode = resp.status;
    }

    // 有些 SDK 把原始响应放在 error.error 里
    if (typeof e.error === 'object' && e.error !== null) {
      const inner = e.error as Record<string, unknown>;
      if (typeof inner.code === 'string') code = inner.code;
      if (typeof inner.message === 'string' && inner.message) {
        message = inner.message;
      }
      if (typeof inner.type === 'string') code = code ?? inner.type;
      // 部分厂商使用 http_code（字符串或数字）表示状态码
      if (typeof inner.http_code === 'string') {
        const parsed = parseInt(inner.http_code, 10);
        if (!Number.isNaN(parsed)) statusCode = parsed;
      } else if (typeof inner.http_code === 'number') {
        statusCode = inner.http_code;
      }
    }
  }

  return { message, statusCode, code };
}

/** 判断消息文本是否暗示额度不足 */
function looksLikeQuotaError(message: string): boolean {
  const patterns = [
    /quota/i,
    /insufficient_quota/i,
    /billing/i,
    /payment/i,
    /额度/i,
    /余额不足/i,
    /欠费/i,
    /充值/i,
    /账户余额/i,
    /credits?\s*(exhausted|depleted|insufficient)/i,
    /balance/i,
    /no.*credit/i,
    /消费已超出/i,
    /资源包已用完/i,
    /token.*不足/i,
    /用量上限/i,
    /已用完/i,
    /已耗尽/i,
    /已超出/i,
    /请升级.*套餐/i,
    /购买积分/i,
    /token\s*plan/i,
    /积分不足/i,
    /配额/i,
    /套餐.*用完/i,
  ];
  return patterns.some((p) => p.test(message));
}

/** 判断消息文本是否暗示认证失败 */
function looksLikeAuthError(message: string): boolean {
  const patterns = [
    /api[_\s]?key/i,
    /authentication/i,
    /auth/i,
    /unauthorized/i,
    /invalid.*key/i,
    /密钥/i,
    /鉴权/i,
    /未授权/i,
    /身份验证/i,
    /access.*denied/i,
    /permission/i,
  ];
  return patterns.some((p) => p.test(message));
}

/** 判断消息文本是否暗示内容审核 */
function looksLikeContentError(message: string): boolean {
  const patterns = [
    /content.*filter/i,
    /safety/i,
    /moderation/i,
    /审核/i,
    /敏感/i,
    /过滤/i,
    /harmful/i,
    /blocked/i,
    /content.*policy/i,
    /bad_request/i,
  ];
  return patterns.some((p) => p.test(message));
}

/** 判断消息文本是否暗示网络错误 */
function looksLikeNetworkError(message: string): boolean {
  const lower = message.toLowerCase();
  const patterns = [
    /fetch/i,
    /network/i,
    /econnrefused/i,
    /etimedout/i,
    /timeout/i,
    /connection/i,
    /dns/i,
    /abort/i,
    /reset/i,
    /unreachable/i,
    /failed to fetch/i,
  ];
  return patterns.some((p) => p.test(lower));
}

/** 判断是否为 Cottage Service 拦截 localhost/内网目标 */
function looksLikePrivateNetworkBlocked(message: string, code?: string): boolean {
  if (code === 'private_network_blocked') return true;
  return (
    /private.?network/i.test(message) ||
    /PROXY_ALLOW_PRIVATE/i.test(message) ||
    /proxyAllowPrivate/i.test(message) ||
    /localhost\/内网/.test(message) ||
    /已被 Cottage Service 拦截/.test(message)
  );
}

/**
 * 对任意 LLM 调用异常进行分类。
 */
export function classifyLlmError(error: unknown): LlmErrorInfo {
  // 若已被包装过，直接复用
  if (error instanceof LlmCallError) {
    return {
      kind: error.kind,
      statusCode: error.statusCode,
      originalMessage: error.message,
    };
  }

  if (error instanceof CottageServicePrivateNetworkBlockedError) {
    return {
      kind: 'proxy',
      statusCode: error.statusCode,
      code: error.code,
      originalMessage: error.message,
    };
  }

  const { message, statusCode, code } = extractErrorMeta(error);

  // Cottage Service 内网拦截：必须早于 403→auth / blocked→content，否则会误导用户
  if (looksLikePrivateNetworkBlocked(message, code)) {
    return {
      kind: 'proxy',
      statusCode: statusCode ?? 403,
      code: code ?? 'private_network_blocked',
      originalMessage: message,
    };
  }

  // 1. 优先根据 HTTP 状态码判断
  if (statusCode !== undefined) {
    if (statusCode === 401 || statusCode === 403) {
      return { kind: 'auth', statusCode, code, originalMessage: message };
    }
    if (statusCode === 402) {
      return { kind: 'quota', statusCode, code, originalMessage: message };
    }
    if (statusCode === 429) {
      if (looksLikeQuotaError(message)) {
        return { kind: 'quota', statusCode, code, originalMessage: message };
      }
      return { kind: 'rate_limit', statusCode, code, originalMessage: message };
    }
    if (statusCode >= 500 && statusCode < 600) {
      return { kind: 'server', statusCode, code, originalMessage: message };
    }
    if (statusCode === 400) {
      if (looksLikeContentError(message)) {
        return { kind: 'content', statusCode, code, originalMessage: message };
      }
      // 400 里也可能是额度或认证（部分厂商不区分状态码）
      if (looksLikeQuotaError(message)) {
        return { kind: 'quota', statusCode, code, originalMessage: message };
      }
      if (looksLikeAuthError(message)) {
        return { kind: 'auth', statusCode, code, originalMessage: message };
      }
    }
  }

  // 2. 根据错误消息内容做兜底判断
  if (looksLikeQuotaError(message)) {
    return { kind: 'quota', statusCode, code, originalMessage: message };
  }
  if (looksLikeAuthError(message)) {
    return { kind: 'auth', statusCode, code, originalMessage: message };
  }
  if (looksLikeContentError(message)) {
    return { kind: 'content', statusCode, code, originalMessage: message };
  }

  const lower = message.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('限流')) {
    return { kind: 'rate_limit', statusCode, code, originalMessage: message };
  }

  if (looksLikeNetworkError(message)) {
    // 排除用户主动 abort 的情况（在调用处单独处理）
    if (lower.includes('aborted') || lower.includes('abortcontroller')) {
      // 保持未知，让上层根据 signal.aborted 判断
      return { kind: 'unknown', statusCode, code, originalMessage: message };
    }
    return { kind: 'network', statusCode, code, originalMessage: message };
  }

  return { kind: 'unknown', statusCode, code, originalMessage: message };
}

/** 某类错误是否适合重试 */
export function isRetriableError(kind: LlmErrorKind): boolean {
  return kind === 'rate_limit' || kind === 'server' || kind === 'network';
}

/** 把错误转换为用户友好的中文提示 */
export function friendlyErrorMessage(info: LlmErrorInfo): string {
  switch (info.kind) {
    case 'auth':
      return 'API Key 无效或已过期，请检查设置中的密钥是否正确。';
    case 'quota':
      return '账户余额不足或额度已用完，请充值后再试。';
    case 'rate_limit':
      return '请求过于频繁，已被限流。请稍后再试。';
    case 'server':
      return '模型服务端暂时不可用，请稍后再试。';
    case 'network':
      return '网络连接异常，请检查网络后重试。';
    case 'content':
      return '内容触发安全审核，请修改输入后重试。';
    case 'proxy':
      return info.originalMessage.includes('Cottage Service')
        ? info.originalMessage
        : '目标为 localhost/内网地址，已被 Cottage Service 拦截。请在服务控制台开启「允许代理访问内网 / localhost」。';
    case 'unknown':
    default: {
      const codePart = info.statusCode ? `（HTTP ${info.statusCode}）` : '';
      return `调用模型时出错${codePart}：${info.originalMessage}`;
    }
  }
}

export interface LlmRetryOptions {
  /** 最大重试次数，默认 2 */
  maxRetries?: number;
  /** 首次重试等待基准毫秒，默认 1200 */
  baseDelayMs?: number;
  /** 最大等待毫秒，默认 20000 */
  maxDelayMs?: number;
  /** 每次重试前调用，可用于日志 */
  onRetry?: (info: LlmErrorInfo, attempt: number, delayMs: number) => void;
  /** 中断信号 */
  signal?: AbortSignal;
}

/**
 * 应用层 LLM 重试的默认参数（与 AI SDK 内部重试相互独立）。
 * 集中在此定义，方便统一调整而无需改动各调用点。
 */
export const DEFAULT_LLM_RETRY_OPTIONS = {
  maxRetries: 2,
  baseDelayMs: 1200,
  maxDelayMs: 20000,
} as const satisfies Required<
  Pick<LlmRetryOptions, 'maxRetries' | 'baseDelayMs' | 'maxDelayMs'>
>;

/**
 * 对 LLM 调用做智能重试包装。
 * - 可重试错误（rate_limit / server / network）：指数退避重试
 * - 不可重试错误（auth / quota / content）：立即抛出，不浪费 token
 */
export async function withLlmRetry<T>(
  fn: () => Promise<T>,
  options: LlmRetryOptions = {},
): Promise<T> {
  const {
    maxRetries = DEFAULT_LLM_RETRY_OPTIONS.maxRetries,
    baseDelayMs = DEFAULT_LLM_RETRY_OPTIONS.baseDelayMs,
    maxDelayMs = DEFAULT_LLM_RETRY_OPTIONS.maxDelayMs,
    onRetry,
    signal,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new Error('已停止生成');
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const info = classifyLlmError(error);

      // 用户主动 abort，不重试
      if (signal?.aborted) {
        throw new Error('已停止生成');
      }

      if (!isRetriableError(info.kind)) {
        throw new LlmCallError(info.kind, info.statusCode, info.originalMessage);
      }

      if (attempt >= maxRetries) {
        throw new LlmCallError(info.kind, info.statusCode, info.originalMessage);
      }

      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      onRetry?.(info, attempt + 1, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}
