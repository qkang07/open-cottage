import { describe, expect, it } from 'vitest';
import {
  countTokens,
  estimateContextTokens,
  estimateRuntimeMessagesTokens,
  normalizeUsage,
  prepareTokenCounter,
  resolveContextWindow,
} from './tokenCounter';

describe('tokenCounter', () => {
  it('preloads the encoding required by the active model', async () => {
    await prepareTokenCounter('gpt-4o');
    expect(countTokens('hello world', 'gpt-4o')).toBe(2);
  });

  it('counts English tokens', () => {
    expect(countTokens('hello world')).toBeGreaterThan(0);
  });

  it('counts Chinese tokens', () => {
    expect(countTokens('你好世界')).toBeGreaterThan(0);
  });

  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('normalizes OpenAI usage', () => {
    expect(
      normalizeUsage({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      }),
    ).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it('normalizes Anthropic usage', () => {
    expect(
      normalizeUsage({
        input_tokens: 8,
        output_tokens: 4,
      }),
    ).toEqual({
      promptTokens: 8,
      completionTokens: 4,
      totalTokens: 12,
    });
  });

  it('normalizes Cottage runtime usage', () => {
    expect(
      normalizeUsage({
        inputTokens: 12,
        outputTokens: 6,
        totalTokens: 18,
      }),
    ).toEqual({
      promptTokens: 12,
      completionTokens: 6,
      totalTokens: 18,
    });
  });

  it('returns null for invalid usage', () => {
    expect(normalizeUsage(null)).toBeNull();
    expect(normalizeUsage({})).toBeNull();
    expect(normalizeUsage('bad')).toBeNull();
  });

  it('estimates context tokens including system prompt and messages', () => {
    const tokens = estimateContextTokens('You are a helpful assistant.', [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ]);
    expect(tokens).toBeGreaterThan(countTokens('You are a helpful assistant.'));
    expect(tokens).toBeGreaterThan(countTokens('Hello'));
    expect(tokens).toBeGreaterThan(countTokens('Hi there!'));
  });

  it('estimates in-flight runtime messages including tool calls and results', () => {
    const base = estimateRuntimeMessagesTokens([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Read a file.' },
    ]);
    const withToolRound = estimateRuntimeMessagesTokens([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Read a file.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'readFile', args: { path: 'a.txt' } }],
      },
      {
        role: 'tool',
        name: 'readFile',
        toolCallId: 'call-1',
        content: 'file contents',
      },
    ]);
    expect(withToolRound).toBeGreaterThan(base);
  });

  it('resolves known model context windows', () => {
    expect(resolveContextWindow('gpt-4o')).toBe(128_000);
    expect(resolveContextWindow('claude-3-5-sonnet')).toBe(200_000);
    expect(resolveContextWindow('deepseek-chat')).toBe(64_000);
    expect(resolveContextWindow('moonshot-v1-32k')).toBe(32_000);
  });

  it('parses window suffix from model id', () => {
    expect(resolveContextWindow('custom-model-32k')).toBe(32_000);
    expect(resolveContextWindow('custom-model-1m')).toBe(1_000_000);
    expect(resolveContextWindow('custom-model-2.5m')).toBe(2_500_000);
  });

  it('falls back to default context window', () => {
    expect(resolveContextWindow('unknown-model')).toBe(128 * 1024);
    expect(resolveContextWindow(undefined)).toBe(128 * 1024);
  });
});
