/**
 * 动态模型目录：
 * 1. 厂商 OpenAI 兼容 GET /v1/models（需 API Key，最贴近账号可用模型）
 * 2. models.dev 公共目录 https://models.dev/api.json（无需 Key，CORS *）
 * 3. 无可用来源时返回空列表（需配置代理或 API Key）
 */

import { resolveOpenAiClientProxy } from './aiProxy';
import type { LlmModelConfig } from './constants';
import {
  getProviderDefinition,
  parseModelVendor,
  resolveLlmBaseUrl,
  type LlmModelOption,
  type LlmProviderId,
} from './llmProviders';
import {
  resolveCottageModelCapabilities,
  supportsThinkingControl,
  supportsVisionInput,
} from './modelCapabilities';

const DEFAULT_TEMPERATURE = 1;

/** 模型目录标记 `temperature: false` 时不支持采样温度，返回 undefined（不下发），否则使用配置或默认 1 */
export const resolveConfigTemperature = (
  config: Pick<LlmModelConfig, 'temperature' | 'model' | 'provider'>,
): number | undefined => {
  const meta = getCachedProviderModels(config.provider, true)?.find(
    (m) => m.id === config.model,
  );
  const capabilities = resolveCottageModelCapabilities(config, meta);
  if (capabilities.temperature === false) return undefined;
  return config.temperature ?? DEFAULT_TEMPERATURE;
};

export type ModelCatalogSource =
  | 'static'
  | 'models_dev'
  | 'provider_api';

export interface ModelCatalogResult {
  models: LlmModelOption[];
  source: ModelCatalogSource;
  fetchedAt: number;
  error?: string;
}

/** models.dev 中 provider id 与 Cottage LlmProviderId 的映射 */
export const MODELS_DEV_PROVIDER_ID: Partial<Record<LlmProviderId, string>> = {
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  openrouter: 'openrouter',
  deepseek: 'deepseek',
  moonshot: 'moonshotai',
  zhipu: 'zhipuai',
  dashscope: 'alibaba',
  siliconflow: 'siliconflow',
  minimax: 'minimax',
  stepfun: 'stepfun',
};

/** models.dev `reasoning_options` 条目 */
type ModelsDevReasoningOption =
  | { type: 'effort'; values?: string[] }
  | { type: 'toggle' }
  | { type: 'budget_tokens'; min?: number; max?: number }
  | { type: string; values?: string[] };

/** 从 models.dev reasoning_options 提取可调 effort 档位 */
export const parseReasoningEffortValues = (
  options: ModelsDevReasoningOption[] | undefined,
): string[] | undefined => {
  if (!Array.isArray(options)) return undefined;
  for (const opt of options) {
    if (opt?.type === 'effort' && Array.isArray(opt.values) && opt.values.length > 0) {
      return opt.values.filter((v): v is string => typeof v === 'string' && v.length > 0);
    }
  }
  return undefined;
};

/** 是否声明了 toggle 型思考开关 */
export const parseReasoningToggle = (
  options: ModelsDevReasoningOption[] | undefined,
): boolean | undefined => {
  if (!Array.isArray(options)) return undefined;
  return options.some((opt) => opt?.type === 'toggle') ? true : undefined;
};

/**
 * 模型是否支持在 UI 中控制思考（开关和/或强度）。
 * - reasoning === true
 * - 有 toggle
 * - 有 effort 档位
 */
export const modelSupportsThinkingControl = (
  meta: Pick<
    LlmModelOption,
    'reasoning' | 'reasoningToggle' | 'reasoningEffortValues'
  > | null | undefined,
): boolean => {
  if (!meta) return false;
  return supportsThinkingControl(
    resolveCottageModelCapabilities({ provider: 'openai_compatible', model: '' }, {
      id: '',
      label: '',
      ...meta,
    }),
  );
};

