import { ref } from 'vue';
import { normalizeEnabledTools } from '../agent/toolCatalog';
import {
  type CodingIndexConfig,
  type CapabilityPacksConfig,
  type ContentConfig,
  DEFAULT_COTTAGE_CONFIG,
  type CottageConfig,
  type CottageServiceConfig,
  type HistoryConfig,
  type ImageGenConfig,
  type LlmModelConfig,
  type McpConfig,
  type ModelPreset,
  type OfficeTemplateConfig,
  type PlatformConfig,
  type PythonConfig,
  type RagConfig,
  type SkillsConfig,
  type VisionConfig,
} from './constants';
import { normalizeProviderId, resolveModelForProvider } from './llmProviders';

// ─── 深合并工具 ─────────────────────────────────────────────────────────────

/** 递归合并两个对象（patch 优先，undefined 不覆盖） */
const deepMerge = <T extends Record<string, unknown>>(base: T, patch: Partial<T> | undefined): T => {
  if (!patch) return base;
  const result = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(patch)) {
    const patchVal = (patch as Record<string, unknown>)[key];
    const baseVal = (base as Record<string, unknown>)[key];
    if (patchVal === undefined) continue;
    if (
      patchVal !== null &&
      typeof patchVal === 'object' &&
      !Array.isArray(patchVal) &&
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        patchVal as Record<string, unknown>,
      );
    } else {
      result[key] = patchVal;
    }
  }
  return result as T;
};

const normalizeLlmConfig = (llm: LlmModelConfig): LlmModelConfig => {
  const provider = normalizeProviderId(llm.provider);
  return {
    ...llm,
    provider,
    model: resolveModelForProvider(provider, llm.model),
  };
};

const hasConfiguredLlm = (llm?: LlmModelConfig): boolean =>
  Boolean(llm?.provider && llm?.model?.trim());

const normalizeModelSettings = (config: CottageConfig): {
  modelPresets: ModelPreset[];
  activePresetId?: string;
  llm?: LlmModelConfig;
} => {
  const modelPresets = (config.modelPresets ?? []).map((preset) => ({
    ...preset,
    config: normalizeLlmConfig(preset.config),
  }));
  const activePresetId = modelPresets.some((p) => p.id === config.activePresetId)
    ? config.activePresetId
    : modelPresets[0]?.id;
  const activePreset = modelPresets.find((p) => p.id === activePresetId);
  const llm = activePreset
    ? normalizeLlmConfig(activePreset.config)
    : hasConfiguredLlm(config.llm)
      ? normalizeLlmConfig(config.llm!)
      : undefined;
  return {
    modelPresets,
    activePresetId: modelPresets.length > 0 ? activePresetId : undefined,
    llm,
  };
};

let cached: CottageConfig = {};

export interface CachedConfigLayers {
  folder: CottageConfig | null;
  domain: CottageConfig | null;
}

let cachedConfigLayers: CachedConfigLayers | null = null;

export const setCachedConfigLayers = (layers: CachedConfigLayers): void => {
  cachedConfigLayers = layers;
};

const resolveLlmFromLayerConfig = (
  layerConfig: CottageConfig | null | undefined,
): LlmModelConfig | null => {
  if (!layerConfig) return null;
  const presets = layerConfig.modelPresets ?? [];
  if (presets.length > 0) {
    const activeId =
      layerConfig.activePresetId &&
      presets.some((preset) => preset.id === layerConfig.activePresetId)
        ? layerConfig.activePresetId
        : presets[0]?.id;
    const preset = presets.find((item) => item.id === activeId);
    if (preset && hasConfiguredLlm(preset.config)) {
      return normalizeLlmConfig(preset.config);
    }
  }
  if (hasConfiguredLlm(layerConfig.llm)) {
    return normalizeLlmConfig(layerConfig.llm!);
  }
  return null;
};

const resolveLlmFromCachedLayers = (): LlmModelConfig | null => {
  if (!cachedConfigLayers) return null;
  return (
    resolveLlmFromLayerConfig(cachedConfigLayers.folder) ??
    resolveLlmFromLayerConfig(cachedConfigLayers.domain)
  );
};

