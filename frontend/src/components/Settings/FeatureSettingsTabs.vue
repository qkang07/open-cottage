<script lang="ts">
import {
  FolderOutline,
  ImageOutline,
  TimeOutline,
  WifiOutline,
  } from '@vicons/ionicons5';
import type { Component } from 'vue';
export interface FeatureTabMeta {
  key: string;
  labelKey: string;
  icon: Component;
}
export const FEATURE_TAB_META: FeatureTabMeta[] = [
  { key: 'workspace-folders',
  labelKey: 'settings.tabs.workspaceFolders',
  icon: FolderOutline },
  { key: 'cottage-service',
  labelKey: 'settings.tabs.cottageService',
  icon: WifiOutline },
  { key: 'history',
  labelKey: 'settings.tabs.history',
  icon: TimeOutline },
  // [HIDDEN] 本地 embedding / 向量索引：默认不加载模型、不建库，暂不提供设置入口。
  // { key: 'rag', labelKey: 'settings.tabs.rag', icon: ServerOutline },
  { key: 'vision',
  labelKey: 'settings.tabs.vision',
  icon: ImageOutline },
  ];
</script>
<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ElAlert,
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElSwitch,
  ElMessage
} from 'element-plus';
import CottageSelect from '@/ui/CottageSelect.vue';
import {
  NText
} from '@/ui/element-plus-primitives';
import { providerLabel } from '../../config/llmProviders';
import { saveLayeredCottageConfig } from '../../config/cottageStorage';
import { workspace } from '../../workspace/FileSystemWorkspace';
import { useWorkspaceStore } from '../../stores/workspace';
import { initHistory, resetAutoCheckpoint } from '../../history/autoCheckpoint';
import type {
  CodingIndexConfig,
  CottageConfig,
  HistoryConfig,
  LayeredCottageConfigSchema,
  RagConfig,
  VisionConfig,
} from '../../config/constants';
import WorkspaceFolderManagerTab from './WorkspaceFolderManagerTab.vue';
import CottageServiceFields from './CottageServiceFields.vue';
import CapabilityConfigTab from './CapabilityConfigTab.vue';
const props = defineProps<{
  panel: string;
  config: CottageConfig;
  layeredConfig?: LayeredCottageConfigSchema['layers'];
}>();
const emit = defineEmits<{
  patch: [Partial<CottageConfig>];
  refreshLayered: [];
}>();
const { t } = useI18n();
const message = ElMessage;
const workspaceStore = useWorkspaceStore();
const history = () => props.config.history;
const rag = () => props.config.rag;
const embeddingProvider = computed(
  () => rag()?.embedding?.provider ?? 'local',
);
const modelPresetOptions = computed(() =>
  (props.config.modelPresets ?? []).map((preset) => ({
    value: preset.id,
    label: `${preset.name} (${providerLabel(preset.config.provider)}${t('common.listJoin')}${preset.config.model})`,
  })),
);
const embeddingProviderOptions = computed(() => [
  { value: 'local', label: t('settings.embeddingLocal') },
  { value: 'vendor', label: t('settings.embeddingVendor') },
]);
const localModelOptions = computed(() => [
  { value: 'minilm', label: t('settings.localModelMinilm') },
  { value: 'bge-small', label: t('settings.localModelBge') },
]);
const localDeviceOptions = computed(() => [
  { value: 'auto', label: t('settings.deviceAuto') },
  { value: 'webgpu', label: 'WebGPU' },
  { value: 'wasm', label: 'WASM' },
]);
const visionStorageOptions = computed(() => [
  { value: 'workspace-file', label: t('settings.storageWorkspaceFile') },
  { value: 'inline-base64', label: t('settings.storageInlineBase64') },
]);
const vision = () => props.config.vision;
const codingIndex = () => props.config.codingIndex;
const treeSitterParser = () => props.config.codingIndex?.parser;
// 未打开工作空间时无法写入 .cottage（folder 层），回退到域名（IndexedDB）层
const writableLevel = (): 'folder' | 'domain' =>
  workspace.isOpen ? 'folder' : 'domain';

