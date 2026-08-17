<script setup lang="ts">
import {
  BuildOutline,
  CloseOutline,
  HardwareChipOutline } from '@vicons/ionicons5';
import {
  ElButton,
  ElDialog,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElStep,
  ElSteps,
  ElSwitch,
  ElTabPane,
  ElTabs,
  ElMessage
} from 'element-plus';
import CottageSelect from '@/ui/CottageSelect.vue';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type CottageConfig,
  type ImageGenConfig,
  type ImageGenModelPreset,
  type LayeredCottageConfigSchema,
  type ModelPreset,
  type ModelTemplate,
} from '../../config/constants';
import {
  loadLayeredCottageConfig,
  saveLayeredCottageConfig,
} from '../../config/cottageStorage';
import {
  LLM_PROVIDER_DEFINITIONS,
  normalizeProviderId,
  providerLabel,
  type LlmProviderId,
} from '../../config/llmProviders';
import { fetchProviderModels } from '../../config/modelCatalog';
import {
  getProviderConnections,
  loadProviderSecrets,
  saveProviderSecrets,
  setPresetApiKey,
  type ProviderSecretEntry,
  type ProviderSecrets,
} from '../../config/secrets';
import { generatePresetId, getModelPresets } from '../../config/store';
import {
  presetHasApiKey,
  providerConnectionExists,
} from '../../config/llmKeyStatus';
import {
  IMAGE_GEN_PROVIDER_IDS,
  defaultImageGenModel,
  imageGenModelsForProvider,
  loadOpenRouterImageModels,
  normalizeImageSizeLabel,
} from '../../imagegen/catalog';
import { useAgentStore } from '../../stores/agent';
import { useCottageServiceStore } from '../../stores/cottageService';
import { useWorkspaceStore } from '../../stores/workspace';
import FeatureSettingsTabs, { FEATURE_TAB_META } from './FeatureSettingsTabs.vue';
import ModelPresetManager from './ModelPresetManager.vue';
import ProviderManager from './ProviderManager.vue';
import ImageModelPresetManager from './ImageModelPresetManager.vue';
import ModelConfigTransferPanel from './ModelConfigTransferPanel.vue';
import SettingsHealthCard from './SettingsHealthCard.vue';
import type { ModelConfigTransferBundle } from '../../config/modelConfigTransfer';
import LocaleSelect from '../LocaleSelect.vue';

const props = defineProps<{
  /** 打开设置时定位到的 tab */
  initialTab?: string;
}>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const message = ElMessage;
const workspaceStore = useWorkspaceStore();
const agentStore = useAgentStore();
const cottageServiceStore = useCottageServiceStore();
const { snapshot, activeWorkspaceId } = storeToRefs(workspaceStore);

const secrets = ref<ProviderSecrets>({});
const config = ref<CottageConfig>({});
const activeTab = ref(props.initialTab || 'model-api');
const modelSettingsTab = ref('providers');
const setupWizardOpen = ref(false);
const setupWizardStep = ref(0);
const WIZARD_NEW_PROVIDER = '__new_provider__';

interface SetupWizardForm {
  providerConnection: string;
  newProvider: LlmProviderId;
  providerAlias: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  modelAlias: string;
  temperature: number | null;
  maxTokens: number | null;
  reasoningEffort: string;
  configureImage: boolean;
  imageProviderConnection: string;
  imageModel: string;
  imageAlias: string;
  imageSize: string;
}

const makeSetupWizardForm = (): SetupWizardForm => ({
  providerConnection: '',
  newProvider: 'openai',
  providerAlias: '',
  apiKey: '',
  baseUrl: '',
  model: '',
  modelAlias: '',
  temperature: null,
  maxTokens: null,
  reasoningEffort: '',
  configureImage: false,
  imageProviderConnection: '',
  imageModel: '',
  imageAlias: '',
  imageSize: '1024x1024',
});

const setupWizardForm = ref<SetupWizardForm>(makeSetupWizardForm());
const setupWizardModelOptions = ref<{ value: string; label: string }[]>([]);
const setupWizardModelsLoading = ref(false);
const setupWizardSaving = ref(false);
const setupWizardImageCatalogRevision = ref(0);

function connectionValue(provider: LlmProviderId, connectionId?: string) {
  return `${provider}::${connectionId ?? ''}`;
}

function parseConnectionValue(value: string): { provider: LlmProviderId; connectionId: string } | undefined {
  if (!value || value === WIZARD_NEW_PROVIDER) return undefined;
  const [providerId, connectionId = ''] = value.split('::');
  return { provider: normalizeProviderId(providerId), connectionId };
}

const configuredProviderOptions = computed(() =>
  LLM_PROVIDER_DEFINITIONS.flatMap((provider) =>
    getProviderConnections(secrets.value, provider.id).map((connection) => ({
      value: connectionValue(provider.id, connection.id),
      label: `${provider.label} · ${connection.alias || t('settings.defaultBadge')}`,
    })),
  ),
);

