<script setup lang="ts">
import {
  Add,
  CreateOutline,
  CopyOutline,
  EllipsisHorizontalOutline,
  HardwareChipOutline,
  InformationCircleOutline,
  KeyOutline,
  SaveOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import {
  ElButton,
  ElCard,
  ElCascader,
  ElCollapse,
  ElCollapseItem,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElDialog,
  ElTag,
  ElMessage,
  type FormInstance as FormInst,
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import CottageSelect from '@/ui/CottageSelect.vue';
import { NIcon, NSpace, NText } from '@/ui/element-plus-primitives';
import type { SelectOption } from '@/ui/element-plus-types';
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ImageGenConfig, LlmModelConfig, ModelPreset, ModelTemplate } from '../../config/constants';
import {
  CHINA_PROVIDERS,
  INTERNATIONAL_PROVIDERS,
  LLM_PROVIDER_DEFINITIONS,
  getProviderDefinition,
  isAggregatorProvider,
  type LlmModelOption,
  type LlmProviderId,
  normalizeProviderId,
  parseModelVendor,
  providerLabel,
  resolveModelForProvider,
} from '../../config/llmProviders';
import { generatePresetId } from '../../config/store';
import { saveLayeredCottageConfig } from '../../config/cottageStorage';
import {
  defaultImageGenModel,
  findImageGenModelEntry,
  imageGenModelsForProvider,
  IMAGE_GEN_PROVIDER_IDS,
  loadOpenRouterImageModels,
  normalizeImageSizeLabel,
} from '../../imagegen/catalog';
import { workspace } from '../../workspace/FileSystemWorkspace';
import {
  fetchProviderModels,
  formatTokenLimit,
  getCachedProviderModels,
  pickDefaultReasoningEffort,
  resolveConfigTemperature,
  type ModelCatalogResult,
} from '../../config/modelCatalog';
import { resolveCottageModelCapabilities } from '../../config/modelCapabilities';
import {
  getSecretForProvider,
  getProviderConnections,
  loadProviderSecrets,
  saveProviderSecrets,
  type ProviderSecretEntry,
  type ProviderSecrets,
} from '../../config/secrets';
import CottageServiceLlmFields from './CottageServiceLlmFields.vue';
import {
  presetHasApiKey,
  presetHasProviderConnection,
} from '../../config/llmKeyStatus';

const props = defineProps<{
  domainPresets: ModelPreset[];
  modelTemplates: ModelTemplate[];
  /** 兼容旧设置抽屉；默认模型选择不再由此组件提供。 */
  defaultSelection?: { presetId: string };
  secrets?: ProviderSecrets;
  /** 合并后的生图配置（用于初始化/回写厂商生图设置） */
  imageGenConfig?: ImageGenConfig;
  /** 生图模型已迁往独立管理页；仅为兼容旧入口保留。 */
  showImageGenOptions?: boolean;
  /** 凭据已迁往服务商页时隐藏模型级 API Key（保留旧预设兼容）。 */
  manageCredentials?: boolean;
}>();

const emit = defineEmits<{
  changeDomain: [presets: ModelPreset[]];
  /** 兼容旧设置抽屉；默认模型改由宿主自动选择。 */
  setDefault: [presetId: string];
  saveTemplate: [template: ModelTemplate];
  openProviders: [];
}>();

const DEFAULT_TEMPERATURE = 1;

const formModel = ref({
  name: '',
  provider: '' as LlmProviderId,
  connectionId: '',
  model: '',
  temperature: DEFAULT_TEMPERATURE as number | null,
  maxTokens: null as number | null,
  reasoningEffort: null as string | null,
  baseUrl: '',
  apiKey: '',
  /** 生图厂商覆盖（'' = 跟随当前预设厂商） */
  imageGenProvider: '',
  /** 生图厂商的生图模型覆盖（'' = 用清单默认） */
  imageGenModel: '',
  /** 生图默认尺寸 */
  imageGenSize: '1024x1024',
  /** 独立生图厂商的全局 API Key */
  imageGenApiKey: '',
});
const nameManuallyEdited = ref(false);
const skipNameManual = ref(false);
const modelCatalogResult = ref<ModelCatalogResult | null>(null);
const loadingModels = ref(false);
const modelFetchError = ref<string | null>(null);
const advancedSettingsOpen = ref<string[]>([]);
const imageGenCatalogRevision = ref(0);
const isModalOpen = ref(false);
/** 聚合器：手动输入模型 ID（目录外自定义） */
const modelManualEntry = ref(false);
const VENDOR_OTHER_KEY = '__other__';

type CascaderOption = {
  value: string;
  label: string;
  children?: CascaderOption[];
};

const { t } = useI18n();
const message = ElMessage;

const selectedModelMeta = computed(() => {
  const models =
    modelCatalogResult.value?.models ??
    getCachedProviderModels(formModel.value.provider, true) ??
    [];
  return models.find((m) => m.id === formModel.value.model);
});
const selectedModelCapabilities = computed(() =>
  resolveCottageModelCapabilities(
    { provider: formModel.value.provider, model: formModel.value.model },
    selectedModelMeta.value,
  ),
);
const isTemperatureUnsupported = computed(
  () => selectedModelCapabilities.value.temperature === false,
);
const reasoningEffortValues = computed(
  () => selectedModelCapabilities.value.reasoningEffortValues,
);
const supportsReasoningEffort = computed(
  () => reasoningEffortValues.value.length > 0,
);
const reasoningEffortOptions = computed<SelectOption[]>(() =>
  reasoningEffortValues.value
    .filter((value) => value !== 'none')
    .map((value) => ({
      value,
      label: t(`settings.reasoningEffortLevel.${value}`),
    })),
);
const hasModelCapabilityInfo = computed(() => {
  const meta = selectedModelMeta.value;
  if (!meta || !formModel.value.model) return false;
  return (
    meta.temperature !== undefined ||
    meta.reasoning !== undefined ||
    meta.vision !== undefined ||
    meta.tools !== undefined ||
    Boolean(meta.reasoningEffortValues?.length) ||
    Boolean(meta.contextLimit) ||
    Boolean(meta.outputLimit)
  );
});
const dialogProviderId = computed(() =>
  normalizeProviderId(formModel.value.provider),
);
const dialogImageGenModels = computed(() => {
  void imageGenCatalogRevision.value;
  return imageGenModelsForProvider(dialogProviderId.value);
});
/** 预设厂商是否有内置生图模型（能力标签展示用） */
const dialogSupportsImageGen = computed(
  () => dialogImageGenModels.value.length > 0,
);
/** 实际生效的生图厂商（独立覆盖优先，否则跟随预设厂商） */
const dialogEffectiveImageGenProvider = computed(() => {
  const override = formModel.value.imageGenProvider.trim();
  return override ? normalizeProviderId(override) : dialogProviderId.value;
});
const dialogEffectiveImageGenModels = computed(() => {
  void imageGenCatalogRevision.value;
  return imageGenModelsForProvider(dialogEffectiveImageGenProvider.value);
});
const dialogImageGenSelectedModelId = computed(() => {
  const override = formModel.value.imageGenModel.trim();
  if (override) return override;
  return defaultImageGenModel(dialogEffectiveImageGenProvider.value)?.id ?? '';
});
const dialogImageGenModelOptions = computed(() => {
  const options = dialogEffectiveImageGenModels.value.map((m) => ({
    value: m.id,
    label: m.label,
  }));
  const saved = formModel.value.imageGenModel.trim();
  if (saved && !options.some((o) => o.value === saved)) {
    options.push({ value: saved, label: saved });
  }
  return options;
});
const dialogImageGenProviderOptions = computed(() => [
  { value: '', label: t('settings.imageGenFollowChat') },
  ...IMAGE_GEN_PROVIDER_IDS.map((id) => ({
    value: id,
    label: providerLabel(id),
  })),
]);

async function refreshOpenRouterImageCatalog() {
  try {
    await loadOpenRouterImageModels();
    imageGenCatalogRevision.value += 1;
  } catch {
    // 保留内置后备清单；模型目录失败不应阻断预设编辑。
  }
}

watch(
  () => [isModalOpen.value, dialogEffectiveImageGenProvider.value] as const,
  ([open, provider]) => {
    if (open && provider === 'openrouter') {
      void refreshOpenRouterImageCatalog();
    }
  },
);
const modelCatalogHint = computed(() => {
  const result = modelCatalogResult.value;
  if (!result || loadingModels.value || modelFetchError.value) return '';
  const source =
    result.source === 'provider_api'
      ? t('settings.modelListSourceProvider')
      : t('settings.modelListSourceCatalog');
  if (result.source === 'provider_api') {
    return t('settings.modelListLoadedFromService', {
      source,
      count: result.models.length,
    });
  }
  return t('settings.modelListLoadedFromCatalog', {
    source,
    count: result.models.length,
  });
});
const dialogImageGenSizeOptions = computed(() => {
  const entry = findImageGenModelEntry(
    dialogEffectiveImageGenProvider.value,
    dialogImageGenSelectedModelId.value,
  );
  const options = (entry?.sizes ?? []).map((s) => {
    const label = normalizeImageSizeLabel(s);
    return { value: label, label };
  });
  const current = normalizeImageSizeLabel(
    formModel.value.imageGenSize || '1024x1024',
  );
  if (current && !options.some((o) => o.value === current)) {
    options.unshift({ value: current, label: current });
  }
  if (!options.length) {
    options.push(
      { value: '1024x1024', label: '1024x1024' },
      { value: '1536x1024', label: '1536x1024' },
      { value: '1024x1536', label: '1024x1536' },
    );
  }
  return options;
});
/** 表单生图字段初值（取自已保存的全局生图配置；厂商覆盖与模型覆盖按厂商归属读取） */
const imageGenFormDefaults = (providerId: LlmProviderId) => {
  const overrideProvider =
    props.imageGenConfig?.providerOverride?.trim() || '';
  const effectiveProvider = overrideProvider
    ? normalizeProviderId(overrideProvider)
    : providerId;
  return {
    imageGenProvider: overrideProvider,
    imageGenModel:
      props.imageGenConfig?.modelOverrides?.[effectiveProvider]?.trim() || '',
    imageGenSize: normalizeImageSizeLabel(
      props.imageGenConfig?.defaultSize?.trim() || '1024x1024',
    ),
    imageGenApiKey: props.secrets?.[effectiveProvider]?.apiKey ?? '',
  };
};
/** 预设厂商是否有内置生图模型（卡片展示生图标签） */
function presetSupportsImageGen(preset: ModelPreset): boolean {
  return (
    imageGenModelsForProvider(normalizeProviderId(preset.config.provider))
      .length > 0
  );
}
const syncDefaultNameFromModel = () => {
  const model = formModel.value.model.trim();
  if (!nameManuallyEdited.value && model) {
    skipNameManual.value = true;
    formModel.value.name = model;
    void nextTick(() => {
      skipNameManual.value = false;
    });
  }
};
const resetNameManualFlag = (name: string, model: string) => {
  const trimmedName = name.trim();
  const trimmedModel = model.trim();
  nameManuallyEdited.value = Boolean(
    trimmedName && trimmedName !== trimmedModel,
  );
};
const onNameInput = () => {
  if (!skipNameManual.value) {
    nameManuallyEdited.value = true;
  }
};
const applyTemperatureForSelectedModel = () => {
  if (isTemperatureUnsupported.value) {
    formModel.value.temperature = null;
  }
};
const applyReasoningEffortForSelectedModel = () => {
  if (!supportsReasoningEffort.value) {
    formModel.value.reasoningEffort = null;
    return;
  }
  const current = formModel.value.reasoningEffort;
  if (current && reasoningEffortValues.value.includes(current)) return;
  formModel.value.reasoningEffort =
    pickDefaultReasoningEffort(reasoningEffortValues.value) ?? null;
};
watch(
  isTemperatureUnsupported,
  (unsupported, prevUnsupported) => {
    if (unsupported) {
      formModel.value.temperature = null;
    } else if (prevUnsupported) {
      formModel.value.temperature = DEFAULT_TEMPERATURE;
    }
  },
  { immediate: true },
);
watch(
  () => formModel.value.model,
  () => {
    syncDefaultNameFromModel();
    applyTemperatureForSelectedModel();
    applyReasoningEffortForSelectedModel();
  },
);
watch(selectedModelMeta, () => {
  applyTemperatureForSelectedModel();
  applyReasoningEffortForSelectedModel();
});
/** 切换生图厂商时，模型覆盖同步换成该厂商已保存的值 */
watch(
  () => formModel.value.imageGenProvider,
  (value) => {
    const provider = value.trim()
      ? normalizeProviderId(value)
      : dialogProviderId.value;
    formModel.value.imageGenModel =
      props.imageGenConfig?.modelOverrides?.[provider]?.trim() || '';
    formModel.value.imageGenApiKey = props.secrets?.[provider]?.apiKey ?? '';
  },
);

const formRef = ref<FormInst | null>(null);
const editingPreset = ref<ModelPreset | null>(null);


const LLM_SELECT_OPTIONS = computed<SelectOption[]>(() => [
  {
    type: 'group',
    label: t('settings.regionIntl'),
    key: 'intl',
    children: INTERNATIONAL_PROVIDERS.map((d) => ({
      value: d.id,
      label: d.label,
    })),
  },
  {
    type: 'group',
    label: t('settings.regionChina'),
    key: 'cn',
    children: CHINA_PROVIDERS.map((d) => ({
      value: d.id,
      label: d.label,
    })),
  },
]);

const configuredProviderOptions = computed(() =>
  LLM_PROVIDER_DEFINITIONS.flatMap((provider) =>
    getProviderConnections(props.secrets ?? {}, provider.id).map((connection) => ({
      value: `${provider.id}::${connection.id ?? ''}`,
      label: `${provider.label} · ${connection.alias || t('settings.defaultBadge')}`,
    })),
  ),
);

const selectedProviderConnection = computed(() =>
  formModel.value.provider && formModel.value.connectionId && !formProviderConnectionMissing.value
    ? `${normalizeProviderId(formModel.value.provider)}::${formModel.value.connectionId}`
    : null,
);

const formProviderConnectionMissing = computed(() => {
  if (props.manageCredentials === true || !formModel.value.provider) return false;
  if (!formModel.value.connectionId) return true;
  const provider = normalizeProviderId(formModel.value.provider);
  return !getProviderConnections(props.secrets ?? {}, provider).some(
    (connection) => connection.id === formModel.value.connectionId,
  );
});

const modelOptions = computed(() => {
  const provider = formModel.value.provider;
  if (!provider) return [];
  const cached =
    modelCatalogResult.value?.models ?? getCachedProviderModels(provider, true);
  const opts = (cached ?? []).map((m) => ({
    value: m.id,
    label: m.label,
  }));
  const selectedModel = formModel.value.model.trim();
  // 重新绑定连接时保留原模型，即使新连接的目录中暂未返回它。
  if (selectedModel && !opts.some((option) => option.value === selectedModel)) {
    opts.unshift({ value: selectedModel, label: selectedModel });
  }
  const defModel = resolveModelForProvider(provider, undefined);
  if (!opts.some((o) => o.value === defModel)) {
    opts.unshift({ value: defModel, label: defModel });
  }
  return opts;
});


/** 当前提供商是否为聚合器（模型选择器用出品方 → 模型级联） */
const isAggregatorSelected = computed(() =>
  isAggregatorProvider(normalizeProviderId(formModel.value.provider)),
);

/** 当前提供商可用模型（优先本次拉取结果，其次缓存） */
const catalogModels = computed<LlmModelOption[]>(
  () =>
    modelCatalogResult.value?.models ??
    getCachedProviderModels(formModel.value.provider, true) ??
    [],
);

const vendorLabel = (vendor: string): string =>
  vendor === VENDOR_OTHER_KEY ? t('settings.vendorOther') : vendor;

const isModelInCatalog = computed(() => {
  const id = formModel.value.model.trim();
  if (!id) return false;
  return catalogModels.value.some((m) => m.id === id);
});

/** 出品方 → 模型 两级选项 */
const aggregatorCascaderOptions = computed<CascaderOption[]>(() => {
  const groups = new Map<string, LlmModelOption[]>();
  for (const m of catalogModels.value) {
    const v = m.vendor ?? VENDOR_OTHER_KEY;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v)!.push(m);
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([vendor, list]) => ({
      value: vendor,
      label: `${vendorLabel(vendor)} (${list.length})`,
      children: list.map((m) => ({ value: m.id, label: m.label })),
    }));
});

