/**
 * 生图上下文解析：复用厂商 API Key（IndexedDB secrets），
 * 与 chat/embeddings 相同地走 网关 / Cottage Service 代理 / 直连 三种路由。
 * 可通过 imageGen.providerOverride 独立指定生图厂商（不强制跟随对话预设）。
 */

import { getCottageConfig, getSessionActiveImagePresetId } from '../config/store';
import {
  getPresetApiKey,
  getSecretForProvider,
  loadProviderSecrets,
  type SecretProviderId,
} from '../config/secrets';
import {
  getProviderDefinition,
  normalizeProviderId,
  providerLabel,
  resolveLlmBaseUrl,
  type LlmProviderId,
} from '../config/llmProviders';
import {
  resolveOpenAiClientProxy,
} from '../config/aiProxy';
import {
  createCottageServiceProxiedFetch,
  getCottageServiceBaseUrl,
  isCottageServiceHttpProxyEnabled,
} from '../config/cottageServiceProxy';
import type { ImageGenConfig, ImageGenModelPreset, LlmModelConfig } from '../config/constants';
import {
  defaultImageEditModel,
  defaultImageGenModel,
  fallbackAdapterForProvider,
  findImageGenModelEntry,
  imageGenModelsForProvider,
  loadOpenRouterImageModels,
  type ImageGenModelEntry,
} from './catalog';
import type { ImageGenAdapterKind, ResolvedImageGenContext } from './types';

export type ImageGenPurpose = 'generate' | 'edit';

const DASHSCOPE_NATIVE_BASE = 'https://dashscope.aliyuncs.com/api/v1';
const DEFAULT_POLL_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_N = 4;

const trimTrailingSlash = (s: string): string => s.replace(/\/$/, '');

/** 当前会话优先；没有会话选择时使用设置页指定的默认生图模型。 */
export const getActiveImageGenModelPreset = (
  config: ImageGenConfig | undefined = getCottageConfig().imageGen,
): ImageGenModelPreset | undefined => {
  const presets = config?.modelPresets ?? [];
  const preferredId = getSessionActiveImagePresetId() ?? config?.activePresetId;
  return presets.find((preset) => preset.id === preferredId) ?? presets[0];
};

export const resolveImageGenDefaultSize = (): string | undefined => {
  const config = getCottageConfig().imageGen;
  return getActiveImageGenModelPreset(config)?.defaultSize ?? config?.defaultSize;
};

/** 当前对话使用的模型配置（优先激活预设，回退全局 llm 配置） */
const resolveActiveModelConfig = (): LlmModelConfig => {
  const config = getCottageConfig();
  const preset = config.modelPresets?.find((p) => p.id === config.activePresetId);
  const modelConfig = preset?.config ?? config.llm;
  if (!modelConfig?.provider) {
    throw new Error('尚未配置对话模型，无法确定默认生图厂商（或请在模型设置中指定独立生图厂商）');
  }
  return modelConfig;
};

/** 解析生图厂商：独立覆盖优先，否则跟随对话预设 */
export const resolveImageGenProviderId = (
  chatProviderId?: LlmProviderId,
): LlmProviderId => {
  const config = getCottageConfig();
  const preset = getActiveImageGenModelPreset(config.imageGen);
  if (preset) return preset.provider;
  const override = config.imageGen?.providerOverride?.trim();
  if (override) return normalizeProviderId(override);
  if (chatProviderId) return chatProviderId;
  return normalizeProviderId(resolveActiveModelConfig().provider);
};

interface ResolvedModelChoice {
  model: string;
  entry: ImageGenModelEntry | undefined;
}