const setupWizardProviderOptions = computed(() => [
  ...configuredProviderOptions.value,
  { value: WIZARD_NEW_PROVIDER, label: t('settings.wizardAddNewProvider') },
]);

const providerDefinitionOptions = computed(() =>
  LLM_PROVIDER_DEFINITIONS.map((provider) => ({ value: provider.id, label: provider.label })),
);

const configuredImageProviderOptions = computed(() =>
  IMAGE_GEN_PROVIDER_IDS.flatMap((providerId) =>
    getProviderConnections(secrets.value, providerId).map((connection) => ({
      value: connectionValue(providerId, connection.id),
      label: `${providerLabel(providerId)} · ${connection.alias || t('settings.defaultBadge')}`,
    })),
  ),
);

const selectedWizardConnection = computed(() =>
  parseConnectionValue(setupWizardForm.value.providerConnection),
);

const selectedWizardConnectionLabel = computed(() =>
  setupWizardProviderOptions.value.find(
    (option) => option.value === setupWizardForm.value.providerConnection,
  )?.label ?? '',
);

const setupWizardImageModelOptions = computed(() => {
  // OpenRouter 目录在异步加载后写入模块缓存；用版本号使这里重新计算。
  void setupWizardImageCatalogRevision.value;
  const selected = parseConnectionValue(setupWizardForm.value.imageProviderConnection);
  if (!selected) return [];
  return imageGenModelsForProvider(selected.provider).map((model) => ({
    value: model.id,
    label: model.label,
  }));
});

watch(
  () => props.initialTab,
  (tab) => {
    if (tab) activeTab.value = tab;
  },
);
const layeredConfig = ref<(LayeredCottageConfigSchema & { merged: CottageConfig }) | null>(null);
const domainPresets = ref<ModelPreset[]>([]);
const domainActivePresetId = ref<string | undefined>();
const modelTemplates = ref<ModelTemplate[]>([]);

const resolveAutomaticAgentDefault = (presets: ModelPreset[]): string | undefined =>
  presets.find((preset) => presetHasApiKey(preset, secrets.value))?.id;
const healthHasApiKey = computed(() => Boolean(resolveAutomaticAgentDefault(domainPresets.value)));
function resolveLayerModelState(layerConfig: CottageConfig | null | undefined) {
  const loadedPresets = getModelPresets(layerConfig ?? {});
  const resolvedActivePresetId = loadedPresets.some(
    (p) => p.id === layerConfig?.activePresetId,
  )
    ? layerConfig?.activePresetId
    : loadedPresets[0]?.id;
  return { loadedPresets, resolvedActivePresetId };
}

function withPresetApiKey(presets: ModelPreset[], loadedSecrets: ProviderSecrets): ModelPreset[] {
  return presets.map((preset) => {
    const presetSecret = loadedSecrets.presetApiKeys?.[preset.id];
    if (!presetSecret?.apiKey) return preset;
    return {
      ...preset,
      config: { ...preset.config, apiKey: presetSecret.apiKey },
    };
  });
}

async function loadAll() {
  const [loadedSecrets, layered] = await Promise.all([
    loadProviderSecrets(),
    loadLayeredCottageConfig(),
  ]);
  secrets.value = loadedSecrets;
  layeredConfig.value = layered;
  config.value = layered.merged;

  modelTemplates.value = layered.layers.folder?.modelTemplates ?? [];

  const domainState = resolveLayerModelState(layered.layers.domain);
  domainPresets.value = withPresetApiKey(domainState.loadedPresets, loadedSecrets);
  domainActivePresetId.value = resolveAutomaticAgentDefault(domainPresets.value);
  if (domainActivePresetId.value !== domainState.resolvedActivePresetId) {
    await persistDomainPresets();
  }
}

watch(activeWorkspaceId, () => {
  void loadAll();
});

onMounted(() => {
  void loadAll();
});

function patchConfig(patch: Partial<CottageConfig>) {
  config.value = { ...config.value, ...patch };
}

function stripLayerPresets(
  layerPresets: ModelPreset[],
  baseSecrets: ProviderSecrets,
): { stripped: ModelPreset[]; secrets: ProviderSecrets } {
  let nextSecrets = baseSecrets;
  const stripped: ModelPreset[] = [];
  for (const preset of layerPresets) {
    const { apiKey, ...restConfig } = preset.config;
    stripped.push({ ...preset, config: restConfig });
    if (apiKey) {
      nextSecrets = setPresetApiKey(nextSecrets, preset.id, {
        apiKey,
      } as ProviderSecretEntry);
    }
  }
  return { stripped, secrets: nextSecrets };
}

async function applyLayeredSnapshot(
  saved: LayeredCottageConfigSchema & { merged: CottageConfig },
  options?: { reloadAgent?: boolean },
) {
  layeredConfig.value = saved;
  config.value = saved.merged;
  if (options?.reloadAgent) {
    await agentStore.reloadSecrets({ remount: true });
  }
}