/**
 * 模型是否已明确声明支持图片输入。
 * 能力门控开启时采用保守策略：目录未提供能力信息时不发送图片，
 * 避免把图片交给实际不支持视觉输入的模型。用户可关闭能力门控手动放行自定义模型。
 */
export const modelSupportsVision = (
  meta: Pick<LlmModelOption, 'vision'> | null | undefined,
): boolean =>
  supportsVisionInput(
    resolveCottageModelCapabilities(
      { provider: 'openai_compatible', model: '' },
      meta ? { id: '', label: '', ...meta } : null,
    ),
  );

/** 格式化 token 上限展示（如 128K、1M） */
export const formatTokenLimit = (n: number): string => {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : Number(m.toFixed(1))}M`;
  }
  if (n >= 1000) {
    const k = n / 1000;
    return `${Number.isInteger(k) ? k : Number(k.toFixed(1))}K`;
  }
  return String(n);
};

/** 当模型支持 effort 且配置未指定时，选一个合理默认档 */
export const pickDefaultReasoningEffort = (
  values: readonly string[] | undefined,
): string | undefined => {
  if (!values?.length) return undefined;
  for (const preferred of ['medium', 'high', 'low']) {
    if (values.includes(preferred)) return preferred;
  }
  return values[Math.floor((values.length - 1) / 2)];
};

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_PREFIX = 'open-cottage:model-catalog:';
const CACHE_TTL_MS = 60 * 60 * 1000;

type ModelsDevModel = {
  id: string;
  name?: string;
  family?: string;
  release_date?: string;
  tool_call?: boolean;
  /** 是否支持 temperature；缺省表示未知 */
  temperature?: boolean;
  /** 是否具备推理/思考能力 */
  reasoning?: boolean;
  /** 思考强度/预算等可选项 */
  reasoning_options?: ModelsDevReasoningOption[];
  modalities?: { input?: string[]; output?: string[] };
  /** models.dev 提供的上下文/输出上限 */
  limit?: { context?: number; output?: number };
};

type ModelsDevCatalog = Record<
  string,
  { models?: Record<string, ModelsDevModel> }
>;

let modelsDevPromise: Promise<ModelsDevCatalog> | null = null;
/** 已解析的完整 models.dev 目录，供同步查询上下文窗口 */
let modelsDevCatalog: ModelsDevCatalog | null = null;

const readCache = (key: string): ModelCatalogResult | null => {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ModelCatalogResult;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCache = (key: string, result: ModelCatalogResult) => {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(result));
  } catch {
    /* quota */
  }
};

const emptyFallback = (): ModelCatalogResult => ({
  models: [],
  source: 'static',
  fetchedAt: Date.now(),
});

const isChatLikeModelId = (id: string): boolean => {
  const lower = id.toLowerCase();
  if (
    /embed|embedding|rerank|whisper|tts|dall-e|image|audio|moderation|realtime|translate|legacy/.test(
      lower,
    )
  ) {
    return false;
  }
  return true;
};

/** models.dev 条目 → 目录选项（导出供单测验证 modalities 解析） */
export const fromModelsDevEntry = (entry: ModelsDevModel): LlmModelOption => ({
  id: entry.id,
  label: entry.name?.trim() || entry.id,
  hint: entry.family,
  temperature:
    typeof entry.temperature === 'boolean' ? entry.temperature : undefined,
  reasoning: typeof entry.reasoning === 'boolean' ? entry.reasoning : undefined,
  reasoningEffortValues: parseReasoningEffortValues(entry.reasoning_options),
  reasoningToggle: parseReasoningToggle(entry.reasoning_options),
  vision: Array.isArray(entry.modalities?.input)
    ? entry.modalities.input.includes('image')
    : undefined,
  tools: typeof entry.tool_call === 'boolean' ? entry.tool_call : undefined,
  contextLimit:
    typeof entry.limit?.context === 'number' && entry.limit.context > 0
      ? entry.limit.context
      : undefined,
  outputLimit:
    typeof entry.limit?.output === 'number' && entry.limit.output > 0
      ? entry.limit.output
      : undefined,
});

/** 在已缓存的 models.dev 目录中查找模型元数据 */
const lookupModelsDevEntry = (
  providerId: LlmProviderId,
  modelId: string,
): ModelsDevModel | null => {
  if (!modelId || !modelsDevCatalog) return null;
  const devId = MODELS_DEV_PROVIDER_ID[providerId];
  if (devId) {
    const hit = modelsDevCatalog[devId]?.models?.[modelId];
    if (hit) return hit;
  }
  // 聚合器或未映射厂商：按 id 在各 provider 块中兜底查找
  for (const block of Object.values(modelsDevCatalog)) {
    const hit = block?.models?.[modelId];
    if (hit) return hit;
  }
  return null;
};

/** 用 models.dev 能力字段补全目录条目（不覆盖已有明确值） */
const enrichWithModelsDev = (
  providerId: LlmProviderId,
  option: LlmModelOption,
): LlmModelOption => {
  const entry = lookupModelsDevEntry(providerId, option.id);
  if (!entry) return option;
  const fromDev = fromModelsDevEntry(entry);
  return {
    ...option,
    temperature: option.temperature ?? fromDev.temperature,
    reasoning: option.reasoning ?? fromDev.reasoning,
    // effort 档位优先用 models.dev 精确列表
    reasoningEffortValues:
      fromDev.reasoningEffortValues ?? option.reasoningEffortValues,
    reasoningToggle: option.reasoningToggle ?? fromDev.reasoningToggle,
    vision: option.vision ?? fromDev.vision,
    tools: option.tools ?? fromDev.tools,
    contextLimit: option.contextLimit ?? fromDev.contextLimit,
    outputLimit: option.outputLimit ?? fromDev.outputLimit,
    hint: option.hint ?? fromDev.hint,
    label:
      option.label === option.id && fromDev.label !== fromDev.id
        ? fromDev.label
        : option.label,
  };
};

const enrichModels = (
  providerId: LlmProviderId,
  models: LlmModelOption[],
): LlmModelOption[] => {
  if (!modelsDevCatalog) return models;
  return models.map((m) => enrichWithModelsDev(providerId, m));
};

/** 尽量用 models.dev 补全能力字段后再返回/缓存 */
const finalizeCatalogResult = async (
  providerId: LlmProviderId,
  result: ModelCatalogResult,
): Promise<ModelCatalogResult> => {
  try {
    await fetchModelsDevCatalog();
  } catch {
    /* 离线时跳过补全 */
  }
  return {
    ...result,
    models: enrichModels(providerId, result.models),
  };
};

const fetchModelsDevCatalog = async (): Promise<ModelsDevCatalog> => {
  if (!modelsDevPromise) {
    modelsDevPromise = fetch(MODELS_DEV_URL).then(async (res) => {
      if (!res.ok) {
        throw new Error(`models.dev HTTP ${res.status}`);
      }
      const catalog = (await res.json()) as ModelsDevCatalog;
      modelsDevCatalog = catalog;
      return catalog;
    });
  }
  return modelsDevPromise;
};

/** 触发一次 models.dev 目录预热（幂等，忽略错误），用于同步查询上下文窗口 */
export const ensureModelsDevCatalog = (): void => {
  if (modelsDevCatalog) return;
  void fetchModelsDevCatalog().catch(() => {
    /* 离线或 CORS 失败时忽略，回退到本地规则 */
  });
};

/**
 * 从已缓存的 models.dev 目录中同步解析模型真实上下文窗口。
 * 目录尚未就绪时返回 null 并后台预热，由调用方回退到本地规则。
 */
export const resolveCatalogContextWindow = (
  providerId: LlmProviderId,
  modelId: string,
): number | null => {
  if (!modelId) return null;
  if (!modelsDevCatalog) {
    ensureModelsDevCatalog();
    return null;
  }
  const devId = MODELS_DEV_PROVIDER_ID[providerId];
  const blocks = devId
    ? [modelsDevCatalog[devId]]
    : Object.values(modelsDevCatalog);
  for (const block of blocks) {
    const context = block?.models?.[modelId]?.limit?.context;
    if (typeof context === 'number' && context > 0) return context;
  }
  return null;
};

const fetchFromModelsDev = async (
  providerId: LlmProviderId,
): Promise<LlmModelOption[] | null> => {
  const devId = MODELS_DEV_PROVIDER_ID[providerId];
  if (!devId) return null;

  const catalog = await fetchModelsDevCatalog();
  const block = catalog[devId];
  if (!block?.models) return null;

  return Object.values(block.models)
    .filter((m) => m.id && isChatLikeModelId(m.id))
    .sort((a, b) => (b.release_date ?? '').localeCompare(a.release_date ?? ''))
    .map(fromModelsDevEntry);
};

const fetchFromOpenAiCompatibleApi = async (
  providerId: LlmProviderId,
  baseUrl: string,
  apiKey?: string,
): Promise<LlmModelOption[]> => {
  const proxy = resolveOpenAiClientProxy(providerId, baseUrl, !apiKey?.trim());
  const root = proxy.baseURL.replace(/\/$/, '');
  const httpFetch = proxy.fetch;
  const key = apiKey?.trim();
  const res = await httpFetch(`${root}/models`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!res.ok) {
    throw new Error(`模型列表 HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    data?: {
      id: string;
      name?: string;
      temperature?: boolean;
      supported_parameters?: string[];
      context_length?: number;
      architecture?: { input_modalities?: string[] };
      top_provider?: { context_length?: number; max_completion_tokens?: number };
    }[];
  };
  const raw = (body.data ?? []).filter(
    (m) => m.id && isChatLikeModelId(m.id),
  );
  const seen = new Set<string>();
  const models: LlmModelOption[] = [];
  for (const m of raw) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const params = Array.isArray(m.supported_parameters)
      ? m.supported_parameters
      : null;
    const temperature = params
      ? params.includes('temperature')
      : typeof m.temperature === 'boolean'
        ? m.temperature
        : undefined;
    const supportsEffort = Boolean(
      params?.includes('reasoning_effort') || params?.includes('reasoning'),
    );
    const tools = params ? params.includes('tools') : undefined;
    const contextLimit =
      (typeof m.context_length === 'number' && m.context_length > 0
        ? m.context_length
        : undefined) ??
      (typeof m.top_provider?.context_length === 'number' &&
      m.top_provider.context_length > 0
        ? m.top_provider.context_length
        : undefined);
    const outputLimit =
      typeof m.top_provider?.max_completion_tokens === 'number' &&
      m.top_provider.max_completion_tokens > 0
        ? m.top_provider.max_completion_tokens
        : undefined;
    // OpenRouter 等返回 architecture.input_modalities（如 ['text','image']）
    const vision = Array.isArray(m.architecture?.input_modalities)
      ? m.architecture.input_modalities.includes('image')
      : undefined;
    models.push({
      id: m.id,
      label: m.name?.trim() || m.id,
      vendor: parseModelVendor(m.id),
      temperature,
      reasoning: supportsEffort || undefined,
      // 厂商 API 未给出具体档位时给通用三档；随后可由 models.dev 覆盖为精确列表
      reasoningEffortValues: params?.includes('reasoning_effort')
        ? ['low', 'medium', 'high']
        : undefined,
      vision,
      tools,
      contextLimit,
      outputLimit,
    });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
};