const modelCascaderValue = computed(() => {
  const id = formModel.value.model.trim();
  if (!id) return undefined;
  const meta = catalogModels.value.find((m) => m.id === id);
  if (!meta) return undefined;
  return [meta.vendor ?? VENDOR_OTHER_KEY, meta.id];
});

function onModelCascaderUpdate(v: unknown) {
  if (!Array.isArray(v) || v.length < 2) {
    formModel.value.model = '';
    return;
  }
  formModel.value.model = String(v[v.length - 1]);
}

function syncModelManualEntryMode() {
  if (!isAggregatorSelected.value) {
    modelManualEntry.value = false;
    return;
  }
  const id = formModel.value.model.trim();
  modelManualEntry.value = Boolean(id && !isModelInCatalog.value);
}

function toggleModelManualEntry() {
  if (modelManualEntry.value) {
    modelManualEntry.value = false;
    if (!isModelInCatalog.value) {
      formModel.value.model = '';
      nameManuallyEdited.value = false;
    }
    return;
  }
  modelManualEntry.value = true;
}

const totalCount = computed(() => props.domainPresets.length);

function cloneConfig(config: LlmModelConfig): LlmModelConfig {
  return { ...config };
}

/** 打开弹窗 / 切换提供商时批量改表单，避免触发凭证 watch 重复拉取 */
let suppressCredentialReload = false;
let credentialReloadTimer: ReturnType<typeof setTimeout> | null = null;
const CREDENTIAL_RELOAD_DEBOUNCE_MS = 400;