async function persistDomainPresets() {
  // 服务商密钥可能刚在「服务商」页更新；保存 Agent 模型时以最新密钥为基准，
  // 避免旧的内存快照覆盖它。
  const latestSecrets = await loadProviderSecrets();
  const { stripped: strippedPresets, secrets: nextSecrets } = stripLayerPresets(
    domainPresets.value,
    latestSecrets,
  );
  await saveProviderSecrets(nextSecrets);
  secrets.value = nextSecrets;
  domainActivePresetId.value = resolveAutomaticAgentDefault(domainPresets.value);
  const activePreset = strippedPresets.find((p) => p.id === domainActivePresetId.value);
  const saved = await saveLayeredCottageConfig(
    {
      llm: activePreset?.config,
      modelPresets: strippedPresets,
      activePresetId: domainActivePresetId.value,
    },
    { level: 'domain' },
  );
  await applyLayeredSnapshot(saved, { reloadAgent: true });
}

function handleDomainPresetsChange(nextPresets: ModelPreset[]) {
  domainPresets.value = nextPresets;
  void persistDomainPresets().catch((error) => {
    message.error(error instanceof Error ? error.message : String(error));
  });
}

async function persistModelTemplates() {
  if (!snapshot.value) {
    throw new Error(t('settings.cannotSaveWithoutWorkspace'));
  }
  const saved = await saveLayeredCottageConfig(
    { modelTemplates: modelTemplates.value },
    { level: 'folder' },
  );
  await applyLayeredSnapshot(saved, { reloadAgent: false });
}

function handleSaveTemplate(template: ModelTemplate) {
  if (!snapshot.value) {
    message.warning(t('settings.openWsToSaveTemplate'));
    return;
  }
  modelTemplates.value = [...modelTemplates.value, template];
  void persistModelTemplates().catch((error) => {
    message.error(error instanceof Error ? error.message : String(error));
  });
}

async function handleProviderChanged() {
  await loadAll();
  await agentStore.reloadSecrets({ remount: true });
}

async function handleImageModelsChange(imageGen: NonNullable<CottageConfig['imageGen']>) {
  const active = imageGen.modelPresets?.find((preset) =>
    providerConnectionExists(preset.provider, preset.connectionId, secrets.value),
  );
  const normalized: ImageGenConfig = {
    ...imageGen,
    activePresetId: active?.id,
    providerOverride: active?.provider ?? null,
    modelOverrides: active ? { ...imageGen.modelOverrides, [active.provider]: active.model } : imageGen.modelOverrides,
    defaultSize: active?.defaultSize ?? imageGen.defaultSize,
  };
  const saved = await saveLayeredCottageConfig({ imageGen: normalized }, { level: 'domain' });
  await applyLayeredSnapshot(saved, { reloadAgent: true });
}

async function handleImportModelConfig(bundle: ModelConfigTransferBundle) {
  const latestSecrets = await loadProviderSecrets();
  const nextSecrets: ProviderSecrets = { ...latestSecrets, providerConnections: { ...latestSecrets.providerConnections } };
  const connectionIds = new Map<string, string>();
  for (const item of bundle.connections) {
    const existing = getProviderConnections(nextSecrets, item.provider).find((connection) =>
      item.apiKey
        ? connection.apiKey === item.apiKey && connection.baseUrl === item.baseUrl
        : connection.baseUrl === item.baseUrl && connection.alias === item.alias,
    );
    const id = existing?.id ?? `connection_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    connectionIds.set(item.ref, id);
    if (!existing) {
      const connections = nextSecrets.providerConnections?.[item.provider] ?? [];
      nextSecrets.providerConnections = {
        ...nextSecrets.providerConnections,
        [item.provider]: [...connections, { id, apiKey: item.apiKey ?? '', ...(item.alias ? { alias: item.alias } : {}), ...(item.baseUrl ? { baseUrl: item.baseUrl } : {}) }],
      };
    }
  }
  const agentModels: ModelPreset[] = bundle.agentModels.map((item) => ({
    id: generatePresetId(), name: item.name,
    config: { ...item.config, ...(item.connectionRef && connectionIds.get(item.connectionRef) ? { connectionId: connectionIds.get(item.connectionRef) } : {}) },
  }));
  const imageModels: ImageGenModelPreset[] = bundle.imageModels.map((item) => ({
    id: `image_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: item.name, provider: item.provider, model: item.model,
    ...(item.defaultSize ? { defaultSize: item.defaultSize } : {}),
    ...(item.connectionRef && connectionIds.get(item.connectionRef) ? { connectionId: connectionIds.get(item.connectionRef) } : {}),
  }));
  await saveProviderSecrets(nextSecrets);
  secrets.value = nextSecrets;
  domainPresets.value = [...domainPresets.value, ...agentModels];
  const nextImageGen: ImageGenConfig = {
    ...config.value.imageGen,
    modelPresets: [...(config.value.imageGen?.modelPresets ?? []), ...imageModels],
  };
  await persistDomainPresets();
  await handleImageModelsChange(nextImageGen);
  message.success(t('settings.importedConfig'));
}

