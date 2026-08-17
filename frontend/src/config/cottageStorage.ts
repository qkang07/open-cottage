/**
 * 分层配置存储管理。
 * 支持 folder/domain/server 三层配置合并，优先级：folder > domain > server。
 */

import { workspace } from '../workspace/FileSystemWorkspace';
import { COTTAGE_CONFIG_FILE } from './constants';
import { getCottageConfig, setCachedConfigLayers, setCottageConfig } from './store';
import type { LlmModelConfig, ModelTemplate } from './constants';
import { loadDomainCottageConfig, saveDomainCottageConfig } from './domainConfig';
import type {
  ConfigLayer,
  CottageConfig,
  LayeredCottageConfigSchema,
} from './constants';

/** 深合并两个对象（patch 优先，undefined 不覆盖） */
const mergeObjects = <T extends Record<string, unknown>>(
  base: T,
  patch: Partial<T> | undefined,
): T => {
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
      result[key] = mergeObjects(
        baseVal as Record<string, unknown>,
        patchVal as Record<string, unknown>,
      );
    } else {
      result[key] = patchVal;
    }
  }
  return result as T;
};

/** 检查 LLM 字段是否已配置（provider + model 非空） */
const llmFieldConfigured = (llm?: LlmModelConfig): boolean =>
  Boolean(llm?.provider && llm?.model?.trim());

/** 合并配置层而不清空预设列表（避免覆盖用户配置） */
const mergeLayerWithoutWipingPresets = (
  base: CottageConfig | null | undefined,
  overlay: CottageConfig | null | undefined,
): CottageConfig => {
  if (!overlay) return (base ?? {}) as CottageConfig;
  if (!base) return overlay;
  const merged = mergeObjects(
    base as Record<string, unknown>,
    overlay as Record<string, unknown>,
  ) as CottageConfig;
  const overlayPresets = overlay.modelPresets;
  const basePresets = base.modelPresets;
  const overlayHasPresets = (overlayPresets?.length ?? 0) > 0;
  const baseHasPresets = (basePresets?.length ?? 0) > 0;
  // 默认模型选择已收敛到 domain：folder 无预设时不得用残留的
  // activePresetId / llm 盖住下层（迁移后常见）
  if (!overlayHasPresets && baseHasPresets) {
    merged.modelPresets = basePresets;
    merged.activePresetId = base.activePresetId;
    if (llmFieldConfigured(base.llm)) {
      merged.llm = base.llm;
    } else {
      delete merged.llm;
    }
  }

  // 工作区模板独立合并，避免被 modelPresets 的空列表覆盖
  const overlayTemplates = overlay.modelTemplates;
  const baseTemplates = base.modelTemplates;
  if (
    overlayTemplates !== undefined &&
    overlayTemplates.length === 0 &&
    (baseTemplates?.length ?? 0) > 0
  ) {
    merged.modelTemplates = baseTemplates;
  }

  return merged;
};

/** 合并所有配置层（server -> domain -> folder） */
const mergeLayeredConfig = (
  layers: LayeredCottageConfigSchema['layers'],
): CottageConfig => {
  const mergedServer = mergeLayerWithoutWipingPresets(null, layers.server);
  const mergedDomain = mergeLayerWithoutWipingPresets(mergedServer, layers.domain);
  const merged = mergeLayerWithoutWipingPresets(mergedDomain, layers.folder);
  // 版本历史是工作区磁盘能力，只接受 folder 层配置；旧 domain 配置不得隐式启用。
  if (layers.folder?.history !== undefined) merged.history = layers.folder.history;
  else delete merged.history;
  return merged;
};

/** 将旧版 folder 层 modelPresets 迁移为 modelTemplates（去掉 apiKey） */
const migrateFolderModelPresetsToTemplates = (
  config: CottageConfig,
): CottageConfig => {
  const presets = config.modelPresets;
  if (!presets || presets.length === 0) return config;
  const existingTemplates = config.modelTemplates ?? [];
  const existingIds = new Set(existingTemplates.map((t) => t.id));
  const migrated: ModelTemplate[] = presets
    .filter((preset) => !existingIds.has(preset.id))
    .map((preset) => {
      const { apiKey: _, ...restConfig } = preset.config;
      return { ...preset, config: restConfig };
    });
  const next: CottageConfig = { ...config };
  delete next.modelPresets;
  next.modelTemplates = [...existingTemplates, ...migrated];
  return next;
};

/**
 * folder 层只保留本地模板；默认模型选择（presets / activePresetId / llm）归属 domain。
 * 去掉迁移后残留字段，避免 folder 覆盖 domain 的模型切换。
 */
const stripFolderModelOwnership = (config: CottageConfig): CottageConfig => {
  if (
    config.modelPresets === undefined &&
    config.activePresetId === undefined &&
    config.llm === undefined
  ) {
    return config;
  }
  const next: CottageConfig = { ...config };
  delete next.modelPresets;
  delete next.activePresetId;
  delete next.llm;
  return next;
};

const normalizeFolderConfig = (config: CottageConfig): CottageConfig =>
  stripFolderModelOwnership(migrateFolderModelPresetsToTemplates(config));

