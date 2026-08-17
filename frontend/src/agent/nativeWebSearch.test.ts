import { describe, expect, it, vi } from 'vitest';
import {
  applyInjectedToolsToBody,
  resolveNativeSearchFetchInjectedTools,
  resolveNativeSearchInjection,
  resolveNativeSearchToolSpecs,
  wrapFetchWithInjectedTools,
} from './nativeWebSearch';

describe('resolveNativeSearchInjection', () => {
  it('moonshot $web_search 走 request body 注入', () => {
    const injection = resolveNativeSearchInjection('moonshot');
    expect(injection.fetchInjectedTools).toEqual([
      { type: 'builtin_function', function: { name: '$web_search' } },
    ]);
    // 不进入 Cottage 本地工具列表，保持 chat/completions 请求路径。
    expect(injection.toolSpecs).toBeUndefined();
    expect(resolveNativeSearchToolSpecs('moonshot')).toEqual([]);
  });

  it('zhipu web_search 同样走 fetch 层注入', () => {
    const injection = resolveNativeSearchInjection('zhipu');
    expect(injection.fetchInjectedTools).toEqual([
      { type: 'web_search', web_search: { enable: true } },
    ]);
    expect(injection.toolSpecs).toBeUndefined();
  });

  it('anthropic / google 保留 direct provider tool 规格', () => {
    expect(resolveNativeSearchToolSpecs('anthropic')).toHaveLength(1);
    expect(resolveNativeSearchToolSpecs('google')).toHaveLength(1);
  });

  it('resolveNativeSearchFetchInjectedTools 未启用厂商返回空数组', () => {
    expect(resolveNativeSearchFetchInjectedTools('dashscope')).toEqual([]);
  });
});

describe('applyInjectedToolsToBody', () => {
  const spec = { type: 'builtin_function', function: { name: '$web_search' } };

  it('向已有 tools 追加内置工具规格', () => {
    const body = applyInjectedToolsToBody(
      { model: 'kimi-k2.7-code', tools: [{ type: 'function', function: { name: 'listDirectory' } }] },
      [spec],
    );
    expect(body.tools).toHaveLength(2);
    expect((body.tools as unknown[])[1]).toEqual(spec);
  });

  it('请求体无 tools 时创建数组', () => {
    const body = applyInjectedToolsToBody({ model: 'glm-4' }, [spec]);
    expect(body.tools).toEqual([spec]);
  });

  it('已存在的规格不重复注入', () => {
    const body = applyInjectedToolsToBody({ tools: [spec] }, [spec]);
    expect(body.tools).toHaveLength(1);
  });
});

describe('wrapFetchWithInjectedTools', () => {
  const spec = { type: 'builtin_function', function: { name: '$web_search' } };

  it('注入 chat/completions 请求体', async () => {
    const baseFetch = vi.fn(async () => new Response('ok'));
    const wrapped = wrapFetchWithInjectedTools(baseFetch, [spec]);

    await wrapped('https://api.moonshot.cn/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'kimi-k2.7-code', messages: [] }),
    });

    const [, init] = baseFetch.mock.calls[0];
    const sent = JSON.parse(init?.body as string);
    expect(sent.tools).toEqual([spec]);
  });

  it('不改动非 chat/completions 请求', async () => {
    const baseFetch = vi.fn(async () => new Response('ok'));
    const wrapped = wrapFetchWithInjectedTools(baseFetch, [spec]);
    const init = { method: 'POST', body: JSON.stringify({}) };

    await wrapped('https://api.moonshot.cn/v1/responses', init);

    expect(baseFetch).toHaveBeenCalledWith(
      'https://api.moonshot.cn/v1/responses',
      init,
    );
  });

  it('body 非法 JSON 时原样透传', async () => {
    const baseFetch = vi.fn(async () => new Response('ok'));
    const wrapped = wrapFetchWithInjectedTools(baseFetch, [spec]);
    const init = { method: 'POST', body: 'not-json' };

    await wrapped('https://api.moonshot.cn/v1/chat/completions', init);

    expect(baseFetch).toHaveBeenCalledWith(
      'https://api.moonshot.cn/v1/chat/completions',
      init,
    );
  });
});