const isCustomOpenAiCompatible = computed(
  () => normalizeProviderId(formModel.value.provider) === 'openai_compatible',
);

const baseUrlFieldLabel = computed(() =>
  isCustomOpenAiCompatible.value
    ? t('settings.baseUrlRequired')
    : t('settings.baseUrlOptional'),
);

const baseUrlPlaceholder = computed(() => {
  const id = normalizeProviderId(formModel.value.provider);
  if (id === 'openai_compatible') return t('settings.baseUrlCustomPlaceholder');
  const def = getProviderDefinition(id);
  return def.defaultBaseUrl || 'https://your-endpoint/v1';
});

async function loadModelsForProvider(providerId: LlmProviderId) {
  modelFetchError.value = null;
  loadingModels.value = true;
  try {
    const secrets = await loadProviderSecrets();
    const globalSecret = getSecretForProvider(
      secrets,
      providerId,
      formModel.value.connectionId || undefined,
    );
    const editingPresetId = editingPreset.value?.id;
    const presetSecret: ProviderSecretEntry | undefined = editingPresetId
      ? secrets.presetApiKeys?.[editingPresetId]
      : undefined;
    const result = await fetchProviderModels({
      providerId,
      apiKey: formModel.value.apiKey || presetSecret?.apiKey || globalSecret?.apiKey,
      configBaseUrl: formModel.value.baseUrl,
      secretBaseUrl: presetSecret?.baseUrl || globalSecret?.baseUrl,
      force: true,
    });
    modelCatalogResult.value = result;
    applyTemperatureForSelectedModel();
    applyReasoningEffortForSelectedModel();
    syncModelManualEntryMode();
    if (result.error && result.models.length === 0) {
      modelFetchError.value = result.error;
    }
  } catch (error) {
    modelFetchError.value =
      error instanceof Error ? error.message : String(error);
  } finally {
    loadingModels.value = false;
  }
}