export interface FetchProviderModelsOptions {
  providerId: LlmProviderId;
  apiKey?: string;
  configBaseUrl?: string;
  secretBaseUrl?: string;
  /** 跳过缓存强制刷新 */
  force?: boolean;
}

/**
 * 拉取某厂商可选模型（带 session 缓存）。
 * 优先自定义/厂商 API（可经 Cottage Service /proxy），再次 models.dev。
 */
export const fetchProviderModels = async (
  options: FetchProviderModelsOptions,
): Promise<ModelCatalogResult> => {
  const { providerId, apiKey, configBaseUrl, secretBaseUrl, force } = options;

  const cacheKey = `${providerId}:${apiKey ? 'k' : 'nk'}:${configBaseUrl ?? secretBaseUrl ?? ''}`;
  if (!force) {
    const hit = readCache(cacheKey);
    if (hit) return finalizeCatalogResult(providerId, hit);
  }

  const def = getProviderDefinition(providerId);
  const errors: string[] = [];

  if ((apiKey?.trim() || def.isAggregator || configBaseUrl?.trim() || secretBaseUrl?.trim()) && def.kind === 'openai_compatible') {
    const baseUrl = resolveLlmBaseUrl(providerId, configBaseUrl, secretBaseUrl);
    if (baseUrl) {
      try {
        const models = await fetchFromOpenAiCompatibleApi(
          providerId,
          baseUrl,
          apiKey?.trim(),
        );
        if (models.length > 0) {
          const result = await finalizeCatalogResult(providerId, {
            models,
            source: 'provider_api',
            fetchedAt: Date.now(),
          });
          writeCache(cacheKey, result);
          return result;
        }
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  if ((apiKey?.trim() || configBaseUrl?.trim() || secretBaseUrl?.trim()) && def.kind === 'openai') {
    const baseUrl = resolveLlmBaseUrl(providerId, configBaseUrl, secretBaseUrl);
    if (baseUrl) {
      try {
        const models = await fetchFromOpenAiCompatibleApi(
          'openai',
          baseUrl,
          apiKey?.trim(),
        );
        if (models.length > 0) {
          const result = await finalizeCatalogResult(providerId, {
            models,
            source: 'provider_api',
            fetchedAt: Date.now(),
          });
          writeCache(cacheKey, result);
          return result;
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  }

  try {
    const fromDev = await fetchFromModelsDev(providerId);
    if (fromDev?.length) {
      const result = await finalizeCatalogResult(providerId, {
        models: fromDev,
        source: 'models_dev',
        fetchedAt: Date.now(),
        error: errors.length ? errors.join('；') : undefined,
      });
      writeCache(cacheKey, result);
      return result;
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const fallback = emptyFallback();
  return {
    ...fallback,
    error: errors.length
      ? errors.join('；')
      : '未能拉取模型列表，请检查 Base URL、跨域配置或 API Key',
  };
};

export const getCachedProviderModels = (
  providerId: LlmProviderId,
  hasApiKey: boolean,
  baseUrl?: string,
): LlmModelOption[] | null => {
  const cacheSuffix = baseUrl?.trim() ?? '';
  const primary = readCache(
    `${providerId}:${hasApiKey ? 'k' : 'nk'}:${cacheSuffix}`,
  );
  const alternate = readCache(
    `${providerId}:${hasApiKey ? 'nk' : 'k'}:${cacheSuffix}`,
  );
  // 未指定 Base URL 或对应缓存尚未建立时，兼容历史的默认缓存键。
  const fallback = cacheSuffix
    ? readCache(`${providerId}:${hasApiKey ? 'k' : 'nk'}:`) ??
      readCache(`${providerId}:${hasApiKey ? 'nk' : 'k'}:`)
    : null;
  const cached = primary ?? alternate ?? fallback;
  if (!cached) return null;
  // 同步路径：若目录已就绪则补全；否则后台预热并返回缓存原样
  if (!modelsDevCatalog) ensureModelsDevCatalog();
  return enrichModels(providerId, cached.models);
};

export const modelCatalogSourceLabel = (source: ModelCatalogSource): string => {
  switch (source) {
    case 'provider_api':
      return '厂商 API';
    case 'models_dev':
      return 'models.dev';
    default:
      return '无可用列表';
  }
};
