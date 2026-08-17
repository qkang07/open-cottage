import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  generateText,
  jsonSchema,
  Output,
  streamText,
  tool as aiTool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LlmModelConfig } from '../../config/constants';
import {
  resolveAnthropicProxy,
  resolveGoogleProxy,
  resolveOpenAiClientProxy,
} from '../../config/aiProxy';
import {
  getProviderDefinition,
  normalizeProviderId,
  resolveLlmBaseUrl,
  type LlmProviderId,
} from '../../config/llmProviders';
import {
  getCachedProviderModels,
  resolveConfigTemperature,
} from '../../config/modelCatalog';
import {
  resolveCottageModelCapabilities,
  type CottageModelCapabilities,
} from '../../config/modelCapabilities';
import {
  applyMoonshotThinkingBody,
  shouldApplyMoonshotThinking,
} from '../../config/moonshotThinking';
import type { ProviderSecretEntry } from '../../config/secrets';
import {
  applyInjectedToolsToBody,
  resolveNativeSearchInjection,
} from '../nativeWebSearch';
import type {
  CottageAssistantResponse,
  CottageModelDriver,
  CottageModelEvent,
  CottageModelMessage,
  CottageModelRequest,
  CottageModelRuntimeIdentity,
  CottageModelUsage,
  CottageStructuredRequest,
  CottageStructuredResponse,
  CottageToolCall,
} from './model';
import type { CottageTool } from './tool';
import {
  withCottageModelMiddleware,
  type CottageModelMiddleware,
} from './modelMiddleware';

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmConfigError';
  }
}

export interface CreateChatModelOptions {
  nativeSearch?: boolean;
  presetId?: string;
  presetName?: string;
  middleware?: readonly CottageModelMiddleware[];
}

interface DriverSettings {
  temperature?: number;
  maxOutputTokens?: number;
  reasoning?:
    | 'provider-default'
    | 'none'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh';
}

interface RuntimeProvider {
  model: LanguageModel;
  providerTools?: ToolSet;
  providerId: LlmProviderId;
  baseUrl: string;
  capabilities: CottageModelCapabilities;
}

const NO_AUTH_KEY = 'cottage-no-auth';
const SDK_MAX_RETRIES = 1;

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const redactBaseUrl = (value: string): string => {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '[custom-base-url]';
  }
};

const mergeBody = (
  body: Record<string, unknown>,
  providerId: LlmProviderId,
  baseUrl: string,
  config: LlmModelConfig,
  nativeSearch: boolean,
): Record<string, unknown> => {
  const injection = nativeSearch
    ? resolveNativeSearchInjection(providerId, config.model)
    : {};
  let result = { ...body, ...(injection.modelKwargs ?? {}) };
  if (injection.fetchInjectedTools?.length) {
    result = applyInjectedToolsToBody(result, injection.fetchInjectedTools);
  }
  if (shouldApplyMoonshotThinking(providerId, baseUrl)) {
    if (config.thinkingEnabled === false) {
      result.thinking = { type: 'disabled' };
    } else {
      result = applyMoonshotThinkingBody(result);
    }
  }
  return result;
};

const wrapFetchWithBodyTransform = (
  baseFetch: typeof fetch,
  transform: (body: Record<string, unknown>) => Record<string, unknown>,
): typeof fetch =>
  async (input, init) => {
    const rawBody = init?.body ?? (input instanceof Request ? input.body : null);
    if (typeof rawBody !== 'string') return baseFetch(input, init);
    try {
      const body = JSON.stringify(transform(JSON.parse(rawBody) as Record<string, unknown>));
      if (input instanceof Request) {
        return baseFetch(new Request(input, { ...init, body }));
      }
      return baseFetch(input, { ...init, body });
    } catch {
      return baseFetch(input, init);
    }
  };