/** 从工作区加载配置 */
const loadFolderConfig = async (): Promise<CottageConfig | null> => {
  if (!workspace.isOpen) return null;
  const config = await workspace.readCottageJson<CottageConfig>(COTTAGE_CONFIG_FILE);
  if (!config) return null;
  const normalized = normalizeFolderConfig(config);
  if (normalized !== config && workspace.isOpen) {
    await workspace.writeCottageJson(COTTAGE_CONFIG_FILE, normalized);
  }
  return normalized;
};

/** 保存配置到工作区 */
const saveFolderConfig = async (config: CottageConfig): Promise<void> => {
  if (!workspace.isOpen) {
    throw new Error('当前未打开工作空间，无法保存到 folder 层级');
  }
  await workspace.writeCottageJson(
    COTTAGE_CONFIG_FILE,
    normalizeFolderConfig(config),
  );
};

/** 保存分层配置的选项 */
export interface SaveLayeredConfigOptions {
  level?: ConfigLayer;
}

/** 加载分层配置（默认同步到 store） */
export const loadLayeredCottageConfig = async (): Promise<LayeredCottageConfigSchema & {
  merged: CottageConfig;
}> => {
  return loadLayeredCottageConfigWithOptions();
};

/** 加载分层配置（可选是否同步到 store） */
export const loadLayeredCottageConfigWithOptions = async (options?: {
  syncStore?: boolean;
}): Promise<LayeredCottageConfigSchema & {
  merged: CottageConfig;
}> => {
  const [folder, domain] = await Promise.all([
    loadFolderConfig(),
    loadDomainCottageConfig(),
  ]);
  const layers: LayeredCottageConfigSchema['layers'] = {
    folder,
    domain,
    server: null,
  };
  setCachedConfigLayers({ folder, domain });
  const merged = mergeLayeredConfig(layers);
  if (options?.syncStore !== false) {
    setCottageConfig(merged);
  }
  return {
    schema: 'cottage-config-layered-v1',
    version: 1,
    layers,
    merged: options?.syncStore !== false ? getCottageConfig() : merged,
  };
};

/** 从工作空间加载配置并返回合并后的结果 */
export const loadCottageConfigFromWorkspace = async (): Promise<CottageConfig> => {
  const snapshot = await loadLayeredCottageConfig();
  return snapshot.merged;
};

/** 保存配置补丁到工作空间 folder 层 */
export const saveCottageConfigToWorkspace = async (
  patch: CottageConfig,
): Promise<CottageConfig> => {
  const snapshot = await saveLayeredCottageConfig(patch, { level: 'folder' });
  return snapshot.merged;
};

/** 保存配置补丁到指定层级 */
export const saveLayeredCottageConfig = async (
  patch: CottageConfig,
  options?: SaveLayeredConfigOptions,
): Promise<LayeredCottageConfigSchema & { merged: CottageConfig }> => {
  const level = options?.level ?? 'folder';
  const current = await loadLayeredCottageConfig();
  if (level === 'folder') {
    const nextFolder = mergeObjects(
      (current.layers.folder ?? {}) as Record<string, unknown>,
      patch as Record<string, unknown>,
    ) as CottageConfig;
    // v2 history 配置是一个全量最小 schema；覆盖旧对象，避免保留废弃字段。
    if (patch.history !== undefined) nextFolder.history = patch.history;
    await saveFolderConfig(nextFolder);
  } else if (level === 'domain') {
    const nextDomain = mergeObjects(
      (current.layers.domain ?? {}) as Record<string, unknown>,
      patch as Record<string, unknown>,
    ) as CottageConfig;
    await saveDomainCottageConfig(nextDomain);
  } else {
    throw new Error('server 层级暂未实现');
  }
  return loadLayeredCottageConfig();
};

/** 设置指定层级的活跃预设 */
export const setActivePresetForLayer = async (
  layer: Exclude<ConfigLayer, 'server'>,
  presetId: string,
): Promise<LayeredCottageConfigSchema & { merged: CottageConfig }> => {
  const snapshot = await loadLayeredCottageConfig();
  const layerConfig = snapshot.layers[layer];
  const modelPresets = layerConfig?.modelPresets ?? [];
  if (!modelPresets.some((p) => p.id === presetId)) {
    throw new Error('目标层级不存在该模型设置');
  }
  const activePreset = modelPresets.find((p) => p.id === presetId);
  return saveLayeredCottageConfig(
    {
      activePresetId: presetId,
      llm: activePreset?.config,
    },
    { level: layer },
  );
};

/**
 * 设置「新页面默认模型」（写入 domain.activePresetId）。
 *
 * 输入框右下角临时切换请用 setSessionActivePresetId，不要调用本方法。
 * 模型预设已统一收敛到 domain 层，folder 层仅保存无 key 的本地模板。
 */
export const setEffectiveActivePresetForLayer = async (
  layer: Exclude<ConfigLayer, 'server'>,
  presetId: string,
): Promise<LayeredCottageConfigSchema & { merged: CottageConfig }> => {
  if (layer !== 'domain') {
    throw new Error('默认模型只能在域名层设置');
  }
  return setActivePresetForLayer(layer, presetId);
};
