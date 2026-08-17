import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  createOpenAI: vi.fn(),
  createOpenAICompatible: vi.fn(),
  createAnthropic: vi.fn(),
  createGoogle: vi.fn(),
  openAiChat: vi.fn((model: string) => ({ provider: 'openai', model })),
  compatibleChat: vi.fn((model: string) => ({ provider: 'compatible', model })),
  anthropicChat: vi.fn((model: string) => ({ provider: 'anthropic', model })),
  googleChat: vi.fn((model: string) => ({ provider: 'google', model })),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: mocks.generateText,
    streamText: mocks.streamText,
  };
});

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mocks.createOpenAI,
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: mocks.createAnthropic,
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: mocks.createGoogle,
}));

import { createAiSdkModel, LlmConfigError } from './aiSdkDriver';

const emptyResult = () => ({
  text: 'ok',
  reasoningText: undefined,
  toolCalls: [],
  finishReason: 'stop',
  rawFinishReason: 'stop',
  usage: {
    inputTokens: 2,
    outputTokens: 1,
    totalTokens: 3,
    inputTokenDetails: { cacheReadTokens: 0 },
    outputTokenDetails: { reasoningTokens: 0 },
  },
});

describe('AiSdkDriver providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOpenAI.mockReturnValue({ chat: mocks.openAiChat });
    mocks.createOpenAICompatible.mockReturnValue({
      chatModel: mocks.compatibleChat,
    });
    mocks.createAnthropic.mockReturnValue({
      chat: mocks.anthropicChat,
      tools: {
        webSearch_20250305: vi.fn(() => ({ type: 'provider-defined' })),
      },
    });
    mocks.createGoogle.mockReturnValue({
      chat: mocks.googleChat,
      tools: {
        googleSearch: vi.fn(() => ({ type: 'provider-defined' })),
      },
    });
    mocks.generateText.mockResolvedValue(emptyResult());
  });

  it.each([
    ['openai', mocks.createOpenAI, mocks.openAiChat],
    ['anthropic', mocks.createAnthropic, mocks.anthropicChat],
    ['google', mocks.createGoogle, mocks.googleChat],
  ] as const)('uses the direct %s provider instance', async (provider, creator, chat) => {
    const driver = createAiSdkModel(
      { provider, model: 'model-1' },
      { apiKey: 'secret' },
    );
    await driver.generate({ messages: [{ role: 'user', content: 'hello' }] });

    expect(creator).toHaveBeenCalledOnce();
    expect(chat).toHaveBeenCalledWith('model-1');
    expect(mocks.generateText).toHaveBeenCalledOnce();
  });

  it('keeps custom OpenAI-compatible base URL and omits apiKey when unauthenticated', () => {
    createAiSdkModel(
      {
        provider: 'openai_compatible',
        model: 'local-model',
        baseUrl: 'http://127.0.0.1:11434/v1/',
      },
      { apiKey: '' },
    );

    expect(mocks.createOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: 'http://127.0.0.1:11434/v1',
        apiKey: undefined,
      }),
    );
  });

  it('keeps Moonshot thinking and native search request-body injection', () => {
    createAiSdkModel(
      { provider: 'moonshot', model: 'kimi-k2.6' },
      { apiKey: 'secret' },
      { nativeSearch: true },
    );
    const options = mocks.createOpenAICompatible.mock.calls[0]?.[0] as {
      transformRequestBody: (
        body: Record<string, unknown>,
      ) => Record<string, unknown>;
    };
    const transformed = options.transformRequestBody({
      model: 'kimi-k2.6',
      messages: [{ role: 'assistant', content: 'prior' }],
    });

    expect(transformed.thinking).toEqual({ type: 'enabled', keep: 'all' });
    expect(transformed.tools).toEqual(
      expect.arrayContaining([
        { type: 'builtin_function', function: { name: '$web_search' } },
      ]),
    );
    expect(transformed.messages).toEqual([
      expect.objectContaining({ role: 'assistant', reasoning_content: ' ' }),
    ]);
  });

  it('returns a visible configuration error for unsupported reasoning effort', () => {
    expect(() =>
      createAiSdkModel(
        {
          provider: 'openai',
          model: 'gpt-test',
          reasoningEffort: 'extreme',
        },
        { apiKey: 'secret' },
      ),
    ).toThrow(LlmConfigError);
  });

  it('returns a visible error for unsupported native-search combinations', () => {
    expect(() =>
      createAiSdkModel(
        { provider: 'deepseek', model: 'deepseek-chat' },
        { apiKey: 'secret' },
        { nativeSearch: true },
      ),
    ).toThrow('不支持模型原生联网搜索');
  });

  it('passes only tool metadata and schema without an execute function', async () => {
    const invoke = vi.fn();
    const driver = createAiSdkModel(
      { provider: 'openai', model: 'gpt-test' },
      { apiKey: 'secret' },
    );
    await driver.generate({
      messages: [{ role: 'user', content: 'read it' }],
      tools: [
        {
          name: 'readFile',
          description: 'Read a file',
          schema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
          invoke,
        },
      ],
    });

    const options = mocks.generateText.mock.calls[0]?.[0] as {
      tools: Record<string, { execute?: unknown }>;
    };
    expect(options.tools.readFile?.execute).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('uses AI SDK structured output without parsing JSON text', async () => {
    mocks.generateText.mockResolvedValueOnce({
      ...emptyResult(),
      output: { title: '结构化标题' },
    });
    const driver = createAiSdkModel(
      { provider: 'openai', model: 'gpt-test' },
      { apiKey: 'secret' },
    );

    const { z } = await import('zod');
    const response = await driver.generateObject({
      messages: [{ role: 'user', content: '生成标题' }],
      schema: z.object({ title: z.string() }),
      schemaName: 'chat_title',
    });

    expect(response.value).toEqual({ title: '结构化标题' });
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ output: expect.anything() }),
    );
  });
});