const resolveActivePresetFromCachedLayers = (): ModelPreset | undefined => {
  if (!cachedConfigLayers) return undefined;
  for (const layerConfig of [
    cachedConfigLayers.folder,
    cachedConfigLayers.domain,
  ]) {
    const presets = layerConfig?.modelPresets ?? [];
    if (!presets.length) continue;
    const activeId =
      layerConfig?.activePresetId &&
      presets.some((preset) => preset.id === layerConfig.activePresetId)
        ? layerConfig.activePresetId
        : presets[0]?.id;
    const preset = presets.find((item) => item.id === activeId);
    if (preset) return preset;
  }
  return undefined;
};

const migrateCottageServiceConfig = (
  raw?: CottageServiceConfig,
  legacy?: CottageServiceConfig,
): CottageServiceConfig => {
  const src = raw ?? legacy ?? {};
  const caps = src.capabilities ?? [];
  const enabled = src.enabledCapabilities;
  return deepMerge(
    DEFAULT_COTTAGE_CONFIG.cottageService as unknown as Record<string, unknown>,
    {
      ...src,
      useLlm: src.useLlm ?? Boolean(enabled?.includes('llm')),
      useSearch: src.useSearch ?? Boolean(enabled?.includes('search')),
      useFetch: src.useFetch ?? Boolean(enabled?.includes('fetch')),
      capabilities: caps,
    } as Record<string, unknown>,
  ) as unknown as CottageServiceConfig;
};

/** 返回与默认值深合并后的完整配置（缺省字段用默认值填充） */
export const getCottageConfig = (): CottageConfig => ({
  ...cached,
  history: deepMerge(DEFAULT_COTTAGE_CONFIG.history as unknown as Record<string, unknown>, cached.history as unknown as Record<string, unknown> | undefined) as unknown as HistoryConfig,
  rag: deepMerge(DEFAULT_COTTAGE_CONFIG.rag as unknown as Record<string, unknown>, cached.rag as unknown as Record<string, unknown> | undefined) as unknown as RagConfig,
  mcp: deepMerge(DEFAULT_COTTAGE_CONFIG.mcp as unknown as Record<string, unknown>, cached.mcp as unknown as Record<string, unknown> | undefined) as unknown as McpConfig,
  vision: deepMerge(DEFAULT_COTTAGE_CONFIG.vision as unknown as Record<string, unknown>, cached.vision as unknown as Record<string, unknown> | undefined) as unknown as VisionConfig,
  imageGen: deepMerge(DEFAULT_COTTAGE_CONFIG.imageGen as unknown as Record<string, unknown>, cached.imageGen as unknown as Record<string, unknown> | undefined) as unknown as ImageGenConfig,
  python: deepMerge(DEFAULT_COTTAGE_CONFIG.python as unknown as Record<string, unknown>, cached.python as unknown as Record<string, unknown> | undefined) as unknown as PythonConfig,
  skills: deepMerge(DEFAULT_COTTAGE_CONFIG.skills as unknown as Record<string, unknown>, cached.skills as unknown as Record<string, unknown> | undefined) as unknown as SkillsConfig,
  codingIndex: deepMerge(DEFAULT_COTTAGE_CONFIG.codingIndex as unknown as Record<string, unknown>, cached.codingIndex as unknown as Record<string, unknown> | undefined) as unknown as CodingIndexConfig,
  office: deepMerge(DEFAULT_COTTAGE_CONFIG.office as unknown as Record<string, unknown>, cached.office as unknown as Record<string, unknown> | undefined) as unknown as { template?: OfficeTemplateConfig },
  platform: deepMerge(DEFAULT_COTTAGE_CONFIG.platform as unknown as Record<string, unknown>, cached.platform as unknown as Record<string, unknown> | undefined) as unknown as PlatformConfig,
  content: deepMerge(DEFAULT_COTTAGE_CONFIG.content as unknown as Record<string, unknown>, cached.content as unknown as Record<string, unknown> | undefined) as unknown as ContentConfig,
  packs: deepMerge(DEFAULT_COTTAGE_CONFIG.packs as unknown as Record<string, unknown>, cached.packs as unknown as Record<string, unknown> | undefined) as unknown as CapabilityPacksConfig,
  cottageService: migrateCottageServiceConfig(
    cached.cottageService,
    cached.localAgent,
  ),
});