function clearCredentialReloadTimer() {
  if (credentialReloadTimer) {
    clearTimeout(credentialReloadTimer);
    credentialReloadTimer = null;
  }
}

function scheduleReloadModelsFromCredentials() {
  if (!isModalOpen.value || suppressCredentialReload || !formModel.value.provider) return;
  clearCredentialReloadTimer();
  credentialReloadTimer = setTimeout(() => {
    credentialReloadTimer = null;
    if (!isModalOpen.value || suppressCredentialReload) return;
    void loadModelsForProvider(normalizeProviderId(formModel.value.provider));
  }, CREDENTIAL_RELOAD_DEBOUNCE_MS);
}

async function withSuppressedCredentialReload(fn: () => void) {
  suppressCredentialReload = true;
  clearCredentialReloadTimer();
  try {
    fn();
  } finally {
    await nextTick();
    suppressCredentialReload = false;
  }
}

watch(
  () => [formModel.value.apiKey, formModel.value.baseUrl] as const,
  () => scheduleReloadModelsFromCredentials(),
);

watch(isModalOpen, (open) => {
  if (!open) clearCredentialReloadTimer();
});

function resetFormFromTemplate(templateId: string | null) {
  if (!templateId) {
    nameManuallyEdited.value = false;
    formModel.value = {
      name: '',
      provider: '' as LlmProviderId,
      connectionId: '',
      model: '',
      temperature: DEFAULT_TEMPERATURE,
      maxTokens: null,
      reasoningEffort: null,
      baseUrl: '',
      apiKey: '',
      ...imageGenFormDefaults('deepseek'),
    };
    return;
  }
  const template = props.modelTemplates.find((t) => t.id === templateId);
  if (!template) return;
  nameManuallyEdited.value = Boolean(
    template.name.trim() && template.name.trim() !== template.config.model.trim(),
  );
  formModel.value = {
    name: template.name.trim() || template.config.model,
    provider: template.config.provider,
    connectionId: template.config.connectionId ?? '',
    model: template.config.model,
    temperature: template.config.temperature ?? DEFAULT_TEMPERATURE,
    maxTokens: template.config.maxTokens ?? null,
    reasoningEffort: template.config.reasoningEffort ?? null,
    baseUrl: template.config.baseUrl ?? '',
    apiKey: '',
    ...imageGenFormDefaults(normalizeProviderId(template.config.provider)),
  };
}

function openAdd() {
  void withSuppressedCredentialReload(() => {
    editingPreset.value = null;
    modelManualEntry.value = false;
    nameManuallyEdited.value = false;
    formModel.value = {
      name: '',
      provider: '' as LlmProviderId,
      connectionId: '',
      model: '',
      temperature: DEFAULT_TEMPERATURE,
      maxTokens: null,
      reasoningEffort: null,
      baseUrl: '',
      apiKey: '',
      ...imageGenFormDefaults('deepseek'),
    };
    modelCatalogResult.value = null;
    advancedSettingsOpen.value = [];
    isModalOpen.value = true;
  });
}

function openEdit(preset: ModelPreset) {
  void withSuppressedCredentialReload(() => {
    editingPreset.value = preset;
    modelManualEntry.value = false;
    resetNameManualFlag(preset.name, preset.config.model);
    formModel.value = {
      name: preset.name.trim() || preset.config.model,
      provider: preset.config.provider,
      connectionId: preset.config.connectionId ?? '',
      model: preset.config.model,
      temperature: preset.config.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: preset.config.maxTokens ?? null,
      reasoningEffort: preset.config.reasoningEffort ?? null,
      baseUrl: preset.config.baseUrl ?? '',
      apiKey: preset.config.apiKey ?? '',
      ...imageGenFormDefaults(normalizeProviderId(preset.config.provider)),
    };
    modelCatalogResult.value = null;
    advancedSettingsOpen.value =
      preset.config.baseUrl ||
      preset.config.temperature !== undefined ||
      preset.config.maxTokens !== undefined ||
      preset.config.reasoningEffort
        ? ['advanced']
        : [];
    isModalOpen.value = true;
  }).then(() => loadModelsForProvider(preset.config.provider));
}

function handleDelete(preset: ModelPreset) {
  const next = props.domainPresets.filter((p) => p.id !== preset.id);
  emit('changeDomain', next);
  message.success(t('settings.deletedPreset'));
}

function handleCardCommand(preset: ModelPreset, command: string | number | object) {
  const cmd = String(command);
  if (cmd === 'edit') openEdit(preset);
  else if (cmd === 'copy') handleCopy(preset);
  else if (cmd === 'saveTemplate') handleSaveAsTemplate(preset);
  else if (cmd === 'delete') handleDelete(preset);
}

function presetNeedsKey(preset: ModelPreset): boolean {
  return !presetHasApiKey(preset, props.secrets ?? {});
}

function presetConnectionMissing(preset: ModelPreset): boolean {
  // 旧预设未记录连接 ID 时曾隐式回退到服务商的任意连接；
  // 现在要求显式绑定，避免连接删除或切换后静默使用错误的凭据。
  return !preset.config.connectionId?.trim() ||
    !presetHasProviderConnection(preset, props.secrets ?? {});
}

/** 聚合器预设卡片展示的出品方（非聚合器返回 null） */
function presetVendorLabel(preset: ModelPreset): string | null {
  if (!isAggregatorProvider(normalizeProviderId(preset.config.provider))) {
    return null;
  }
  return parseModelVendor(preset.config.model) ?? null;
}

function handleCopy(preset: ModelPreset) {
  const newPreset: ModelPreset = {
    id: generatePresetId(),
    name: '',
    config: cloneConfig(preset.config),
  };
  emit('changeDomain', [...props.domainPresets, newPreset]);
  message.success(t('settings.copied'));
}

function handleSaveAsTemplate(preset: ModelPreset) {
  const { apiKey: _, ...templateConfig } = preset.config;
  const template: ModelTemplate = {
    id: generatePresetId(),
    name: preset.name.trim() || preset.config.model,
    config: templateConfig,
  };
  emit('saveTemplate', template);
  message.success(t('settings.templateSaved'));
}