function patchHistory(historyPatch: Partial<HistoryConfig>) {
  if (!workspace.isOpen) {
    message.warning(t('settings.historyRequiresWorkspace'));
    return;
  }
  const current = history() ?? {};
  const merged: HistoryConfig = {
    ...current,
    ...historyPatch,
    limits:
      historyPatch.limits !== undefined
        ? { ...current.limits, ...historyPatch.limits }
        : current.limits,
  };
  const next: HistoryConfig = {
    enabled: merged.enabled,
    autoCheckpoint: merged.autoCheckpoint,
    manualEditDebounceMs: merged.manualEditDebounceMs,
    trackGlobs: merged.trackGlobs,
    ignoreGlobs: merged.ignoreGlobs,
    maxTrackedFiles: merged.maxTrackedFiles,
    limits: merged.limits,
  };
  void saveLayeredCottageConfig({ history: next }, { level: 'folder' })
    .then(async () => {
      // 文件区依赖工作区 store 中的配置决定是否显示历史入口；写入后同步更新，
      // 不要求用户刷新页面或切换工作区。
      await workspaceStore.reloadCottageConfig();
      emit('patch', { history: next });
      emit('refreshLayered');
      if (next.enabled === true) await initHistory();
      else resetAutoCheckpoint();
    })
    .catch((error) => {
      message.error(error instanceof Error ? error.message : String(error));
    });
}

const bytesToMiB = (bytes: number | undefined, fallback: number) =>
  Math.round(((bytes ?? fallback) / 1024 / 1024) * 10) / 10;
const mibToBytes = (mib: number | null | undefined, fallback: number) =>
  Math.max(1, Math.round((mib ?? fallback) * 1024 * 1024));