const resolveModelChoice = async (
  providerId: LlmProviderId,
  purpose: ImageGenPurpose,
): Promise<ResolvedModelChoice> => {
  // 运行时也刷新一次目录，使通过配置保存的动态模型能获得正确的能力信息。
  // 网络失败时继续使用内置后备清单，不影响已有配置。
  if (providerId === 'openrouter') {
    try {
      await loadOpenRouterImageModels();
    } catch {
      /* fallback catalog */
    }
  }
  const config = getCottageConfig();
  const selectedPreset = getActiveImageGenModelPreset(config.imageGen);
  const selectedModel = selectedPreset?.provider === providerId
    ? selectedPreset.model.trim()
    : '';
  if (selectedModel) {
    const entry = findImageGenModelEntry(providerId, selectedModel);
    if (purpose === 'edit' && entry && !entry.supportsEdit) {
      const editEntry = defaultImageEditModel(providerId);
      if (editEntry) return { model: editEntry.id, entry: editEntry };
      throw new Error(
        `模型「${selectedModel}」不支持图片编辑，且「${providerLabel(providerId)}」暂无可用的编辑模型`,
      );
    }
    return { model: selectedModel, entry };
  }
  const override = config.imageGen?.modelOverrides?.[providerId]?.trim();
  if (override) {
    const entry = findImageGenModelEntry(providerId, override);
    if (purpose === 'edit' && entry && !entry.supportsEdit) {
      const editEntry = defaultImageEditModel(providerId);
      if (editEntry) return { model: editEntry.id, entry: editEntry };
      throw new Error(
        `模型「${override}」不支持图片编辑，且「${providerLabel(providerId)}」暂无可用的编辑模型`,
      );
    }
    return { model: override, entry };
  }

  const entry =
    purpose === 'edit'
      ? defaultImageEditModel(providerId)
      : defaultImageGenModel(providerId);
  if (!entry) {
    const hasAny = imageGenModelsForProvider(providerId).length > 0;
    throw new Error(
      purpose === 'edit' && hasAny
        ? `「${providerLabel(providerId)}」的生图模型暂不支持图片编辑`
        : `「${providerLabel(providerId)}」暂无内置生图模型，请在模型设置中切换到支持生图的厂商（OpenAI / OpenRouter / 智谱 / 通义 / 硅基流动 / 豆包），或为当前预设指定独立生图厂商`,
    );
  }
  return { model: entry.id, entry };
};

/** 计算 openai-images 适配器的 API 基地址（直连形态） */
const resolveOpenAiImagesBase = (
  providerId: LlmProviderId,
  modelConfig: LlmModelConfig,
  secretBaseUrl: string | undefined,
): string => {
  const def = getProviderDefinition(providerId);
  if (def.kind === 'openai') return 'https://api.openai.com/v1';
  const base = resolveLlmBaseUrl(providerId, modelConfig.baseUrl, secretBaseUrl);
  if (!base) {
    throw new Error(`「${providerLabel(providerId)}」需先配置 Base URL 才能生图`);
  }
  return base;
};

/** 即使走 env 网关，结果图 URL 下载仍尽量经 Cottage Service 绕过 CORS */
const resolveFetchImpl = (proxied?: typeof fetch): typeof fetch => {
  if (proxied) return proxied;
  let fetchImpl = globalThis.fetch.bind(globalThis);
  const serviceBase = getCottageServiceBaseUrl();
  if (isCottageServiceHttpProxyEnabled() && serviceBase) {
    fetchImpl = createCottageServiceProxiedFetch(serviceBase, fetchImpl);
  }
  return fetchImpl;
};

const capabilitiesFromEntry = (entry: ImageGenModelEntry | undefined) => ({
  supportsNegativePrompt: entry?.supportsNegativePrompt ?? false,
  supportsSize: entry?.supportsSize !== false,
  maxN: entry?.maxN ?? DEFAULT_MAX_N,
  omitResponseFormat: entry?.omitResponseFormat ?? false,
  supportsEdit: entry?.supportsEdit ?? true,
});

/**
 * 解析生图调用上下文。
 * 失败时抛出面向用户的可读错误，工具层将其转为软失败提示。
 */