function onProviderChange(
  provider: LlmProviderId,
  connectionId?: string,
  preserveModel = false,
) {
  const id = normalizeProviderId(provider);
  void withSuppressedCredentialReload(() => {
    formModel.value.provider = id;
    formModel.value.connectionId = connectionId ?? getProviderConnections(props.secrets ?? {}, id)[0]?.id ?? '';
    if (!preserveModel) {
      formModel.value.model = resolveModelForProvider(id, undefined);
      nameManuallyEdited.value = false;
      modelManualEntry.value = false;
    }
    modelCatalogResult.value = null;
    advancedSettingsOpen.value = id === 'openai_compatible' ? ['advanced'] : [];
    Object.assign(formModel.value, imageGenFormDefaults(id));
  }).then(async () => {
    formRef.value?.clearValidate('provider');
    await loadModelsForProvider(id);
  });
}

function onProviderConnectionChange(value: string | number | null | undefined) {
  const [providerId, connectionId = ''] = String(value ?? '').split('::');
  if (!providerId) return;
  // 仅重新绑定凭据，不应擅自替换用户原先选定的模型。
  onProviderChange(normalizeProviderId(providerId), connectionId, true);
}

function handleProviderSelection(value: string | number | null | undefined) {
  if (props.manageCredentials !== true) {
    onProviderConnectionChange(value);
    return;
  }
  if (value) onProviderChange(normalizeProviderId(String(value)));
}

function handleTemplateCommand(templateId: string | number | object) {
  const id = String(templateId);
  void withSuppressedCredentialReload(() => {
    resetFormFromTemplate(id);
  }).then(() => {
    return loadModelsForProvider(formModel.value.provider);
  });
}