async function importModelConfigWithFeedback(bundle: ModelConfigTransferBundle) {
  try {
    await handleImportModelConfig(bundle);
  } catch (error) {
    // 导入落盘链路任一环节失败都要告知用户，不能静默吞掉
    console.error('[settings] import model config failed', error);
    message.error(error instanceof Error ? error.message : t('settings.importFailed'));
  }
}

function openSetupWizard() {
  const firstConnection = configuredProviderOptions.value[0]?.value ?? WIZARD_NEW_PROVIDER;
  setupWizardForm.value = {
    ...makeSetupWizardForm(),
    providerConnection: firstConnection,
  };
  setupWizardModelOptions.value = [];
  setupWizardStep.value = 0;
  setupWizardOpen.value = true;
}

function resolveConnectionSecret(value: string): ProviderSecretEntry | undefined {
  const selected = parseConnectionValue(value);
  if (!selected) return undefined;
  return getProviderConnections(secrets.value, selected.provider).find(
    (connection) => (connection.id ?? '') === selected.connectionId,
  );
}

async function saveWizardProvider(): Promise<boolean> {
  const form = setupWizardForm.value;
  if (form.providerConnection !== WIZARD_NEW_PROVIDER) {
    if (!parseConnectionValue(form.providerConnection)) {
      message.warning(t('settings.selectProvider'));
      return false;
    }
    return true;
  }

  const normalizedKey = form.apiKey.trim();
  if (!normalizedKey) {
    message.warning(t('settings.wizardApiKeyRequired'));
    return false;
  }

  const providerId = form.newProvider;
  const storedConnections = secrets.value.providerConnections?.[providerId] ?? [];
  const legacyConnection = secrets.value[providerId];
  const current = [
    ...(legacyConnection
      ? [{ ...legacyConnection, id: legacyConnection.id ?? `legacy_${providerId}` }]
      : []),
    ...storedConnections,
  ];
  const sameKey = current.find((connection) => connection.apiKey.trim() === normalizedKey);
  const id = sameKey?.id ?? `connection_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const entry: ProviderSecretEntry = {
    id,
    alias: form.providerAlias.trim() || undefined,
    apiKey: normalizedKey,
    baseUrl: form.baseUrl.trim() || undefined,
  };
  const connections = [
    ...current.filter(
      (connection) => connection.id !== id && connection.apiKey.trim() !== normalizedKey,
    ),
    entry,
  ];
  const nextSecrets: ProviderSecrets = {
    ...secrets.value,
    providerConnections: {
      ...secrets.value.providerConnections,
      [providerId]: connections,
    },
  };
  delete nextSecrets[providerId];
  await saveProviderSecrets(nextSecrets);
  secrets.value = nextSecrets;
  form.providerConnection = connectionValue(providerId, id);
  await agentStore.reloadSecrets({ remount: true });
  return true;
}

async function loadWizardModels() {
  const selected = selectedWizardConnection.value;
  const secret = resolveConnectionSecret(setupWizardForm.value.providerConnection);
  if (!selected || !secret) {
    setupWizardModelOptions.value = [];
    return;
  }

  setupWizardModelsLoading.value = true;
  try {
    const result = await fetchProviderModels({
      providerId: selected.provider,
      apiKey: secret.apiKey,
      secretBaseUrl: secret.baseUrl,
      force: true,
    });
    setupWizardModelOptions.value = result.models.map((model) => ({
      value: model.id,
      label: model.label || model.id,
    }));
    const defaultModel = LLM_PROVIDER_DEFINITIONS.find(
      (provider) => provider.id === selected.provider,
    )?.defaultModel;
    if (!setupWizardForm.value.model) {
      setupWizardForm.value.model = result.models[0]?.id ?? defaultModel ?? '';
    }
  } catch (error) {
    setupWizardModelOptions.value = [];
    message.warning(
      t('settings.fetchModelsFailed', {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    setupWizardModelsLoading.value = false;
  }
}

function initializeWizardImageStep() {
  const agentConnection = selectedWizardConnection.value;
  const agentConnectionValue = setupWizardForm.value.providerConnection;
  const canReuseAgentConnection = Boolean(
    agentConnection && IMAGE_GEN_PROVIDER_IDS.includes(agentConnection.provider),
  );
  setupWizardForm.value.imageProviderConnection = canReuseAgentConnection
    ? agentConnectionValue
    : configuredImageProviderOptions.value[0]?.value ?? '';
  handleWizardImageProviderChange(setupWizardForm.value.imageProviderConnection);
}

async function refreshWizardOpenRouterImageCatalog() {
  try {
    await loadOpenRouterImageModels();
    setupWizardImageCatalogRevision.value += 1;
  } catch {
    // 目录请求失败时继续展示内置后备清单，不能阻断配置流程。
  }
}

function handleWizardImageProviderChange(value: string | number | null | undefined) {
  const selected = parseConnectionValue(String(value ?? ''));
  setupWizardForm.value.imageProviderConnection = String(value ?? '');
  setupWizardForm.value.imageModel = selected
    ? defaultImageGenModel(selected.provider)?.id ?? ''
    : '';
  if (selected?.provider === 'openrouter') {
    void refreshWizardOpenRouterImageCatalog();
  }
}

async function handleSetupWizardNext() {
  if (setupWizardStep.value === 0) {
    if (!(await saveWizardProvider())) return;
    setupWizardForm.value.model = '';
    await loadWizardModels();
    setupWizardStep.value = 1;
    return;
  }

  if (!setupWizardForm.value.model.trim()) {
    message.warning(t('settings.enterOrSelectModel'));
    return;
  }
  initializeWizardImageStep();
  setupWizardStep.value = 2;
}

function returnWizardToAddProvider() {
  setupWizardForm.value.providerConnection = WIZARD_NEW_PROVIDER;
  setupWizardStep.value = 0;
}

async function finishSetupWizard() {
  const selected = selectedWizardConnection.value;
  const model = setupWizardForm.value.model.trim();
  if (!selected || !model) {
    setupWizardStep.value = selected ? 1 : 0;
    message.warning(selected ? t('settings.enterOrSelectModel') : t('settings.selectProvider'));
    return;
  }

  let nextImageGen: ImageGenConfig | undefined = config.value.imageGen;
  if (setupWizardForm.value.configureImage) {
    const imageConnection = parseConnectionValue(setupWizardForm.value.imageProviderConnection);
    const imageModel = setupWizardForm.value.imageModel.trim();
    if (!imageConnection) {
      message.warning(t('settings.wizardSelectImageProvider'));
      return;
    }
    if (!imageModel) {
      message.warning(t('settings.wizardSelectImageModel'));
      return;
    }
    const imagePresetId = `image_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const imagePreset: ImageGenModelPreset = {
      id: imagePresetId,
      name: setupWizardForm.value.imageAlias.trim(),
      provider: imageConnection.provider,
      connectionId: imageConnection.connectionId || undefined,
      model: imageModel,
      defaultSize: normalizeImageSizeLabel(setupWizardForm.value.imageSize) || '1024x1024',
    };
    nextImageGen = {
      ...config.value.imageGen,
      modelPresets: [...(config.value.imageGen?.modelPresets ?? []), imagePreset],
      activePresetId: imagePresetId,
      providerOverride: imagePreset.provider,
      modelOverrides: {
        ...config.value.imageGen?.modelOverrides,
        [imagePreset.provider]: imagePreset.model,
      },
      defaultSize: imagePreset.defaultSize,
    };
  }

  setupWizardSaving.value = true;
  try {
    const preset: ModelPreset = {
      id: generatePresetId(),
      name: setupWizardForm.value.modelAlias.trim(),
      config: {
        provider: selected.provider,
        connectionId: selected.connectionId || undefined,
        model,
        ...(typeof setupWizardForm.value.temperature === 'number'
          ? { temperature: setupWizardForm.value.temperature }
          : {}),
        ...(typeof setupWizardForm.value.maxTokens === 'number'
          ? { maxTokens: setupWizardForm.value.maxTokens }
          : {}),
        ...(setupWizardForm.value.reasoningEffort.trim()
          ? { reasoningEffort: setupWizardForm.value.reasoningEffort.trim() }
          : {}),
      },
    };
    const nextPresets = [...domainPresets.value, preset];
    const latestSecrets = await loadProviderSecrets();
    const { stripped, secrets: nextSecrets } = stripLayerPresets(nextPresets, latestSecrets);
    await saveProviderSecrets(nextSecrets);
    const saved = await saveLayeredCottageConfig(
      {
        llm: preset.config,
        modelPresets: stripped,
        activePresetId: preset.id,
        ...(nextImageGen ? { imageGen: nextImageGen } : {}),
      },
      { level: 'domain' },
    );
    domainPresets.value = nextPresets;
    domainActivePresetId.value = preset.id;
    secrets.value = nextSecrets;
    await applyLayeredSnapshot(saved, { reloadAgent: true });
    setupWizardOpen.value = false;
    message.success(t('settings.wizardSetupComplete'));
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    setupWizardSaving.value = false;
  }
}