const requireBaseUrl = (
  providerId: LlmProviderId,
  config: LlmModelConfig,
  secret: ProviderSecretEntry,
): string => {
  const baseUrl = resolveLlmBaseUrl(providerId, config.baseUrl, secret.baseUrl);
  if (baseUrl) return baseUrl;
  throw new LlmConfigError(`${getProviderDefinition(providerId).label} 需要配置 Base URL`);
};

const createRuntimeProvider = (
  config: LlmModelConfig,
  secret: ProviderSecretEntry,
  nativeSearch: boolean,
): RuntimeProvider => {
  const providerId = normalizeProviderId(config.provider);
  const definition = getProviderDefinition(providerId);
  const modelMeta = getCachedProviderModels(
    providerId,
    Boolean(secret.apiKey.trim()),
    config.baseUrl ?? secret.baseUrl,
  )?.find((model) => model.id === config.model);
  const capabilities = resolveCottageModelCapabilities(config, modelMeta);
  if (nativeSearch && !capabilities.nativeSearch) {
    throw new LlmConfigError(
      `${definition.label} / ${config.model} 不支持模型原生联网搜索`,
    );
  }
  const apiKey = secret.apiKey.trim();
  const hasCustomBaseUrl = Boolean(config.baseUrl?.trim() || secret.baseUrl?.trim());
  if (!apiKey && !hasCustomBaseUrl) {
    throw new LlmConfigError('请先在设置中填写该提供商的 API Key');
  }

  const baseUrl = requireBaseUrl(providerId, config, secret);
  const transform = (body: Record<string, unknown>) =>
    mergeBody(body, providerId, baseUrl, config, nativeSearch);

  if (definition.kind === 'openai') {
    const proxy = resolveOpenAiClientProxy(providerId, baseUrl, !apiKey);
    const provider = createOpenAI({
      baseURL: proxy.baseURL,
      apiKey: apiKey || NO_AUTH_KEY,
      fetch: wrapFetchWithBodyTransform(proxy.fetch, transform),
    });
    return {
      model: provider.chat(config.model),
      providerId,
      baseUrl,
      capabilities,
    };
  }

  if (definition.kind === 'anthropic') {
    const proxy = resolveAnthropicProxy(providerId, baseUrl, !apiKey).clientOptions;
    const provider = createAnthropic({
      baseURL: proxy?.baseURL,
      apiKey: apiKey || NO_AUTH_KEY,
      fetch: proxy?.fetch,
    });
    return {
      model: provider.chat(config.model),
      providerTools: nativeSearch
        ? { native_web_search: provider.tools.webSearch_20250305() }
        : undefined,
      providerId,
      baseUrl,
      capabilities,
    };
  }

  if (definition.kind === 'google') {
    const proxy = resolveGoogleProxy(providerId, baseUrl, !apiKey);
    const provider = createGoogleGenerativeAI({
      baseURL: proxy.baseUrl,
      apiKey: apiKey || NO_AUTH_KEY,
      fetch: proxy.fetch,
    });
    return {
      model: provider.chat(config.model),
      providerTools: nativeSearch
        ? { native_web_search: provider.tools.googleSearch({}) }
        : undefined,
      providerId,
      baseUrl,
      capabilities,
    };
  }

  const proxy = resolveOpenAiClientProxy(providerId, baseUrl, !apiKey);
  const provider = createOpenAICompatible({
    name: providerId,
    baseURL: proxy.baseURL,
    apiKey: apiKey || undefined,
    fetch: proxy.fetch,
    includeUsage: true,
    transformRequestBody: transform,
  });
  return {
    model: provider.chatModel(config.model),
    providerId,
    baseUrl,
    capabilities,
  };
};