async function handleSave() {
  try {
    await formRef.value?.validate();
  } catch {
    return false;
  }
  if (props.manageCredentials !== true && formProviderConnectionMissing.value) {
    message.warning(t('settings.providerConnectionMissingEditHint'));
    return false;
  }
  const values = formModel.value;
  const provider = normalizeProviderId(values.provider);
  const config: LlmModelConfig = {
    provider,
    connectionId: values.connectionId || undefined,
    model: String(values.model ?? '').trim(),
    temperature: resolveConfigTemperature({
      provider,
      model:
        String(values.model ?? '').trim() ||
        resolveModelForProvider(provider, undefined),
      temperature: isTemperatureUnsupported.value
        ? undefined
        : (values.temperature ?? undefined),
    }),
    maxTokens: values.maxTokens ?? undefined,
    reasoningEffort: (() => {
      const effort = values.reasoningEffort?.trim() || undefined;
      if (supportsReasoningEffort.value) return effort;
      // 目录已确认不支持则清空；目录未命中时保留表单值
      if (selectedModelMeta.value) return undefined;
      return effort;
    })(),
    // 思考开关/强度在聊天模型弹层调整；设置页保存时保留已有 thinkingEnabled
    thinkingEnabled: editingPreset.value?.config.thinkingEnabled,
    baseUrl: values.baseUrl ? String(values.baseUrl).trim() : undefined,
    apiKey: values.apiKey ? String(values.apiKey).trim() : undefined,
  };
  const trimmedName = String(values.name).trim();
  const sharedName = trimmedName === config.model ? '' : trimmedName;

  // 随保存落盘全局生图配置（厂商覆盖 / 生图模型 / 默认尺寸，各预设共用）；
  // 先于预设保存，宿主 persist 返回的快照即包含最新 imageGen
  if (props.showImageGenOptions) {
  {
    const overrideProvider = values.imageGenProvider.trim();
    const effectiveImageGenProvider = overrideProvider
      ? normalizeProviderId(overrideProvider)
      : provider;
    const hasImageGenCatalog =
      imageGenModelsForProvider(effectiveImageGenProvider).length > 0;
    if (hasImageGenCatalog || overrideProvider) {
      try {
        const currentImageGen = props.imageGenConfig ?? {};
        const nextImageGen: ImageGenConfig = {
          ...currentImageGen,
          // null 才能穿透 mergeObjects（undefined 会被跳过，无法清除）
          providerOverride: overrideProvider
            ? effectiveImageGenProvider
            : null,
          modelOverrides: {
            ...currentImageGen.modelOverrides,
            [effectiveImageGenProvider]:
              values.imageGenModel.trim() || null,
          },
          defaultSize:
            normalizeImageSizeLabel(values.imageGenSize.trim()) ||
            '1024x1024',
        };
        await saveLayeredCottageConfig(
          { imageGen: nextImageGen },
          { level: workspace.isOpen ? 'folder' : 'domain' },
        );
        const imageGenApiKey = values.imageGenApiKey.trim();
        if (overrideProvider && imageGenApiKey) {
          const latestSecrets = await loadProviderSecrets();
          await saveProviderSecrets({
            ...latestSecrets,
            [effectiveImageGenProvider]: {
              ...latestSecrets[effectiveImageGenProvider],
              apiKey: imageGenApiKey,
            },
          });
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    }
  }
  }

  const isNew = !editingPreset.value;
  if (isNew) {
    const preset: ModelPreset = {
      id: generatePresetId(),
      name: sharedName,
      config,
    };
    emit('changeDomain', [...props.domainPresets, preset]);
  } else {
    const editing = editingPreset.value;
    if (!editing) return false;
    const preset: ModelPreset = {
      id: editing.id,
      name: sharedName,
      config,
    };
    const next = props.domainPresets.map((item) =>
      item.id === preset.id ? preset : item,
    );
    emit('changeDomain', next);
  }

  isModalOpen.value = false;
  editingPreset.value = null;
  message.success(
    isNew ? t('settings.addedPreset') : t('settings.updatedPreset'),
  );
  return true;
}

function handleOpenProviders() {
  isModalOpen.value = false;
  emit('openProviders');
}

const modalTitle = computed(() =>
  editingPreset.value ? t('settings.editPreset') : t('settings.addPreset'),
);
</script>

<template>
  <div class="model-preset-manager">
    <div class="model-preset-header">
      <div class="model-preset-header-text">
        <NText tag="h3" class="settings-section-title settings-section-title--inline">
          {{ t('settings.modelPresets') }}
        </NText>
        <NText depth="3" class="settings-section-meta">
          {{ t('settings.modelCountHint', { n: totalCount }) }}
        </NText>
      </div>
      <div class="model-preset-header-actions">
        <ElButton type="primary" @click="openAdd">
          <template #icon>
            <NIcon :component="Add" />
          </template>
          {{ t('settings.add') }}
        </ElButton>
      </div>
    </div>

    <ElEmpty v-if="domainPresets.length === 0" :description="t('settings.emptyPresets')">
      <template #extra>
        <ElButton type="primary" @click="openAdd">
          <template #icon>
            <NIcon :component="Add" />
          </template>
          {{ t('settings.addFirstPreset') }}
        </ElButton>
      </template>
    </ElEmpty>

    <div v-else class="model-preset-grid">
      <ElCard
        v-for="preset in domainPresets"
        :key="preset.id"
        :class="[
          'model-preset-card',
          {
            'model-preset-card-unavailable': presetConnectionMissing(preset),
          },
        ]"
        :body-style="{ padding: '12px 14px' }"
        shadow="hover"
      >
        <div class="model-preset-card-content">
          <div class="model-preset-card-header">
            <div class="model-preset-card-title">
              <NIcon :component="HardwareChipOutline" class="model-preset-icon" />
              <NText strong :ellipsis="{ tooltip: true }" class="model-preset-title-text">
                {{ preset.name || preset.config.model }}
              </NText>
            </div>
          </div>

          <div class="model-preset-card-main">
            <div class="model-preset-card-meta">
              <NText depth="3" :ellipsis="{ tooltip: true }" class="model-preset-provider-text">
                {{ providerLabel(preset.config.provider) }}
                <template v-if="presetVendorLabel(preset)"> · {{ presetVendorLabel(preset) }}</template>
              </NText>
            </div>
            <NText depth="3" :ellipsis="{ tooltip: true }" class="model-preset-model-text">
              {{ preset.config.model }}
            </NText>
            <NSpace :size="4">
              <CottageTooltip
                v-if="presetSupportsImageGen(preset)"
                :content="t('settings.cardImageGenTooltip')"
                placement="top"
                delay="lazy"
              >
                <ElTag size="small" type="success">
                  {{ t('settings.cardImageGen') }}
                </ElTag>
              </CottageTooltip>
              <CottageTooltip
                v-if="preset.config.temperature !== undefined"
                :content="t('settings.temperatureTitle', { n: preset.config.temperature })"
                placement="top"
                delay="lazy"
              >
                <ElTag size="small">
                  {{ t('settings.temperature') }} {{ preset.config.temperature }}
                </ElTag>
              </CottageTooltip>
              <ElTag
                v-if="preset.config.maxTokens !== undefined"
                size="small"
              >
                {{ preset.config.maxTokens }} tokens
              </ElTag>
            </NSpace>
          </div>

          <div class="model-preset-card-footer">
            <ElTag
              v-if="presetConnectionMissing(preset)"
              class="model-preset-card-connection-missing"
              type="warning"
              size="small"
              effect="plain"
              @click="openEdit(preset)"
            >
              {{ t('settings.providerConnectionMissing') }}
            </ElTag>
            <CottageTooltip
              v-else-if="presetNeedsKey(preset)"
              :content="t('settings.apiKeyMissingHint')"
              placement="top"
              delay="instant"
            >
              <span
                class="model-preset-card-key-btn"
                role="button"
                tabindex="0"
                :aria-label="t('settings.apiKeyMissing')"
                @click="openEdit(preset)"
                @keydown.enter.prevent="openEdit(preset)"
              >
                <NIcon :component="KeyOutline" class="model-preset-card-key-icon" />
              </span>
            </CottageTooltip>
            <div class="model-preset-card-footer-actions">
              <ElButton text size="small" @click="openEdit(preset)">
                <template #icon>
                  <NIcon :component="CreateOutline" />
                </template>
                {{ t('common.edit') }}
              </ElButton>
              <ElDropdown trigger="click" @command="(cmd) => handleCardCommand(preset, cmd)">
                <span>
                  <CottageTooltip :content="t('common.moreActions')" placement="top" delay="normal">
                    <ElButton text circle size="small">
                      <template #icon>
                        <NIcon :component="EllipsisHorizontalOutline" />
                      </template>
                    </ElButton>
                  </CottageTooltip>
                </span>
                <template #dropdown>
                  <ElDropdownMenu>
                    <ElDropdownItem command="copy">
                      <NIcon :component="CopyOutline" class="model-preset-menu-icon" />
                      {{ t('settings.copy') }}
                    </ElDropdownItem>
                    <ElDropdownItem command="saveTemplate">
                      <NIcon :component="SaveOutline" class="model-preset-menu-icon" />
                      {{ t('settings.saveAsTemplate') }}
                    </ElDropdownItem>
                    <ElDropdownItem command="delete" divided>
                      <NIcon :component="TrashOutline" class="model-preset-menu-icon" />
                      {{ t('common.delete') }}
                    </ElDropdownItem>
                  </ElDropdownMenu>
                </template>
              </ElDropdown>
            </div>
          </div>
        </div>
      </ElCard>
      <CottageTooltip :content="t('settings.addPreset')" placement="top" delay="lazy">
        <button
          type="button"
          class="model-preset-add-card"
          @click="openAdd"
        >
          <NIcon :component="Add" class="model-preset-add-icon" />
          <span class="model-preset-add-text">{{ t('settings.addPreset') }}</span>
        </button>
      </CottageTooltip>
    </div>

    <ElDialog
      v-model="isModalOpen"
      :title="modalTitle"
      width="580px"
      class="model-preset-dialog"
      @closed="editingPreset = null"
    >
      <ElForm
        ref="formRef"
        :model="formModel"
        label-position="top"
        class="ai-settings-form model-preset-form"
      >
        <div
          v-if="modelTemplates.length > 0 && !editingPreset"
          class="model-template-picker"
        >
          <div class="model-template-picker-actions">
            <ElDropdown trigger="click" @command="handleTemplateCommand">
              <ElButton class="model-template-picker-trigger" plain>
                <template #icon>
                  <NIcon :component="CopyOutline" />
                </template>
                {{ t('settings.createFromTemplate') }}
              </ElButton>
              <template #dropdown>
                <ElDropdownMenu>
                  <ElDropdownItem
                    v-for="template in modelTemplates"
                    :key="template.id"
                    :command="template.id"
                  >
                    {{ template.name || template.config.model }}
                  </ElDropdownItem>
                </ElDropdownMenu>
              </template>
            </ElDropdown>
            <CottageTooltip :content="t('settings.templateKeyHint')" placement="top">
              <ElButton
                text
                circle
                class="model-template-picker-info"
                :aria-label="t('settings.templateKeyHint')"
              >
                <template #icon>
                  <NIcon :component="InformationCircleOutline" />
                </template>
              </ElButton>
            </CottageTooltip>
          </div>
        </div>

        <section class="model-preset-section">
          <ElFormItem
            :label="t('settings.provider')"
            prop="provider"
            :rules="[{ required: true, message: t('settings.selectProvider'), trigger: 'change' }]"
          >
            <CottageSelect
              :model-value="
                props.manageCredentials !== true
                  ? (formProviderConnectionMissing ? null : selectedProviderConnection)
                  : formModel.provider
              "
              filterable
              :options="props.manageCredentials !== true ? configuredProviderOptions : LLM_SELECT_OPTIONS"
              @change="handleProviderSelection"
            />
            <NText v-if="props.manageCredentials !== true && configuredProviderOptions.length === 0" depth="3" class="settings-form-item-hint">
              {{ t('settings.noProviders') }}
            </NText>
            <NText
              v-else-if="formProviderConnectionMissing"
              class="settings-form-item-hint settings-form-item-hint--warning"
            >
              {{ t('settings.providerConnectionMissingEditHint') }}
            </NText>
            <div v-if="props.manageCredentials !== true" class="model-field-action-row">
              <button type="button" class="model-field-text-action" @click="handleOpenProviders">
                {{ t('settings.addProvider') }}
              </button>
            </div>
          </ElFormItem>
          <template v-if="formModel.provider && props.manageCredentials === true">
          <CottageServiceLlmFields :provider="formModel.provider" />
          <ElFormItem
            :label="`API Key（${providerLabel(formModel.provider)}，可选）`"
            prop="apiKey"
          >
            <ElInput
              v-model="formModel.apiKey"
              type="password"
              show-password
              :placeholder="t('settings.apiKeyPlaceholder')"
              autocomplete="off"
            />
          </ElFormItem>
          </template>
        </section>

        <section v-if="formModel.provider" class="model-preset-section">
          <ElFormItem
            :label="t('settings.model')"
            prop="model"
            :rules="[{ required: true, message: t('settings.enterOrSelectModel'), trigger: 'blur' }]"
          >
            <template v-if="isAggregatorSelected">
              <ElCascader
                v-if="!modelManualEntry"
                :model-value="modelCascaderValue"
                filterable
                clearable
                :options="aggregatorCascaderOptions"
                :placeholder="t('settings.modelCascaderPlaceholder')"
                :props="{ expandTrigger: 'hover' }"
                style="width: 100%"
                @update:model-value="onModelCascaderUpdate"
              />
              <ElInput
                v-else
                v-model="formModel.model"
                :placeholder="t('settings.modelIdPlaceholder')"
              />
              <button
                type="button"
                class="model-manual-toggle"
                @click="toggleModelManualEntry"
              >
                {{
                  modelManualEntry
                    ? t('settings.pickFromCatalog')
                    : t('settings.enterModelManually')
                }}
              </button>
            </template>
            <CottageSelect
              v-else
              v-model="formModel.model"
              filterable
              allow-create
              :placeholder="t('settings.modelIdPlaceholder')"
              :options="modelOptions"
            />
            <NText v-if="loadingModels" depth="3" class="settings-form-item-hint">
              {{ t('settings.fetchingModels') }}
            </NText>
            <NText
              v-else-if="modelFetchError"
              class="settings-form-item-hint settings-form-item-hint--warning"
            >
              {{ t('settings.fetchModelsFailed', { error: modelFetchError }) }}
            </NText>
            <NText
              v-else-if="modelOptions.length === 0"
              depth="3"
              class="settings-form-item-hint"
            >
              {{ t('settings.noModelList') }}
            </NText>
            <NText
              v-else-if="modelCatalogHint"
              depth="3"
              class="settings-form-item-hint"
            >
              {{ modelCatalogHint }}
            </NText>
            <div
              v-if="hasModelCapabilityInfo || dialogSupportsImageGen"
              class="model-capability-panel"
            >
              <NSpace :size="6" class="model-capability-tags">
                <ElTag
                  size="small"
                  :type="selectedModelMeta?.temperature === false ? 'info' : 'success'"
                  effect="plain"
                >
                  {{
                    selectedModelMeta?.temperature === false
                      ? t('settings.capTemperatureNo')
                      : selectedModelMeta?.temperature === true
                        ? t('settings.capTemperatureYes')
                        : t('settings.capTemperatureUnknown')
                  }}
                </ElTag>
                <ElTag
                  v-if="selectedModelMeta?.contextLimit"
                  size="small"
                  type="success"
                  effect="plain"
                >
                  {{
                    t('settings.capContext', {
                      n: formatTokenLimit(selectedModelMeta.contextLimit),
                    })
                  }}
                </ElTag>
                <ElTag
                  v-if="selectedModelMeta?.outputLimit"
                  size="small"
                  effect="plain"
                >
                  {{
                    t('settings.capOutput', {
                      n: formatTokenLimit(selectedModelMeta.outputLimit),
                    })
                  }}
                </ElTag>
                <ElTag
                  v-if="selectedModelMeta?.reasoning === true"
                  size="small"
                  type="success"
                  effect="plain"
                >
                  {{ t('settings.capReasoningYes') }}
                </ElTag>
                <ElTag
                  v-else-if="selectedModelMeta?.reasoning === false"
                  size="small"
                  type="info"
                  effect="plain"
                >
                  {{ t('settings.capReasoningNo') }}
                </ElTag>
                <ElTag
                  v-if="supportsReasoningEffort"
                  size="small"
                  type="warning"
                  effect="plain"
                >
                  {{ t('settings.capReasoningEffortYes') }}
                </ElTag>
                <ElTag
                  v-else-if="selectedModelMeta?.reasoning === true"
                  size="small"
                  effect="plain"
                >
                  {{ t('settings.capReasoningEffortNo') }}
                </ElTag>
                <ElTag
                  v-if="selectedModelMeta?.vision !== undefined"
                  size="small"
                  :type="selectedModelMeta.vision ? 'success' : 'info'"
                  effect="plain"
                >
                  {{ selectedModelMeta.vision ? t('settings.capVisionYes') : t('settings.capVisionNo') }}
                </ElTag>
                <ElTag
                  v-if="selectedModelMeta?.tools !== undefined"
                  size="small"
                  :type="selectedModelMeta.tools ? 'success' : 'info'"
                  effect="plain"
                >
                  {{ selectedModelMeta.tools ? t('settings.capToolsYes') : t('settings.capToolsNo') }}
                </ElTag>
                <ElTag
                  v-if="dialogSupportsImageGen"
                  size="small"
                  type="success"
                  effect="plain"
                >
                  {{ t('settings.capImageGenYes') }}
                </ElTag>
                <ElTag
                  v-else-if="hasModelCapabilityInfo"
                  size="small"
                  type="info"
                  effect="plain"
                >
                  {{ t('settings.capImageGenNo') }}
                </ElTag>
              </NSpace>
            </div>
          </ElFormItem>
          <ElFormItem :label="t('settings.aliasOptional')" prop="name">
            <ElInput
              v-model="formModel.name"
              :placeholder="t('settings.aliasPlaceholder')"
              @input="onNameInput"
            />
          </ElFormItem>
        </section>

        <ElCollapse
          v-if="formModel.provider"
          v-model="advancedSettingsOpen"
          class="model-preset-advanced"
        >
          <ElCollapseItem :title="t('settings.advancedSettings')" name="advanced">
            <ElFormItem
              v-if="props.manageCredentials === true"
              :label="baseUrlFieldLabel"
              prop="baseUrl"
              :rules="
                isCustomOpenAiCompatible
                  ? [{ required: true, message: t('settings.enterBaseUrl'), trigger: 'blur' }]
                  : undefined
              "
            >
              <ElInput v-model="formModel.baseUrl" :placeholder="baseUrlPlaceholder" />
              <NText depth="3" class="settings-form-item-hint">
                {{ t('settings.baseUrlSimpleHint') }}
              </NText>
            </ElFormItem>
            <div class="model-preset-params">
              <ElFormItem :label="t('settings.temperature')" prop="temperature">
                <ElInputNumber
                  v-model="formModel.temperature"
                  :min="0"
                  :max="2"
                  :step="0.1"
                  :disabled="isTemperatureUnsupported"
                />
                <NText v-if="isTemperatureUnsupported" depth="3" class="settings-form-item-hint">
                  {{ t('settings.temperatureUnsupported') }}
                </NText>
                <NText v-else depth="3" class="settings-form-item-hint">
                  {{ t('settings.temperatureSimpleHint') }}
                </NText>
              </ElFormItem>
              <ElFormItem :label="t('settings.maxTokensOptional')" prop="maxTokens">
                <ElInputNumber v-model="formModel.maxTokens" :min="1" />
                <NText depth="3" class="settings-form-item-hint">
                  {{
                    selectedModelMeta?.outputLimit
                      ? t('settings.maxTokensHint', {
                          n: formatTokenLimit(selectedModelMeta.outputLimit),
                        })
                      : t('settings.maxTokensSimpleHint')
                  }}
                </NText>
              </ElFormItem>
              <ElFormItem
                v-if="supportsReasoningEffort"
                :label="t('settings.reasoningEffort')"
                prop="reasoningEffort"
              >
                <CottageSelect
                  v-model="formModel.reasoningEffort"
                  clearable
                  :options="reasoningEffortOptions"
                  :placeholder="t('settings.reasoningEffortPlaceholder')"
                />
                <NText depth="3" class="settings-form-item-hint">
                  {{ t('settings.reasoningEffortHint') }}
                </NText>
              </ElFormItem>
            </div>
          </ElCollapseItem>
        </ElCollapse>

        <section
          v-if="props.showImageGenOptions && formModel.provider"
          class="model-preset-section model-preset-section--last"
        >
          <NText depth="3" class="settings-form-item-hint model-preset-imagegen-lead">
            {{ t('settings.presetImageGenLead') }}
          </NText>
          <div class="model-preset-params">
            <ElFormItem :label="t('settings.imageGenProvider')">
              <CottageSelect
                :model-value="formModel.imageGenProvider"
                :options="dialogImageGenProviderOptions"
                @update:model-value="
                  (v) => (formModel.imageGenProvider = String(v ?? ''))
                "
              />
              <NText depth="3" class="settings-form-item-hint">
                {{ t('settings.imageGenProviderHint') }}
              </NText>
            </ElFormItem>
            <ElFormItem
              v-if="formModel.imageGenProvider"
              :label="`API Key（${providerLabel(dialogEffectiveImageGenProvider)}）`"
            >
              <ElInput
                v-model="formModel.imageGenApiKey"
                type="password"
                show-password
                :placeholder="t('settings.apiKeyPlaceholder')"
                autocomplete="off"
              />
              <NText depth="3" class="settings-form-item-hint">
                {{ t('settings.imageGenApiKeyHint') }}
              </NText>
            </ElFormItem>
            <ElFormItem
              v-if="dialogEffectiveImageGenModels.length"
              :label="t('settings.imageGenModel')"
            >
              <CottageSelect
                :model-value="dialogImageGenSelectedModelId"
                :options="dialogImageGenModelOptions"
                @update:model-value="(v) => (formModel.imageGenModel = String(v ?? ''))"
              />
            </ElFormItem>
            <ElFormItem
              v-if="dialogEffectiveImageGenModels.length"
              :label="t('settings.imageGenDefaultSize')"
            >
              <CottageSelect
                :model-value="normalizeImageSizeLabel(formModel.imageGenSize || '1024x1024')"
                :options="dialogImageGenSizeOptions"
                @update:model-value="
                  (v) =>
                    (formModel.imageGenSize =
                      normalizeImageSizeLabel(String(v ?? '').trim()) || '1024x1024')
                "
              />
              <NText depth="3" class="settings-form-item-hint">
                {{ t('settings.imageGenDefaultSizeHint') }}
              </NText>
            </ElFormItem>
          </div>
        </section>
      </ElForm>
      <template #footer>
        <div class="cottage-button-row">
          <ElButton @click="isModalOpen = false">{{ t('common.cancel') }}</ElButton>
          <ElButton type="primary" @click="void handleSave()">{{ t('common.save') }}</ElButton>
        </div>
      </template>
    </ElDialog>

  </div>
</template>

<style scoped>
.model-preset-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 12px;
}