/** 返回未深合并的原始缓存值 */
export const getCottageConfigRaw = (): CottageConfig => cached;

export const configRevision = ref(0);

/**
 * 当前页面会话内临时选中的模型。
 * 仅影响本页 Agent / 输入框选择，不写入设置里的默认模型（domain.activePresetId）。
 */
let sessionActivePresetId: string | undefined;
let sessionActiveImagePresetId: string | undefined;

export const getSessionActivePresetId = (): string | undefined =>
  sessionActivePresetId;

export const clearSessionActivePresetId = (): void => {
  if (sessionActivePresetId === undefined) return;
  sessionActivePresetId = undefined;
  configRevision.value += 1;
};

export const getSessionActiveImagePresetId = (): string | undefined =>
  sessionActiveImagePresetId;

export const clearSessionActiveImagePresetId = (): void => {
  if (sessionActiveImagePresetId === undefined) return;
  sessionActiveImagePresetId = undefined;
  configRevision.value += 1;
};

/** 设置当前页面会话的生图模型，不改设置页的默认生图模型。 */
export const setSessionActiveImagePresetId = (presetId: string | undefined): void => {
  const presets = cached.imageGen?.modelPresets ?? [];
  const next = presetId && presets.some((preset) => preset.id === presetId)
    ? presetId
    : undefined;
  if (next === sessionActiveImagePresetId) return;
  sessionActiveImagePresetId = next;
  configRevision.value += 1;
};

/** 设置页面会话内临时模型（不改设置中的默认） */
export const setSessionActivePresetId = (presetId: string | undefined): void => {
  const presets = cached.modelPresets ?? [];
  const next =
    presetId && presets.some((p) => p.id === presetId) ? presetId : undefined;
  if (next === sessionActivePresetId) return;
  sessionActivePresetId = next;
  configRevision.value += 1;
};

export const setCottageConfig = (config: CottageConfig): void => {
  const normalizedModelSettings = normalizeModelSettings(config);
  cached = {
    ...config,
    llm: normalizedModelSettings.llm,
    modelPresets: normalizedModelSettings.modelPresets,
    activePresetId: normalizedModelSettings.activePresetId,
    enabledTools: normalizeEnabledTools(config.enabledTools),
  };
  // 会话内临时选择的模型若不在新列表中则丢弃（如切换工作区）
  if (
    sessionActivePresetId &&
    !normalizedModelSettings.modelPresets.some((p) => p.id === sessionActivePresetId)
  ) {
    sessionActivePresetId = undefined;
  }
  if (
    sessionActiveImagePresetId &&
    !cached.imageGen?.modelPresets?.some((preset) => preset.id === sessionActiveImagePresetId)
  ) {
    sessionActiveImagePresetId = undefined;
  }
  configRevision.value += 1;
};

export const getLlmConfig = (): LlmModelConfig | null => {
  const config = getCottageConfig();
  const activePreset = getActiveModelPreset(config);
  if (activePreset) {
    return normalizeLlmConfig(activePreset.config);
  }
  if (hasConfiguredLlm(config.llm)) {
    return normalizeLlmConfig(config.llm!);
  }
  return resolveLlmFromCachedLayers();
};

export const isLlmConfigured = (): boolean => getLlmConfig() !== null;