function patchRag(ragPatch: Partial<RagConfig>) {
  const current = rag() ?? {};
  const next: RagConfig = {
    ...current,
    ...ragPatch,
    embedding:
      ragPatch.embedding !== undefined
        ? { ...current.embedding, ...ragPatch.embedding }
        : current.embedding,
    indexing:
      ragPatch.indexing !== undefined
        ? { ...current.indexing, ...ragPatch.indexing }
        : current.indexing,
    retrieval:
      ragPatch.retrieval !== undefined
        ? { ...current.retrieval, ...ragPatch.retrieval }
        : current.retrieval,
  };
  void saveLayeredCottageConfig({ rag: next }, { level: writableLevel() })
    .then(() => {
      emit('patch', { rag: next });
      emit('refreshLayered');
    })
    .catch((error) => {
      message.error(error instanceof Error ? error.message : String(error));
    });
}
function patchCodingIndex(patch: Partial<CodingIndexConfig>) {
  const current = codingIndex() ?? {};
  const next: CodingIndexConfig = {
    ...current,
    ...patch,
    parser:
      patch.parser !== undefined
        ? { ...current.parser, ...patch.parser }
        : current.parser,
  };
  void saveLayeredCottageConfig({ codingIndex: next }, { level: writableLevel() })
    .then(() => {
      emit('patch', { codingIndex: next });
      emit('refreshLayered');
    })
    .catch((error) => {
      message.error(error instanceof Error ? error.message : String(error));
    });
}
function arrayFromText(text: string) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}
function textFromArray(arr?: string[]) {
  return (arr ?? []).join('\n');
}
function patchVision(visionPatch: Partial<VisionConfig>) {
  const next: VisionConfig = { ...vision(), ...visionPatch };
  void saveLayeredCottageConfig({ vision: next }, { level: writableLevel() })
    .then(() => {
      emit('patch', { vision: next });
      emit('refreshLayered');
    })
    .catch((error) => {
      message.error(error instanceof Error ? error.message : String(error));
    });
}
</script>
<template>
  <!-- 工作区管理（列表型，不限宽） -->
  <div v-if="panel === 'workspace-folders'" class="settings-pane settings-pane--list">
    <WorkspaceFolderManagerTab />
  </div>
  <!-- Cottage Service（表单型） -->
  <div v-else-if="panel === 'cottage-service'" class="settings-pane settings-pane--form">
    <CottageServiceFields />
  </div>
  <!-- 版本历史 Beta（仅工作区层启用） -->
  <div v-else-if="panel === 'history'" class="settings-pane settings-pane--form">
    <NText depth="3" class="settings-panel-lead">
      {{ t('settings.historyLead') }}
    </NText>
    <ElAlert
      v-if="!workspace.isOpen"
      type="info"
      :closable="false"
      :title="t('settings.historyRequiresWorkspace')"
      style="margin-bottom: 16px"
    />
    <div v-if="workspace.isOpen" class="settings-section-block settings-section-block--flat">
    <ElForm label-position="top" class="ai-settings-form">
      <div class="ai-settings-switch-group">
      <ElFormItem :label="t('settings.enableLocalHistory')">
        <ElSwitch
          :model-value="history()?.enabled === true"
          :disabled="!workspace.isOpen"
          @update:model-value="(v) => patchHistory({ enabled: Boolean(v) })"
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.autoSnapshot')">
        <ElSwitch
          :model-value="history()?.autoCheckpoint ?? true"
          :disabled="!workspace.isOpen"
          @update:model-value="(v) => patchHistory({ autoCheckpoint: Boolean(v) })"
        />
        <NText depth="3" class="settings-form-item-hint">
          {{ t('settings.autoCheckpointHint') }}
        </NText>
      </ElFormItem>
      </div>
      <ElFormItem :label="t('settings.manualEditDebounceMs')">
        <ElInputNumber
          :model-value="history()?.manualEditDebounceMs ?? 1500"
          :disabled="!workspace.isOpen"
          :min="0"
          :step="100"
          @update:model-value="(v) => patchHistory({ manualEditDebounceMs: v ?? 0 })"
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.historyMaxFileMiB')">
        <ElInputNumber
          :model-value="bytesToMiB(history()?.limits?.maxFileBytes, 20 * 1024 * 1024)"
          :disabled="!workspace.isOpen"
          :min="1"
          :step="1"
          @update:model-value="(v) => patchHistory({ limits: {
            ...history()?.limits,
            maxFileBytes: mibToBytes(v, 20),
          } })"
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.historyMaxPerFileMiB')">
        <ElInputNumber
          :model-value="bytesToMiB(history()?.limits?.maxBytesPerFile, 100 * 1024 * 1024)"
          :disabled="!workspace.isOpen"
          :min="1"
          :step="10"
          @update:model-value="(v) => patchHistory({ limits: {
            ...history()?.limits,
            maxBytesPerFile: mibToBytes(v, 100),
          } })"
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.historyMaxPoolMiB')">
        <ElInputNumber
          :model-value="bytesToMiB(history()?.limits?.maxPoolBytes, 500 * 1024 * 1024)"
          :disabled="!workspace.isOpen"
          :min="1"
          :step="50"
          @update:model-value="(v) => patchHistory({ limits: {
            ...history()?.limits,
            maxPoolBytes: mibToBytes(v, 500),
          } })"
        />
        <NText depth="3" class="settings-form-item-hint">
          {{ t('settings.historyLimitsHint') }}
        </NText>
      </ElFormItem>
      <ElFormItem :label="t('settings.maxTrackedFiles')">
        <ElInputNumber
          :model-value="history()?.maxTrackedFiles ?? 10000"
          :disabled="!workspace.isOpen"
          :min="1"
          @update:model-value="(v) => patchHistory({ maxTrackedFiles: v ?? 10000 })"
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.trackGlobs')">
        <ElInput
          type="textarea"
          :disabled="!workspace.isOpen"
          :model-value="textFromArray(history()?.trackGlobs)"
          :rows="3"
          :placeholder="t('settings.trackGlobsPlaceholder')"
          @update:model-value="(v) => patchHistory({ trackGlobs: arrayFromText(String(v)) })"
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.ignoreGlobs')">
        <ElInput
          type="textarea"
          :disabled="!workspace.isOpen"
          :model-value="textFromArray(history()?.ignoreGlobs)"
          :rows="4"
          :placeholder="t('settings.ignoreGlobsPlaceholder')"
          @update:model-value="(v) => patchHistory({ ignoreGlobs: arrayFromText(String(v)) })"
        />
      </ElFormItem>
    </ElForm>
    </div>
  </div>
  <!-- RAG（表单型） -->
  <div v-else-if="panel === 'rag'" class="settings-pane settings-pane--form">
    <NText depth="3" class="settings-panel-lead">
      {{ t('settings.ragLead') }}
    </NText>
    <div class="settings-section-block settings-section-block--flat">
    <ElForm label-position="top" class="ai-settings-form">
      <div class="ai-settings-switch-group">
      <ElFormItem :label="t('settings.enableSemanticIndex')">
        <ElSwitch
          :model-value="rag()?.enabled ?? true"
          @update:model-value="(v) => patchRag({ enabled: Boolean(v) })"
        />
      </ElFormItem>
      </div>
      <ElFormItem :label="t('settings.embeddingMode')">
        <CottageSelect
          :model-value="rag()?.embedding?.provider ?? 'local'"
          :options="embeddingProviderOptions"
          @update:model-value="(v) =>
            patchRag({
              embedding: {
                ...rag()?.embedding,
                provider: (v ?? 'local') as 'local' | 'vendor',
              },
            })
          "
        />
      </ElFormItem>
      <template v-if="embeddingProvider === 'local'">
        <ElFormItem :label="t('settings.localModel')">
          <CottageSelect
            :model-value="rag()?.embedding?.localModel ?? 'minilm'"
            :options="localModelOptions"
            @update:model-value="(v) =>
              patchRag({
                embedding: {
                  ...rag()?.embedding,
                  localModel: (v ?? 'minilm') as 'minilm' | 'bge-small',
                },
              })
            "
          />
        </ElFormItem>
        <ElFormItem :label="t('settings.computeDevice')">
          <CottageSelect
            :model-value="rag()?.embedding?.localDevice ?? 'auto'"
            :options="localDeviceOptions"
            @update:model-value="(v) =>
              patchRag({
                embedding: {
                  ...rag()?.embedding,
                  localDevice: (v ?? 'auto') as 'auto' | 'webgpu' | 'wasm',
                },
              })
            "
          />
        </ElFormItem>
      </template>
      <template v-else>
        <ElFormItem :label="t('settings.modelConnection')">
          <CottageSelect
            v-if="modelPresetOptions.length"
            :model-value="rag()?.embedding?.vendorPresetId ?? ''"
            :options="modelPresetOptions"
            :placeholder="t('settings.selectConfiguredModel')"
            @update:model-value="(v) =>
              patchRag({
                embedding: {
                  ...rag()?.embedding,
                  vendorPresetId: (v ?? '') as string,
                },
              })
            "
          />
          <NText v-else depth="3" class="settings-form-item-hint">
            {{ t('settings.noModelsConfigured') }}
          </NText>
          <NText v-if="modelPresetOptions.length" depth="3" class="settings-form-item-hint">
            {{ t('settings.vendorEmbeddingHint') }}
          </NText>
        </ElFormItem>
        <ElFormItem v-if="modelPresetOptions.length" :label="t('settings.embeddingModelName')">
          <ElInput
            :model-value="rag()?.embedding?.vendorModel ?? ''"
            :placeholder="t('settings.embeddingModelPlaceholder')"
            @update:model-value="(v) =>
              patchRag({
                embedding: {
                  ...rag()?.embedding,
                  vendorModel: String(v ?? '').trim(),
                },
              })
            "
          />
          <NText depth="3" class="settings-form-item-hint">
            {{ t('settings.embeddingModelNote') }}
          </NText>
        </ElFormItem>
      </template>
      <ElFormItem :label="t('settings.chunkSize')">
        <ElInputNumber
          :model-value="rag()?.indexing?.chunkSize ?? 1000"
          :min="100"
          :step="100"
          @update:model-value="(v) =>
            patchRag({
              indexing: { ...rag()?.indexing, chunkSize: v ?? 1000 },
            })
          "
        />
      </ElFormItem>
      <div class="ai-settings-switch-group">
      <ElFormItem :label="t('settings.autoIncrementalIndex')">
        <ElSwitch
          :model-value="rag()?.indexing?.autoOnMutate ?? true"
          @update:model-value="(v) =>
            patchRag({
              indexing: { ...rag()?.indexing, autoOnMutate: Boolean(v) },
            })
          "
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.autoIndexOnOpen')">
        <ElSwitch
          :model-value="rag()?.indexing?.autoOnOpen ?? true"
          @update:model-value="(v) =>
            patchRag({
              indexing: { ...rag()?.indexing, autoOnOpen: Boolean(v) },
            })
          "
        />
      </ElFormItem>
      </div>
      <ElFormItem :label="t('settings.retrievalTopK')">
        <ElInputNumber
          :model-value="rag()?.retrieval?.topK ?? 5"
          :min="1"
          :max="50"
          @update:model-value="(v) =>
            patchRag({
              retrieval: { ...rag()?.retrieval, topK: v ?? 5 },
            })
          "
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.minScore')">
        <ElInputNumber
          :model-value="rag()?.retrieval?.minScore ?? 0.35"
          :min="0"
          :max="1"
          :step="0.05"
          @update:model-value="(v) =>
            patchRag({
              retrieval: { ...rag()?.retrieval, minScore: v ?? 0.35 },
            })
          "
        />
      </ElFormItem>
      <div class="ai-settings-switch-group">
      <ElFormItem :label="t('settings.agentSemanticTool')">
        <ElSwitch
          :model-value="rag()?.retrieval?.agentToolEnabled ?? true"
          @update:model-value="(v) =>
            patchRag({
              retrieval: { ...rag()?.retrieval, agentToolEnabled: Boolean(v) },
            })
          "
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.fallbackLexical')">
        <ElSwitch
          :model-value="rag()?.retrieval?.fallbackToLexical ?? true"
          @update:model-value="(v) =>
            patchRag({
              retrieval: { ...rag()?.retrieval, fallbackToLexical: Boolean(v) },
            })
          "
        />
      </ElFormItem>
      </div>
      <NText depth="3" class="settings-panel-lead">
        {{ t('settings.symbolIndexTitle') }}
      </NText>
      <div class="ai-settings-switch-group">
      <ElFormItem :label="t('settings.enableTreeSitter')">
        <ElSwitch
          :model-value="treeSitterParser()?.treeSitter ?? true"
          @update:model-value="(v) =>
            patchCodingIndex({ parser: { treeSitter: Boolean(v) } })
          "
        />
        <NText depth="3" class="settings-form-item-hint">
          {{ t('settings.treeSitterHint') }}
        </NText>
      </ElFormItem>
      </div>
      <ElFormItem :label="t('settings.wasmBaseUrl')">
        <ElInput
          :model-value="treeSitterParser()?.wasmBaseUrl ?? ''"
          :placeholder="t('settings.wasmBaseUrlPlaceholder')"
          @update:model-value="(v) =>
            patchCodingIndex({ parser: { wasmBaseUrl: String(v ?? '').trim() || undefined } })
          "
        />
        <NText depth="3" class="settings-form-item-hint">
          {{ t('settings.wasmBaseUrlHint') }}
        </NText>
      </ElFormItem>
    </ElForm>
    </div>
  </div>
  <!-- Vision（表单型） -->
  <div v-else-if="panel === 'vision'" class="settings-pane settings-pane--form">
    <NText depth="3" class="settings-panel-lead">
      {{ t('settings.visionLead') }}
    </NText>
    <div class="settings-section-block settings-section-block--flat">
    <ElForm label-position="top" class="ai-settings-form">
      <div class="ai-settings-switch-group">
      <ElFormItem :label="t('settings.enableImageInput')">
        <ElSwitch
          :model-value="vision()?.enabled ?? true"
          @update:model-value="(v) => patchVision({ enabled: Boolean(v) })"
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.requireModelCapability')">
        <ElSwitch
          :model-value="vision()?.requireModelCapability ?? true"
          @update:model-value="(v) => patchVision({ requireModelCapability: Boolean(v) })"
        />
        <NText depth="3" class="settings-form-item-hint">
          {{ t('settings.requireModelCapabilityHint') }}
        </NText>
      </ElFormItem>
      </div>
      <ElFormItem :label="t('settings.storageMode')">
        <CottageSelect
          :model-value="vision()?.storage ?? 'workspace-file'"
          :options="visionStorageOptions"
          @update:model-value="(v) => patchVision({ storage: v as VisionConfig['storage'] })"
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.maxImageBytes')">
        <ElInputNumber
          :model-value="vision()?.maxImageBytes ?? 4_000_000"
          :min="100_000"
          :step="500_000"
          @update:model-value="(v) => patchVision({ maxImageBytes: Number(v) || 4_000_000 })"
        />
      </ElFormItem>
      <ElFormItem :label="t('settings.maxDimensionPx')">
        <ElInputNumber
          :model-value="vision()?.maxDimensionPx ?? 2048"
          :min="256"
          :step="256"
          @update:model-value="(v) => patchVision({ maxDimensionPx: Number(v) || 2048 })"
        />
      </ElFormItem>
    </ElForm>
    </div>
  </div>
  <!-- 能力配置（列表型整体；内部表单段单独限宽） -->
  <div v-else-if="panel === 'capability-config'" class="settings-pane settings-pane--list">
    <CapabilityConfigTab
      :config="config"
      :layered-config="layeredConfig"
      @refresh-layered="emit('refreshLayered')"
    />
  </div>
</template>
