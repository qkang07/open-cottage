<script setup lang="ts">
import {
  BuildOutline,
  CloseOutline,
  HardwareChipOutline } from '@vicons/ionicons5';
import {
  ElButton,
  ElForm,
  ElTabPane,
  ElTabs,
  ElMessage
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  type CottageConfig,
  type LayeredCottageConfigSchema,
  type ModelPreset,
  type ModelTemplate,
} from '../../config/constants';
import {
  loadLayeredCottageConfig,
  saveLayeredCottageConfig,
  setEffectiveActivePresetForLayer,
} from '../../config/cottageStorage';
import { normalizeProviderId, providerLabel } from '../../config/llmProviders';
import {
  loadProviderSecrets,
  saveProviderSecrets,
  setPresetApiKey,
  type ProviderSecretEntry,
  type ProviderSecrets,
} from '../../config/secrets';
import { getCottageConfig, getModelPresets } from '../../config/store';
import { useAgentStore } from '../../stores/agent';
import { useWorkspaceStore } from '../../stores/workspace';
import FeatureSettingsTabs, { FEATURE_TAB_META } from './FeatureSettingsTabs.vue';
import ModelPresetManager from './ModelPresetManager.vue';
import LocaleSelect from '../LocaleSelect.vue';

const props = defineProps<{ embedded?: boolean }>();
const emit = defineEmits<{ closeEmbedded: [] }>();

const { t } = useI18n();
const message = ElMessage;
const workspaceStore = useWorkspaceStore();
const agentStore = useAgentStore();
const { snapshot, activeWorkspaceId } = storeToRefs(workspaceStore);

const open = ref(false);
const secrets = ref<ProviderSecrets>({});
const config = ref<CottageConfig>({});
const activeTab = ref('model-api');
const layeredConfig = ref<(LayeredCottageConfigSchema & { merged: CottageConfig }) | null>(null);
const domainPresets = ref<ModelPreset[]>([]);
const domainActivePresetId = ref<string | undefined>();
const modelTemplates = ref<ModelTemplate[]>([]);
const formModel = ref<Record<string, string>>({});

const visible = computed(() => props.embedded || open.value);

function resolveDefaultSelection(): { presetId: string } | undefined {
  // 设置里的默认模型只看 domain 层持久化值，不受输入框会话切换影响
  if (
    domainActivePresetId.value &&
    domainPresets.value.some((p) => p.id === domainActivePresetId.value)
  ) {
    return { presetId: domainActivePresetId.value };
  }
  return undefined;
}

const defaultSelection = computed(() => resolveDefaultSelection());

const effectiveDefaultPreset = computed(() => {
  const presetId = defaultSelection.value?.presetId;
  if (!presetId) return undefined;
  return domainPresets.value.find((p) => p.id === presetId);
});

const currentLlm = computed(
  () => effectiveDefaultPreset.value?.config ?? config.value.llm ?? getCottageConfig().llm,
);
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
  domainActivePresetId.value = domainState.resolvedActivePresetId;
}

watch(visible, (v) => {
  if (v) void loadAll();
});
watch(activeWorkspaceId, () => {
  if (visible.value) void loadAll();
});