const toAiMessage = (message: CottageModelMessage): ModelMessage => {
  if (message.role === 'system') return message;
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return { role: 'user', content: message.content };
    }
    return {
      role: 'user',
      content: message.content.map((part) =>
        part.type === 'text'
          ? part
          : { type: 'image' as const, image: part.url, mediaType: part.mediaType },
      ),
    } as ModelMessage;
  }
  if (message.role === 'assistant') {
    const content: Array<Record<string, unknown>> = [];
    if (message.reasoningContent) {
      content.push({ type: 'reasoning', text: message.reasoningContent });
    }
    if (message.content) content.push({ type: 'text', text: message.content });
    for (const call of message.toolCalls ?? []) {
      content.push({
        type: 'tool-call',
        toolCallId: call.id,
        toolName: call.name,
        input: call.args,
      });
    }
    return {
      role: 'assistant',
      content: content.length ? content : message.content,
    } as ModelMessage;
  }
  return {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: message.toolCallId,
        toolName: message.name ?? 'tool',
        output: { type: 'text', value: message.content },
      },
    ],
  } as ModelMessage;
};

const splitMessages = (
  messages: readonly CottageModelMessage[],
): { system?: string; messages: ModelMessage[] } => {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  return {
    system: system || undefined,
    messages: messages
      .filter((message) => message.role !== 'system')
      .map(toAiMessage),
  };
};

const schemaOf = (tool: CottageTool): Record<string, unknown> => {
  if ('safeParse' in tool.schema && typeof tool.schema.safeParse === 'function') {
    return zodToJsonSchema(
      tool.schema as Parameters<typeof zodToJsonSchema>[0],
      { target: 'openApi3' },
    ) as Record<string, unknown>;
  }
  return tool.schema as Record<string, unknown>;
};

const toAiTools = (
  tools: readonly CottageTool[] | undefined,
  providerTools: ToolSet | undefined,
): ToolSet | undefined => {
  const result: ToolSet = {};
  for (const cottageTool of tools ?? []) {
    result[cottageTool.name] = aiTool({
      description: cottageTool.description,
      inputSchema: jsonSchema(
        schemaOf(cottageTool) as Parameters<typeof jsonSchema>[0],
      ),
    });
  }
  Object.assign(result, providerTools ?? {});
  return Object.keys(result).length ? result : undefined;
};

const toUsage = (usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
  outputTokenDetails?: { reasoningTokens?: number };
  raw?: unknown;
} | undefined): CottageModelUsage | undefined =>
  usage
    ? {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
        raw: asRecord(usage.raw),
      }
    : undefined;

const toToolCall = (call: {
  toolCallId: string;
  toolName: string;
  input: unknown;
}): CottageToolCall => ({
  id: call.toolCallId,
  name: call.toolName,
  args: asRecord(call.input),
});

class AiSdkDriver implements CottageModelDriver {
  constructor(
    private readonly runtime: RuntimeProvider,
    private readonly settings: DriverSettings,
    private readonly identity: CottageModelRuntimeIdentity,
  ) {}

  getRuntimeIdentity(): CottageModelRuntimeIdentity {
    return { ...this.identity };
  }

  private assertRequestSupported(request: CottageModelRequest): void {
    if (request.tools?.length && this.runtime.capabilities.tools === false) {
      throw new LlmConfigError(
        `${this.identity.provider} / ${this.identity.model} 明确不支持工具调用`,
      );
    }
  }

