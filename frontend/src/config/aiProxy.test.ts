import { describe, expect, it, vi } from 'vitest';
import { sanitizeLlmFetch } from './aiProxy';

describe('sanitizeLlmFetch', () => {
  it('removes provider auth headers for unauthenticated endpoints', async () => {
    const baseFetch = vi.fn(async () => new Response('{}')) as unknown as typeof fetch;
    const fetch = sanitizeLlmFetch(baseFetch, true);

    await fetch('http://127.0.0.1:11434/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer cottage-no-auth',
        'x-api-key': 'cottage-no-auth',
        'x-goog-api-key': 'cottage-no-auth',
        'x-custom-header': 'keep-me',
      },
      body: '{}',
    });

    const init = baseFetch.mock.calls[0]?.[1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('x-api-key')).toBe(false);
    expect(headers.has('x-goog-api-key')).toBe(false);
    expect(headers.get('x-custom-header')).toBe('keep-me');
  });
});