</script>
<template>
  <div class="panel preview-panel ai-settings-inline-panel">
    <div class="panel-header">
      <NText strong class="panel-header-title">{{ t('settings.title') }}</NText>
      <div class="ai-settings-header-actions">
        <LocaleSelect compact />
        <CottageTooltip :content="t('common.close')" placement="top">
          <ElButton class="cottage-icon-btn" @click="emit('close')">
            <template #icon>
              <NIcon :component="CloseOutline" />
            </template>
          </ElButton>
        </CottageTooltip>
      </div>
    </div>
    <div class="panel-body ai-settings-inline-body">
      <ElTabs v-model="activeTab" class="ai-settings-tabs">
        <ElTabPane name="model-api">
          <template #label>
            <span class="ai-settings-tab-label">
              <NIcon :component="HardwareChipOutline" />
              <span>{{ t('settings.tabs.modelApi') }}</span>
            </span>
          </template>
          <div class="settings-pane settings-pane--list">
            <div class="settings-status-surface">
              <SettingsHealthCard
                :has-api-key="healthHasApiKey"
                :service-connected="cottageServiceStore.isConnected()"
              />
              <ModelConfigTransferPanel
                :agent-models="domainPresets"
                :image-models="config.imageGen?.modelPresets ?? []"
                :secrets="secrets"
                @imported="(bundle) => void importModelConfigWithFeedback(bundle)"
                @open-setup="openSetupWizard"
              />
            </div>
            <div class="model-settings-layout">
              <aside class="model-settings-sidebar" :aria-label="t('settings.tabs.modelApi')">
                <button type="button" class="model-settings-nav-item" :class="{ 'is-active': modelSettingsTab === 'providers' }" @click="modelSettingsTab = 'providers'">
                  {{ t('settings.provider') }}
                </button>
                <button type="button" class="model-settings-nav-item" :class="{ 'is-active': modelSettingsTab === 'agent' }" @click="modelSettingsTab = 'agent'">
                  {{ t('settings.agentModels') }}
                </button>
                <button type="button" class="model-settings-nav-item" :class="{ 'is-active': modelSettingsTab === 'image' }" @click="modelSettingsTab = 'image'">
                  {{ t('settings.imageModels') }}
                </button>
              </aside>
              <div class="model-settings-main">
              <template v-if="modelSettingsTab === 'providers'">
                <NText tag="h2" class="model-settings-title">{{ t('settings.provider') }}</NText>
                <ProviderManager :secrets="secrets" @changed="handleProviderChanged" />
              </template>
              <div v-if="modelSettingsTab === 'agent'">
              <NText tag="h2" class="model-settings-title">{{ t('settings.agentModels') }}</NText>
              <NText depth="3" class="settings-panel-lead">
                {{ t('settings.modelLead') }}
                <template v-if="modelTemplates.length > 0">
                  {{ t('settings.modelLeadFromTemplate') }}
                </template>
              </NText>
              <div class="settings-section-block">
                <ModelPresetManager
                  :domain-presets="domainPresets"
                  :model-templates="modelTemplates"
                  :secrets="secrets"
                  :image-gen-config="config.imageGen"
                    :manage-credentials="false"
                    @change-domain="handleDomainPresetsChange"
                    @save-template="handleSaveTemplate"
                    @open-providers="modelSettingsTab = 'providers'"
                  />
              </div>
              </div>
              <template v-if="modelSettingsTab === 'image'">
                <NText tag="h2" class="model-settings-title">{{ t('settings.imageModels') }}</NText>
                <ImageModelPresetManager
                  :config="config.imageGen"
                  :secrets="secrets"
                  @change="handleImageModelsChange"
                  @open-providers="modelSettingsTab = 'providers'"
                />
              </template>
              </div>
            </div>
          </div>
        </ElTabPane>
        <ElTabPane name="capability-config">
          <template #label>
            <span class="ai-settings-tab-label">
              <NIcon :component="BuildOutline" />
              <span>{{ t('settings.tabs.capability') }}</span>
            </span>
          </template>
          <FeatureSettingsTabs
            panel="capability-config"
            :config="config"
            :layered-config="layeredConfig?.layers"
            @patch="patchConfig"
            @refresh-layered="loadAll"
          />
        </ElTabPane>
        <ElTabPane v-for="tab in FEATURE_TAB_META" :key="tab.key" :name="tab.key">
          <template #label>
            <span class="ai-settings-tab-label">
              <NIcon :component="tab.icon" />
              <span>{{ t(tab.labelKey) }}</span>
            </span>
          </template>
          <FeatureSettingsTabs
            :panel="tab.key"
            :config="config"
            :layered-config="layeredConfig?.layers"
            @patch="patchConfig"
            @refresh-layered="loadAll"
          />
        </ElTabPane>
      </ElTabs>
    </div>
    <ElDialog v-model="setupWizardOpen" :title="t('settings.setupWizardTitle')" width="720px" class="model-setup-wizard">
      <ElSteps :active="setupWizardStep" align-center class="model-setup-wizard-steps">
        <ElStep :title="t('settings.provider')" />
        <ElStep :title="t('settings.agentModels')" />
        <ElStep :title="t('settings.imageModels')" />
      </ElSteps>
      <div class="model-setup-wizard-content">
        <ElForm v-if="setupWizardStep === 0" label-position="top" class="setup-wizard-form">
          <div class="setup-wizard-intro">
            <NText strong>{{ t('settings.wizardChooseProviderTitle') }}</NText>
            <NText depth="3">{{ t('settings.wizardChooseProviderLead') }}</NText>
          </div>
          <ElFormItem
            v-if="configuredProviderOptions.length > 0"
            :label="t('settings.providerConnection')"
            required
          >
            <CottageSelect
              v-model="setupWizardForm.providerConnection"
              :options="setupWizardProviderOptions"
              :placeholder="t('settings.selectProvider')"
            />
          </ElFormItem>
          <template v-if="setupWizardForm.providerConnection === WIZARD_NEW_PROVIDER">
            <div class="setup-wizard-grid">
              <ElFormItem :label="t('settings.provider')" required>
                <CottageSelect
                  v-model="setupWizardForm.newProvider"
                  :options="providerDefinitionOptions"
                />
              </ElFormItem>
              <ElFormItem :label="t('settings.aliasOptional')">
                <ElInput
                  v-model="setupWizardForm.providerAlias"
                  :placeholder="t('settings.wizardProviderAliasPlaceholder')"
                />
              </ElFormItem>
            </div>
            <ElFormItem label="API Key" required>
              <ElInput
                v-model="setupWizardForm.apiKey"
                type="password"
                show-password
                autocomplete="off"
                :placeholder="t('settings.apiKeyPlaceholder')"
              />
            </ElFormItem>
            <ElFormItem :label="t('settings.baseUrlOptional')">
              <ElInput
                v-model="setupWizardForm.baseUrl"
                :placeholder="t('settings.baseUrlCustomPlaceholder')"
              />
              <NText depth="3" class="setup-wizard-field-hint">{{ t('settings.baseUrlSimpleHint') }}</NText>
            </ElFormItem>
          </template>
          <div v-else class="setup-wizard-selection-note">
            <NText depth="3">{{ t('settings.wizardProviderWillBeReused') }}</NText>
          </div>
        </ElForm>

        <ElForm v-else-if="setupWizardStep === 1" label-position="top" class="setup-wizard-form">
          <div class="setup-wizard-intro">
            <NText strong>{{ t('settings.wizardConfigureAgentTitle') }}</NText>
            <NText depth="3">{{ t('settings.wizardConfigureAgentLead') }}</NText>
          </div>
          <div class="setup-wizard-summary">
            <span>{{ t('settings.providerConnection') }}</span>
            <strong>{{ selectedWizardConnectionLabel }}</strong>
          </div>
          <ElFormItem :label="t('settings.model')" required>
            <CottageSelect
              v-model="setupWizardForm.model"
              filterable
              allow-create
              :options="setupWizardModelOptions"
              :placeholder="t('settings.modelIdPlaceholder')"
            />
            <NText v-if="setupWizardModelsLoading" depth="3" class="setup-wizard-field-hint">
              {{ t('settings.fetchingModels') }}
            </NText>
            <NText v-else depth="3" class="setup-wizard-field-hint">
              {{ t('settings.wizardModelIdHint') }}
            </NText>
          </ElFormItem>
          <ElFormItem :label="t('settings.aliasOptional')">
            <ElInput v-model="setupWizardForm.modelAlias" :placeholder="t('settings.aliasPlaceholder')" />
          </ElFormItem>
          <details class="setup-wizard-advanced">
            <summary>{{ t('settings.advancedSettings') }}</summary>
            <div class="setup-wizard-grid setup-wizard-advanced-fields">
              <ElFormItem label="Temperature">
                <ElInputNumber v-model="setupWizardForm.temperature" :min="0" :max="2" :step="0.1" controls-position="right" />
              </ElFormItem>
              <ElFormItem :label="t('settings.maxTokensOptional')">
                <ElInputNumber v-model="setupWizardForm.maxTokens" :min="1" :step="256" controls-position="right" />
              </ElFormItem>
            </div>
            <ElFormItem :label="t('settings.reasoningEffortOptional')">
              <ElInput v-model="setupWizardForm.reasoningEffort" :placeholder="t('settings.reasoningEffortPlaceholder')" />
            </ElFormItem>
          </details>
        </ElForm>

        <ElForm v-else label-position="top" class="setup-wizard-form">
          <div class="setup-wizard-intro">
            <NText strong>{{ t('settings.wizardConfigureImageTitle') }}</NText>
            <NText depth="3">{{ t('settings.wizardConfigureImageLead') }}</NText>
          </div>
          <div class="setup-wizard-toggle-row">
            <div>
              <NText strong>{{ t('settings.wizardEnableImage') }}</NText>
              <NText depth="3">{{ t('settings.wizardEnableImageHint') }}</NText>
            </div>
            <ElSwitch v-model="setupWizardForm.configureImage" />
          </div>
          <template v-if="setupWizardForm.configureImage">
            <ElFormItem :label="t('settings.providerConnection')" required>
              <CottageSelect
                :model-value="setupWizardForm.imageProviderConnection"
                :options="configuredImageProviderOptions"
                :placeholder="t('settings.selectProvider')"
                @change="handleWizardImageProviderChange"
              />
              <button type="button" class="setup-wizard-text-action" @click="returnWizardToAddProvider">
                {{ t('settings.addProvider') }}
              </button>
            </ElFormItem>
            <ElFormItem :label="t('settings.imageGenModel')" required>
              <CottageSelect
                v-model="setupWizardForm.imageModel"
                filterable
                allow-create
                :options="setupWizardImageModelOptions"
              />
            </ElFormItem>
            <div class="setup-wizard-grid">
              <ElFormItem :label="t('settings.aliasOptional')">
                <ElInput v-model="setupWizardForm.imageAlias" />
              </ElFormItem>
              <ElFormItem :label="t('settings.imageGenDefaultSize')">
                <ElInput v-model="setupWizardForm.imageSize" placeholder="1024x1024" />
              </ElFormItem>
            </div>
          </template>
          <div v-else class="setup-wizard-skip-note">
            {{ t('settings.wizardImageCanBeAddedLater') }}
          </div>
        </ElForm>
      </div>
      <template #footer>
        <ElButton v-if="setupWizardStep > 0" @click="setupWizardStep -= 1">{{ t('common.previous') }}</ElButton>
        <ElButton
          v-if="setupWizardStep < 2"
          type="primary"
          :loading="setupWizardModelsLoading"
          @click="void handleSetupWizardNext()"
        >{{ t('common.next') }}</ElButton>
        <ElButton v-else type="primary" :loading="setupWizardSaving" @click="void finishSetupWizard()">
          {{ t('common.done') }}
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<style scoped>
.model-settings-layout {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  min-height: 360px;
}