  async *stream(
    request: CottageModelRequest,
    signal?: AbortSignal,
  ): AsyncIterable<CottageModelEvent> {
    this.assertRequestSupported(request);
    const prompt = splitMessages(request.messages);
    const result = streamText({
      model: this.runtime.model,
      ...prompt,
      tools: toAiTools(request.tools, this.runtime.providerTools),
      abortSignal: signal,
      maxRetries: SDK_MAX_RETRIES,
      ...this.settings,
    });
    const providerToolCallIds = new Set<string>();
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        yield { type: 'text-delta', text: part.text };
      } else if (part.type === 'reasoning-delta') {
        yield { type: 'reasoning-delta', text: part.text };
      } else if (part.type === 'tool-input-start') {
        if (part.providerExecuted) {
          providerToolCallIds.add(part.id);
          continue;
        }
        yield { type: 'tool-input-start', id: part.id, name: part.toolName };
      } else if (
        part.type === 'tool-input-delta' &&
        !providerToolCallIds.has(part.id)
      ) {
        yield { type: 'tool-input-delta', id: part.id, delta: part.delta };
      } else if (part.type === 'tool-call' && !part.providerExecuted) {
        yield { type: 'tool-call', call: toToolCall(part) };
      } else if (part.type === 'finish') {
        yield {
          type: 'finish',
          finishReason: part.finishReason,
          rawFinishReason: part.rawFinishReason,
          usage: toUsage(part.totalUsage),
        };
      } else if (part.type === 'error') {
        yield { type: 'error', error: part.error };
      }
    }
  }

  async generate(
    request: CottageModelRequest,
    signal?: AbortSignal,
  ): Promise<CottageAssistantResponse> {
    this.assertRequestSupported(request);
    const prompt = splitMessages(request.messages);
    const result = await generateText({
      model: this.runtime.model,
      ...prompt,
      tools: toAiTools(request.tools, this.runtime.providerTools),
      abortSignal: signal,
      maxRetries: SDK_MAX_RETRIES,
      ...this.settings,
    });
    return {
      content: result.text,
      reasoningContent: result.reasoningText,
      toolCalls: result.toolCalls
        .filter((call) => !call.providerExecuted)
        .map(toToolCall),
      finishReason: result.finishReason,
      rawFinishReason: result.rawFinishReason,
      usage: toUsage(result.usage),
    };
  }

  async generateObject<T>(
    request: CottageStructuredRequest<T>,
    signal?: AbortSignal,
  ): Promise<CottageStructuredResponse<T>> {
    const prompt = splitMessages(request.messages);
    const result = await generateText({
      model: this.runtime.model,
      ...prompt,
      output: Output.object({
        schema: request.schema,
        name: request.schemaName,
        description: request.schemaDescription,
      }),
      abortSignal: signal,
      maxRetries: SDK_MAX_RETRIES,
      ...this.settings,
    });
    return {
      value: result.output,
      reasoningContent: result.reasoningText,
      finishReason: result.finishReason,
      usage: toUsage(result.usage),
    };
  }
}

export const createAiSdkModel = (
  config: LlmModelConfig,
  secret: ProviderSecretEntry,
  options?: CreateChatModelOptions,
): CottageModelDriver => {
  const runtime = createRuntimeProvider(config, secret, options?.nativeSearch === true);
  const rawReasoning = config.reasoningEffort?.trim();
  const supportedReasoning = new Set([
    'provider-default',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
  ]);
  if (
    config.thinkingEnabled !== false &&
    rawReasoning &&
    rawReasoning !== 'max' &&
    !supportedReasoning.has(rawReasoning)
  ) {
    throw new LlmConfigError(`当前运行时不支持 reasoning effort: ${rawReasoning}`);
  }
  const reasoning: DriverSettings['reasoning'] =
    config.thinkingEnabled === false
      ? 'none'
      // Cottage 旧配置的 max 对应 AI SDK Core 可表达的最高档 xhigh。
      : rawReasoning === 'max'
        ? 'xhigh'
        : (rawReasoning as DriverSettings['reasoning']);
  const driver = new AiSdkDriver(
    runtime,
    {
      temperature: resolveConfigTemperature(config),
      maxOutputTokens: config.maxTokens,
      reasoning,
    },
    {
      provider: runtime.providerId,
      model: config.model,
      connectionId: config.connectionId?.trim() || undefined,
      presetId: options?.presetId,
      presetName: options?.presetName,
      baseUrl: redactBaseUrl(runtime.baseUrl),
    },
  );
  return withCottageModelMiddleware(driver, options?.middleware);
};