function onKeyDown(event: KeyboardEvent) {
  if (!props.embedded && event.key === 'Escape') open.value = false;
}
onMounted(() => {
  if (visible.value) void loadAll();
  window.addEventListener('keydown', onKeyDown);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
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
  const latestSecrets = await loadProviderSecrets();
  const { stripped: strippedPresets, secrets: nextSecrets } = stripLayerPresets(
    domainPresets.value,
    latestSecrets,
  );
  await saveProviderSecrets(nextSecrets);
  secrets.value = nextSecrets;
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

function handleDomainPresetsChange(nextPresets: ModelPreset[], nextActiveId?: string) {
  domainPresets.value = nextPresets;
  if (nextActiveId !== undefined) domainActivePresetId.value = nextActiveId;
  void persistDomainPresets().catch((error) => {
    message.error(error instanceof Error ? error.message : String(error));
  });
}

async function handleSetDefault(presetId: string) {
  try {
    const saved = await setEffectiveActivePresetForLayer('domain', presetId);
    domainActivePresetId.value = presetId;

    const domainState = resolveLayerModelState(saved.layers.domain);
    domainPresets.value = withPresetApiKey(domainState.loadedPresets, secrets.value);
    domainActivePresetId.value = domainState.resolvedActivePresetId;

    await applyLayeredSnapshot(saved, { reloadAgent: true });
    message.success(t('settings.setAsDefault'));
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
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

</script>
<template>
  <div v-if="embedded && visible" class="panel preview-panel ai-settings-inline-panel">
    <div class="panel-header">
      <NText strong class="panel-header-title">{{ t('settings.title') }}</NText>
      <div class="ai-settings-header-actions">
        <LocaleSelect compact />
        <CottageTooltip :content="t('common.close')" placement="top">
          <ElButton class="cottage-icon-btn" @click="emit('closeEmbedded')">
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
            <ElForm :model="formModel" label-position="top" class="ai-settings-form">
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
                  :default-selection="defaultSelection"
                  :secrets="secrets"
                  :image-gen-config="config.imageGen"
                  @change-domain="handleDomainPresetsChange"
                  @set-default="handleSetDefault"
                  @save-template="handleSaveTemplate"
                />
              </div>
              <NText v-if="currentLlm" depth="3" style="display: block; margin-top: 16px">
                {{ t('settings.defaultForNewChat') }}
                {{ providerLabel(normalizeProviderId(currentLlm.provider)) }} /
                {{ currentLlm.model }}
                <template v-if="effectiveDefaultPreset && defaultSelection">
                  （{{ effectiveDefaultPreset.name || effectiveDefaultPreset.config.model }}）
                </template>
              </NText>
              <NText v-else depth="3">
                {{ t('settings.addModelToDefault') }}
              </NText>
            </ElForm>
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
  </div>
  <template v-else-if="!embedded">
    <CottageTooltip :content="t('settings.aiTitle')" placement="top" delay="normal">
      <ElButton text @click="open = true">{{ t('common.settings') }}</ElButton>
    </CottageTooltip>
    <div v-if="open" class="ai-settings-float-layer" @click="open = false">
      <div class="ai-settings-float-panel" @click.stop>
        <div class="ai-settings-float-header">
          <NText strong class="panel-header-title" style="font-size: 16px">{{ t('settings.aiTitle') }}</NText>
          <div class="ai-settings-header-actions">
            <LocaleSelect compact />
            <CottageTooltip :content="t('common.close')" placement="top">
              <ElButton class="cottage-icon-btn" @click="open = false">
                <template #icon>
                  <NIcon :component="CloseOutline" />
                </template>
              </ElButton>
            </CottageTooltip>
          </div>
        </div>
        <div class="ai-settings-float-body">
          <ElTabs v-model="activeTab" class="ai-settings-tabs">
            <ElTabPane name="model-api">
              <template #label>
                <span class="ai-settings-tab-label">
                  <NIcon :component="HardwareChipOutline" />
                  <span>{{ t('settings.tabs.modelApi') }}</span>
                </span>
              </template>
              <div class="settings-pane settings-pane--list">
                <ElForm :model="formModel" label-position="top" class="ai-settings-form">
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
                      :default-selection="defaultSelection"
                      :secrets="secrets"
                      :image-gen-config="config.imageGen"
                      @change-domain="handleDomainPresetsChange"
                      @set-default="handleSetDefault"
                      @save-template="handleSaveTemplate"
                    />
                  </div>
                  <NText v-if="currentLlm" depth="3" style="display: block; margin-top: 16px">
                    {{ t('settings.defaultForNewChat') }}
                    {{ providerLabel(normalizeProviderId(currentLlm.provider)) }} /
                    {{ currentLlm.model }}
                    <template v-if="effectiveDefaultPreset && defaultSelection">
                      （{{ effectiveDefaultPreset.name || effectiveDefaultPreset.config.model }}）
                    </template>
                  </NText>
                  <NText v-else depth="3">
                    {{ t('settings.addModelToDefault') }}
                  </NText>
                </ElForm>
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
      </div>
    </div>
  </template>
</template>