.model-setup-wizard-steps {
  margin-bottom: 24px;
}

.model-setup-wizard-content {
  min-height: 320px;
}

.setup-wizard-form {
  max-width: 580px;
  margin: 0 auto;
}

.setup-wizard-intro {
  display: grid;
  gap: 4px;
  margin-bottom: 20px;
}

.setup-wizard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}

.setup-wizard-field-hint {
  display: block;
  width: 100%;
  margin-top: 6px;
  font-size: var(--cottage-font-xs);
  line-height: 1.45;
}

.setup-wizard-selection-note,
.setup-wizard-skip-note {
  padding: 12px 14px;
  border-radius: var(--cottage-radius-control);
  background: var(--cottage-surface-sunken, var(--cottage-bg));
  color: var(--cottage-ink-muted);
  font-size: var(--cottage-font-sm);
}

.setup-wizard-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  padding: 11px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--cottage-radius-control);
  background: var(--cottage-surface-sunken, var(--cottage-bg));
  color: var(--cottage-ink-muted);
  font-size: var(--cottage-font-sm);
}

.setup-wizard-summary strong {
  color: var(--cottage-ink);
  font-weight: 500;
}

.setup-wizard-advanced {
  margin-top: 4px;
  padding-top: 14px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.setup-wizard-advanced summary {
  color: var(--cottage-ink);
  cursor: pointer;
  font-size: var(--cottage-font-sm);
}

.setup-wizard-advanced-fields {
  margin-top: 16px;
}

.setup-wizard-advanced :deep(.el-input-number) {
  width: 100%;
}

.setup-wizard-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 20px;
  padding: 14px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--cottage-radius-control);
  background: var(--cottage-surface-sunken, var(--cottage-bg));
}