.model-preset-header-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}

.model-preset-header-text {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.model-preset-menu-icon {
  margin-right: 6px;
  font-size: 14px;
  vertical-align: middle;
}

.model-preset-section {
  margin-bottom: 20px;
}

.model-preset-section--last {
  margin-bottom: 0;
}

.model-preset-section :deep(.el-form-item:last-child) {
  margin-bottom: 16px;
}

.model-template-picker {
  margin-bottom: 18px;
}

.model-template-picker-trigger {
  font-weight: 500;
}

.model-template-picker-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.model-template-picker-info {
  color: var(--el-text-color-secondary) !important;
}

.model-preset-advanced {
  margin: 0 0 20px;
}

.model-manual-toggle {
  align-self: flex-start;
  margin-top: 8px;
}

.model-manual-toggle,
.model-field-text-action {
  padding: 2px 0;
  border: none;
  background: transparent;
  color: var(--el-color-primary);
  cursor: pointer;
  font: inherit;
  font-size: var(--cottage-font-sm);
}

.model-field-action-row {
  flex-basis: 100%;
  width: 100%;
  margin-top: 8px;
}

.model-capability-panel {
  margin-top: 10px;
}

.model-capability-tags {
  flex-wrap: wrap;
}

.model-preset-imagegen-lead {
  display: block;
  margin-bottom: 10px;
}

.model-preset-params {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}

.model-preset-params :deep(.el-form-item) {
  margin-bottom: 16px;
}

@media (max-width: 520px) {
  .model-preset-params {
    grid-template-columns: 1fr;
  }
}
</style>