export async function resolveImageGenContext(
  purpose: ImageGenPurpose,
): Promise<ResolvedImageGenContext> {
  const config = getCottageConfig();
  const modelConfig = (() => {
    try {
      return resolveActiveModelConfig();
    } catch (error) {
      const imagePreset = getActiveImageGenModelPreset(config.imageGen);
      if (imagePreset || config.imageGen?.providerOverride?.trim()) {
        // 独立指定了生图厂商时，对话模型可不配；用空壳配置走厂商 secrets
        return {
          provider: imagePreset?.provider ?? config.imageGen?.providerOverride,
        } as LlmModelConfig;
      }
      throw error;
    }
  })();

  const chatProviderId = normalizeProviderId(modelConfig.provider);
  const providerId = resolveImageGenProviderId(chatProviderId);
  const def = getProviderDefinition(providerId);
  if (def.kind === 'anthropic' || def.kind === 'google') {
    throw new Error(
      `「${providerLabel(providerId)}」暂不支持图片生成，请在模型设置中切换到支持生图的厂商（OpenAI / OpenRouter / 智谱 / 通义 / 硅基流动 / 豆包），或为当前预设指定独立生图厂商`,
    );
  }

  const { model, entry } = await resolveModelChoice(providerId, purpose);
  const adapter: ImageGenAdapterKind =
    entry?.adapter ?? fallbackAdapterForProvider(providerId);
  const pollTimeoutMs = config.imageGen?.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const caps = capabilitiesFromEntry(entry);
  const common = {
    providerId,
    model,
    adapter,
    supportsEdit: caps.supportsEdit,
    supportsNegativePrompt: caps.supportsNegativePrompt,
    supportsSize: caps.supportsSize,
    maxN: caps.maxN,
    omitResponseFormat: caps.omitResponseFormat,
    pollTimeoutMs,
  };

  // 覆盖厂商与对话厂商不同时，baseUrl 不应误用对话预设里的自定义地址
  const sameAsChat = providerId === chatProviderId;
  const effectiveModelConfig: LlmModelConfig = sameAsChat
    ? modelConfig
    : { provider: providerId, model };

  const secrets = await loadProviderSecrets();
  const selectedImagePreset = getActiveImageGenModelPreset(config.imageGen);
  const providerSecret = getSecretForProvider(
    secrets,
    providerId as SecretProviderId,
    selectedImagePreset?.provider === providerId
      ? selectedImagePreset.connectionId
      : sameAsChat
        ? modelConfig.connectionId
        : undefined,
  );

  const activePreset = config.modelPresets?.find(
    (p) => p.id === config.activePresetId,
  );
  const presetSecret =
    sameAsChat && activePreset
      ? getPresetApiKey(secrets, activePreset.id)
      : undefined;
  const apiKey =
    (sameAsChat ? effectiveModelConfig.apiKey?.trim() : '') ||
    presetSecret?.apiKey?.trim() ||
    providerSecret?.apiKey?.trim() ||
    '';
  const hasCustomBaseUrl = Boolean(effectiveModelConfig.baseUrl?.trim() || providerSecret?.baseUrl?.trim());
  if (!apiKey && !hasCustomBaseUrl) {
    throw new Error(
      `请先为「${providerLabel(providerId)}」配置 API Key 后再使用图片生成`,
    );
  }

  let baseURL: string;
  if (adapter === 'dashscope-native') {
    const custom =
      (sameAsChat ? effectiveModelConfig.baseUrl?.trim() : '') ||
      providerSecret?.baseUrl?.trim();
    baseURL = custom
      ? `${new URL(custom).origin}/api/v1`
      : DASHSCOPE_NATIVE_BASE;
  } else {
    baseURL = resolveOpenAiImagesBase(
      providerId,
      effectiveModelConfig,
      providerSecret?.baseUrl,
    );
  }

  const proxy = resolveOpenAiClientProxy(providerId, baseURL, !apiKey);
  return {
    ...common,
    baseURL: trimTrailingSlash(proxy.baseURL),
    apiKey,
    fetchImpl: resolveFetchImpl(proxy.fetch),
  };
}