describe('AiSdkDriver stream contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createOpenAI.mockReturnValue({ chat: mocks.openAiChat });
  });

  it('maps text, thinking, split tool input, usage and finish reason', async () => {
    mocks.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', id: 'text-1', text: 'hello' };
        yield { type: 'reasoning-delta', id: 'reasoning-1', text: 'think' };
        yield { type: 'tool-input-start', id: 'call-1', toolName: 'readFile' };
        yield { type: 'tool-input-delta', id: 'call-1', delta: '{"path":' };
        yield { type: 'tool-input-delta', id: 'call-1', delta: '"a.ts"}' };
        yield {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'readFile',
          input: { path: 'a.ts' },
        };
        yield {
          type: 'finish',
          finishReason: 'tool-calls',
          rawFinishReason: 'tool_calls',
          totalUsage: {
            inputTokens: 10,
            outputTokens: 4,
            totalTokens: 14,
            inputTokenDetails: { cacheReadTokens: 2 },
            outputTokenDetails: { reasoningTokens: 1 },
          },
        };
      })(),
    });
    const driver = createAiSdkModel(
      { provider: 'openai', model: 'gpt-test' },
      { apiKey: 'secret' },
    );

    const events = [];
    for await (const event of driver.stream({
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'text-delta', text: 'hello' },
      { type: 'reasoning-delta', text: 'think' },
      { type: 'tool-input-start', id: 'call-1', name: 'readFile' },
      { type: 'tool-input-delta', id: 'call-1', delta: '{"path":' },
      { type: 'tool-input-delta', id: 'call-1', delta: '"a.ts"}' },
      {
        type: 'tool-call',
        call: { id: 'call-1', name: 'readFile', args: { path: 'a.ts' } },
      },
      expect.objectContaining({
        type: 'finish',
        finishReason: 'tool-calls',
        usage: expect.objectContaining({
          inputTokens: 10,
          cachedInputTokens: 2,
          reasoningTokens: 1,
        }),
      }),
    ]);
  });

  it('does not expose provider-executed native tools to Cottage execution', async () => {
    mocks.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield {
          type: 'tool-input-start',
          id: 'native-1',
          toolName: 'web_search',
          providerExecuted: true,
        };
        yield { type: 'tool-input-delta', id: 'native-1', delta: '{"q":"x"}' };
        yield {
          type: 'tool-call',
          toolCallId: 'native-1',
          toolName: 'web_search',
          input: { q: 'x' },
          providerExecuted: true,
        };
      })(),
    });
    const driver = createAiSdkModel(
      { provider: 'openai', model: 'gpt-test' },
      { apiKey: 'secret' },
    );

    const events = [];
    for await (const event of driver.stream({ messages: [] })) events.push(event);
    expect(events).toEqual([]);
  });

  it('maps a mid-stream provider failure to the runtime error event', async () => {
    const failure = new Error('stream failed');
    mocks.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', id: 'text-1', text: 'partial' };
        yield { type: 'error', error: failure };
      })(),
    });
    const driver = createAiSdkModel(
      { provider: 'openai', model: 'gpt-test' },
      { apiKey: 'secret' },
    );

    const events = [];
    for await (const event of driver.stream({ messages: [] })) events.push(event);
    expect(events).toEqual([
      { type: 'text-delta', text: 'partial' },
      { type: 'error', error: failure },
    ]);
  });
});
