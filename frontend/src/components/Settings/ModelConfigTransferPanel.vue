<script setup lang="ts">
import { ColorWandOutline, DownloadOutline, ShareOutline } from '@vicons/ionicons5';
import { ElButton, ElCheckbox, ElCheckboxGroup, ElDialog, ElInput, ElMessage, ElSwitch } from 'element-plus';
import { NIcon, NText } from '@/ui/element-plus-primitives';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ImageGenModelPreset, ModelPreset } from '../../config/constants';
import {
  buildModelConfigTransfer,
  decodeModelConfigTransfer,
  encodeModelConfigTransfer,
  type ModelConfigTransferBundle,
} from '../../config/modelConfigTransfer';
import type { ProviderSecrets } from '../../config/secrets';

const props = defineProps<{
  agentModels: ModelPreset[];
  imageModels: ImageGenModelPreset[];
  secrets: ProviderSecrets;
}>();
const emit = defineEmits<{
  imported: [bundle: ModelConfigTransferBundle];
  openSetup: [];
}>();
const { t } = useI18n();
const message = ElMessage;

const exportOpen = ref(false);
const importOpen = ref(false);
const includeApiKey = ref(false);
const viewRawContent = ref(false);
const selectedAgentIds = ref<string[]>([]);
const selectedImageIds = ref<string[]>([]);
const exportText = ref('');
const importText = ref('');
const copying = ref(false);
const importing = ref(false);

const selectedAgentModels = computed(() =>
  props.agentModels.filter((item) => selectedAgentIds.value.includes(item.id)),
);
const selectedImageModels = computed(() =>
  props.imageModels.filter((item) => selectedImageIds.value.includes(item.id)),
);
const selectedCount = computed(() => selectedAgentModels.value.length + selectedImageModels.value.length);

function openExport() {
  selectedAgentIds.value = [];
  selectedImageIds.value = [];
  includeApiKey.value = false;
  viewRawContent.value = false;
  exportText.value = '';
  exportOpen.value = true;
}

let exportGeneration = 0;

async function generateExport(showEmptyWarning = false) {
  const generation = ++exportGeneration;
  if (!selectedCount.value) {
    exportText.value = '';
    if (showEmptyWarning) message.warning(t('settings.transferSelectModel'));
    return;
  }
  const bundle = buildModelConfigTransfer(
    selectedAgentModels.value,
    selectedImageModels.value,
    props.secrets,
    { includeApiKey: includeApiKey.value },
  );
  if (viewRawContent.value) {
    exportText.value = JSON.stringify(bundle, null, 2);
    return;
  }
  const encoded = await encodeModelConfigTransfer(bundle);
  if (generation === exportGeneration) exportText.value = encoded;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // 剪贴板 API 仅在安全上下文可用；不可用或被拒绝权限时走 execCommand 降级。
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续尝试降级方案
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

async function copyExport() {
  if (copying.value) return;
  copying.value = true;
  try {
    await generateExport(true);
    if (!exportText.value) return;
    const copied = await copyToClipboard(exportText.value);
    if (copied) message.success(t('settings.exportCopied'));
    else message.error(t('settings.exportCopyFailed'));
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('settings.exportCopyFailed'));
  } finally {
    copying.value = false;
  }
}

watch([selectedAgentIds, selectedImageIds, includeApiKey, viewRawContent], () => {
  void generateExport().catch(() => {
    exportText.value = '';
  });
});

async function handleImport() {
  if (importing.value) return;
  importing.value = true;
  try {
    emit('imported', await decodeModelConfigTransfer(importText.value));
    importText.value = '';
    importOpen.value = false;
  } catch (error) {
    message.error(error instanceof Error ? error.message : t('settings.importFailed'));
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <div class="model-config-transfer-panel">
    <div class="model-config-transfer-actions">
      <ElButton @click="importOpen = true">
        <template #icon><NIcon :component="DownloadOutline" /></template>
        {{ t('settings.importConfig') }}
      </ElButton>
      <ElButton @click="openExport">
        <template #icon><NIcon :component="ShareOutline" /></template>
        {{ t('settings.exportConfig') }}
      </ElButton>
      <ElButton type="primary" @click="emit('openSetup')">
        <template #icon><NIcon :component="ColorWandOutline" /></template>
        {{ t('settings.setupWizardTitle') }}
      </ElButton>
    </div>
  </div>

  <ElDialog v-model="exportOpen" :title="t('settings.exportConfig')" width="600px">
    <NText depth="3" class="transfer-dialog-lead">{{ t('settings.transferExportHint') }}</NText>
    <div class="transfer-group">
      <strong>{{ t('settings.agentModels') }}</strong>
      <ElCheckboxGroup v-model="selectedAgentIds" class="transfer-check-list">
        <ElCheckbox v-for="item in agentModels" :key="item.id" :label="item.id">
          {{ item.name || item.config.model }}
        </ElCheckbox>
      </ElCheckboxGroup>
    </div>
    <div class="transfer-group">
      <strong>{{ t('settings.imageModels') }}</strong>
      <ElCheckboxGroup v-model="selectedImageIds" class="transfer-check-list">
        <ElCheckbox v-for="item in imageModels" :key="item.id" :label="item.id">
          {{ item.name || item.model }}
        </ElCheckbox>
      </ElCheckboxGroup>
    </div>
    <div class="transfer-key-switch">
      <span>{{ t('settings.exportIncludeApiKey') }}</span>
      <ElSwitch v-model="includeApiKey" />
    </div>
    <div class="transfer-key-switch">
      <span>{{ t('settings.transferViewRaw') }}</span>
      <ElSwitch v-model="viewRawContent" />
    </div>
    <NText v-if="includeApiKey" depth="3" class="transfer-warning">{{ t('settings.exportIncludeApiKeyWarn') }}</NText>
    <ElInput v-model="exportText" type="textarea" :rows="5" readonly :placeholder="t('settings.transferGenerateHint')" />
    <template #footer>
      <ElButton @click="exportOpen = false">{{ t('common.close') }}</ElButton>
      <ElButton type="primary" :loading="copying" @click="void copyExport()">{{ t('common.copy') }}</ElButton>
    </template>
  </ElDialog>

  <ElDialog v-model="importOpen" :title="t('settings.importConfig')" width="600px">
    <NText depth="3" class="transfer-dialog-lead">{{ t('settings.transferImportHint') }}</NText>
    <ElInput v-model="importText" type="textarea" :rows="6" :placeholder="t('settings.transferImportPlaceholder')" />
    <template #footer>
      <ElButton @click="importOpen = false">{{ t('common.cancel') }}</ElButton>
      <ElButton type="primary" :disabled="!importText.trim()" :loading="importing" @click="void handleImport()">{{ t('settings.importConfirm') }}</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.model-config-transfer-panel{display:flex;align-items:center}.model-config-transfer-actions{display:flex;gap:8px;flex:none}.transfer-dialog-lead{display:block;margin-bottom:16px;line-height:1.5}.transfer-group{display:grid;gap:8px;margin:16px 0}.transfer-check-list{display:grid;gap:8px}.transfer-key-switch{display:flex;align-items:center;justify-content:space-between;margin:16px 0 8px}.transfer-warning{display:block;margin-bottom:12px;color:var(--el-color-warning)}@media(max-width:600px){.model-config-transfer-actions{width:100%;flex-wrap:wrap}.model-config-transfer-actions :deep(.el-button){flex:1}}
</style>