export const mergeCottageConfig = (patch: CottageConfig): CottageConfig => {
  const mergedLlm =
    patch.llm !== undefined
      ? patch.llm && hasConfiguredLlm(patch.llm)
        ? normalizeLlmConfig(patch.llm)
        : undefined
      : cached.llm;
  const next: CottageConfig = {
    ...cached,
    ...patch,
    llm: mergedLlm,
    webSearch: { ...cached.webSearch, ...patch.webSearch },
    enabledTools: patch.enabledTools ?? cached.enabledTools,
    modelPresets: patch.modelPresets ?? cached.modelPresets,
    activePresetId: patch.activePresetId ?? cached.activePresetId,
    // 新增功能模块深合并
    history: patch.history !== undefined
      ? deepMerge((cached.history ?? {}) as Record<string, unknown>, patch.history as Record<string, unknown>) as unknown as HistoryConfig
      : cached.history,
    rag: patch.rag !== undefined
      ? deepMerge((cached.rag ?? {}) as Record<string, unknown>, patch.rag as Record<string, unknown>) as unknown as RagConfig
      : cached.rag,
    mcp: patch.mcp !== undefined
      ? deepMerge((cached.mcp ?? {}) as Record<string, unknown>, patch.mcp as Record<string, unknown>) as unknown as McpConfig
      : cached.mcp,
    vision: patch.vision !== undefined
      ? deepMerge((cached.vision ?? {}) as Record<string, unknown>, patch.vision as Record<string, unknown>) as unknown as VisionConfig
      : cached.vision,
    imageGen: patch.imageGen !== undefined
      ? deepMerge((cached.imageGen ?? {}) as Record<string, unknown>, patch.imageGen as Record<string, unknown>) as unknown as ImageGenConfig
      : cached.imageGen,
    python: patch.python !== undefined
      ? deepMerge((cached.python ?? {}) as Record<string, unknown>, patch.python as Record<string, unknown>) as unknown as PythonConfig
      : cached.python,
    skills: patch.skills !== undefined
      ? deepMerge((cached.skills ?? {}) as Record<string, unknown>, patch.skills as Record<string, unknown>) as unknown as SkillsConfig
      : cached.skills,
    codingIndex: patch.codingIndex !== undefined
      ? deepMerge((cached.codingIndex ?? {}) as Record<string, unknown>, patch.codingIndex as Record<string, unknown>) as unknown as CodingIndexConfig
      : cached.codingIndex,
    office: patch.office !== undefined
      ? deepMerge((cached.office ?? {}) as Record<string, unknown>, patch.office as Record<string, unknown>) as unknown as { template?: OfficeTemplateConfig }
      : cached.office,
    platform: patch.platform !== undefined
      ? deepMerge((cached.platform ?? {}) as Record<string, unknown>, patch.platform as Record<string, unknown>) as unknown as PlatformConfig
      : cached.platform,
    content: patch.content !== undefined
      ? deepMerge((cached.content ?? {}) as Record<string, unknown>, patch.content as Record<string, unknown>) as unknown as ContentConfig
      : cached.content,
    packs: patch.packs !== undefined
      ? deepMerge((cached.packs ?? {}) as Record<string, unknown>, patch.packs as Record<string, unknown>) as unknown as CapabilityPacksConfig
      : cached.packs,
    cottageService: patch.cottageService !== undefined || patch.localAgent !== undefined
      ? migrateCottageServiceConfig(
          deepMerge(
            (cached.cottageService ?? cached.localAgent ?? {}) as Record<string, unknown>,
            (patch.cottageService ?? patch.localAgent ?? {}) as Record<string, unknown>,
          ) as unknown as CottageServiceConfig,
        )
      : migrateCottageServiceConfig(cached.cottageService, cached.localAgent),
    localAgent: undefined,
  };
  setCottageConfig(next);
  return next;
};

export const generatePresetId = (): string =>
  `preset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export const getActiveModelPreset = (
  config?: CottageConfig,
): ModelPreset | undefined => {
  const c = config ?? getCottageConfig();
  if (c.modelPresets?.length) {
    if (sessionActivePresetId) {
      const session = c.modelPresets.find((preset) => preset.id === sessionActivePresetId);
      if (session) return session;
    }
    if (c.activePresetId) {
      const active = c.modelPresets.find((preset) => preset.id === c.activePresetId);
      if (active) return active;
    }
    return c.modelPresets[0];
  }
  return resolveActivePresetFromCachedLayers();
};

/** @deprecated 请用 setSessionActivePresetId；保留别名避免外部旧调用 */
export const setActiveModelPreset = (presetId: string | undefined): void => {
  setSessionActivePresetId(presetId);
};

export const getModelPresets = (config: CottageConfig): ModelPreset[] =>
  config.modelPresets ?? [];

/** @deprecated 使用 getModelPresets；不再自动合成默认模型 */
export const ensureDefaultPresets = getModelPresets;