.setup-wizard-toggle-row > div {
  display: grid;
  gap: 4px;
}

.setup-wizard-text-action {
  margin-top: 8px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--el-color-primary);
  cursor: pointer;
  font: inherit;
  font-size: var(--cottage-font-sm);
}

.settings-status-surface {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
  padding: 12px 14px;
  background: var(--cottage-surface-sunken, var(--cottage-bg));
  border: 1px solid var(--cottage-border);
  border-radius: var(--cottage-radius-control);
}

.settings-status-surface :deep(.settings-health-card) {
  flex: 1;
  margin: 0;
  padding: 0;
  border: 0;
}

.model-settings-sidebar {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 2px;
  width: 148px;
  padding-right: 12px;
  border-right: 1px solid var(--el-border-color-lighter);
}

.model-settings-nav-item {
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: var(--cottage-radius);
  background: transparent;
  color: var(--cottage-ink);
  cursor: pointer;
  font-size: var(--cottage-font-sm);
  text-align: left;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.model-settings-nav-item:hover,
.model-settings-nav-item.is-active {
  background: var(--cottage-accent-bg);
}

.model-settings-nav-item.is-active {
  color: var(--el-color-primary);
  font-weight: 500;
}

.model-settings-main {
  flex: 1;
  min-width: 0;
}

.model-settings-title {
  display: block;
  margin: 0 0 var(--cottage-space-md);
  color: var(--cottage-ink);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

@media (max-width: 680px) {
  .setup-wizard-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .model-settings-layout {
    display: block;
  }

  .settings-status-surface {
    align-items: flex-start;
    flex-direction: column;
  }

  .model-settings-sidebar {
    flex-direction: row;
    width: auto;
    margin-bottom: 16px;
    padding: 0 0 12px;
    border-right: none;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }

  .model-settings-nav-item {
    width: auto;
  }
}
</style>
