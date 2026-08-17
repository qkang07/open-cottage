import { describe, expect, it, vi } from 'vitest';
import {
  classifyLlmError,
  friendlyErrorMessage,
  isRetriableError,
  withLlmRetry,
  type LlmErrorInfo,
} from './llmErrorHandler';

describe('classifyLlmError', () => {
  it('should classify Token Plan quota exhaustion as quota', () => {
    const error = {
      type: 'error',
      error: {
        type: 'rate_limit_error',
        message: '已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。 (2056)',
        http_code: '429',
      },
      request_id: '0684109abd1f4679fae0da198d179900',
    };
    const info = classifyLlmError(error);
    expect(info.kind).toBe('quota');
    expect(info.statusCode).toBe(429);
    expect(info.originalMessage).toContain('Token Plan 用量上限');
  });

  it('should classify plain 429 rate limit as rate_limit', () => {
    const error = {
      status: 429,
      error: { message: 'rate limit exceeded' },
    };
    const info = classifyLlmError(error);
    expect(info.kind).toBe('rate_limit');
    expect(info.statusCode).toBe(429);
  });

  it('should classify 401 as auth', () => {
    const info = classifyLlmError({ status: 401, error: { message: 'invalid key' } });
    expect(info.kind).toBe('auth');
  });
});

describe('isRetriableError', () => {
  it('should not retry quota errors', () => {
    expect(isRetriableError('quota')).toBe(false);
    expect(isRetriableError('auth')).toBe(false);
    expect(isRetriableError('content')).toBe(false);
  });

  it('should retry rate_limit / server / network errors', () => {
    expect(isRetriableError('rate_limit')).toBe(true);
    expect(isRetriableError('server')).toBe(true);
    expect(isRetriableError('network')).toBe(true);
  });
});

describe('friendlyErrorMessage', () => {
  it('should return Chinese hint for quota error', () => {
    const info: LlmErrorInfo = {
      kind: 'quota',
      statusCode: 429,
      originalMessage: 'Token Plan exhausted',
    };
    expect(friendlyErrorMessage(info)).toContain('账户余额不足或额度已用完');
  });
});

describe('withLlmRetry', () => {
  it('should not retry quota errors and throw immediately', async () => {
    const fn = vi.fn().mockRejectedValue({
      error: {
        type: 'rate_limit_error',
        message: '已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。 (2056)',
        http_code: '429',
      },
    });
    const onRetry = vi.fn();

    await expect(
      withLlmRetry(fn, { maxRetries: 2, baseDelayMs: 10, onRetry }),
    ).rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('should retry transient rate_limit errors', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, error: { message: 'rate limit exceeded' } })
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();

    await expect(
      withLlmRetry(fn, { maxRetries: 2, baseDelayMs: 10, onRetry }),
    ).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
