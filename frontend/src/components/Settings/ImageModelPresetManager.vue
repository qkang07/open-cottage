<script setup lang="ts">
import { Add, CreateOutline, ImageOutline, TrashOutline } from '@vicons/ionicons5';
import { ElButton, ElCard, ElDialog, ElEmpty, ElForm, ElFormItem, ElInput, ElMessage, ElTag } from 'element-plus';
import { NIcon, NText } from '@/ui/element-plus-primitives';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ImageGenConfig, ImageGenModelPreset } from '../../config/constants';
import { IMAGE_GEN_PROVIDER_IDS, defaultImageGenModel, imageGenModelsForProvider, loadOpenRouterImageModels, normalizeImageSizeLabel } from '../../imagegen/catalog';
import { providerLabel, type LlmProviderId } from '../../config/llmProviders';
import { getProviderConnections, type ProviderSecrets } from '../../config/secrets';
import { providerConnectionExists } from '../../config/llmKeyStatus';
import CottageSelect from '@/ui/CottageSelect.vue';

const props = defineProps<{ config?: ImageGenConfig; secrets: ProviderSecrets }>();
const emit = defineEmits<{ change: [config: ImageGenConfig]; openProviders: [] }>();
const { t } = useI18n();
const message = ElMessage;
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const form = ref({ name: '', provider: '' as LlmProviderId, connectionId: '', model: '', defaultSize: '1024x1024' });
const imageCatalogRevision = ref(0);
const presets = computed(() => props.config?.modelPresets ?? []);
const providerOptions = computed(() => IMAGE_GEN_PROVIDER_IDS.flatMap((id) =>
  getProviderConnections(props.secrets, id).map((connection) => ({
    value: `${id}::${connection.id ?? ''}`,
    label: `${providerLabel(id)} · ${connection.alias || t('settings.defaultBadge')}`,
  })),
));
const providerConnectionOptions = computed(() => {
  if (!editingId.value) return providerOptions.value;
  const providerPrefix = `${form.value.provider}::`;
  return providerOptions.value.filter((option) => option.value.startsWith(providerPrefix));
});
const formProviderConnectionMissing = computed(() =>
  Boolean(form.value.provider) &&
  (!form.value.connectionId.trim() ||
    !providerConnectionExists(form.value.provider, form.value.connectionId, props.secrets)),
);
const selectedProviderConnection = computed(() =>
  form.value.provider && !formProviderConnectionMissing.value
    ? `${form.value.provider}::${form.value.connectionId}`
    : null,
);
const modelOptions = computed(() => {
  // OpenRouter 目录异步写入模块缓存后，显式触发下拉选项重新计算。
  void imageCatalogRevision.value;
  const options = imageGenModelsForProvider(form.value.provider).map((item) => ({ value:item.id, label:item.label }));
  const selectedModel = form.value.model.trim();
  if (selectedModel && !options.some((option) => option.value === selectedModel)) {
    options.unshift({ value:selectedModel, label:selectedModel });
  }
  return options;
});
function itemConnectionMissing(item: ImageGenModelPreset) {
  // 未绑定连接的旧配置不能再静默回退到同服务商的任意凭据。
  return !item.connectionId?.trim() ||
    !providerConnectionExists(item.provider, item.connectionId, props.secrets);
}
function openAdd() { editingId.value=null; form.value={ name:'', provider:'' as LlmProviderId, connectionId:'', model:'', defaultSize:'1024x1024' }; dialogOpen.value=true; }
function openEdit(item: ImageGenModelPreset) { editingId.value=item.id; form.value={ name:item.name, provider:item.provider, connectionId:item.connectionId ?? '', model:item.model, defaultSize:item.defaultSize ?? '1024x1024' }; dialogOpen.value=true; }
function changeProvider(value: string | number | null | undefined) {
  const [providerId, connectionId=''] = String(value ?? '').split('::');
  const provider=providerId as LlmProviderId;
  form.value.provider=provider;
  form.value.connectionId=connectionId;
  // 编辑失效预设时只重新绑定连接，保留原模型让用户自行确认或替换。
  if (!editingId.value && !form.value.model.trim()) {
    form.value.model=defaultImageGenModel(provider)?.id ?? '';
  }
}
async function refreshOpenRouterImageCatalog() {
  try {
    await loadOpenRouterImageModels();
    imageCatalogRevision.value += 1;
  } catch {
    // 网络不可用时保留内置后备模型，配置仍可继续。
  }
}
watch(
  () => [dialogOpen.value, form.value.provider] as const,
  ([open, provider]) => {
    if (open && provider === 'openrouter') void refreshOpenRouterImageCatalog();
  },
);
function save() {
  if (!form.value.provider) {
    message.warning(t('settings.selectProvider'));
    return;
  }
  if (!form.value.model.trim()) return;
  if (formProviderConnectionMissing.value) {
    message.warning(t('settings.providerConnectionMissingEditHint'));
    return;
  }
  const id = editingId.value ?? `image_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const preset: ImageGenModelPreset = { id, name:form.value.name.trim(), provider:form.value.provider, connectionId:form.value.connectionId || undefined, model:form.value.model.trim(), defaultSize:normalizeImageSizeLabel(form.value.defaultSize) || '1024x1024' };
  const next = editingId.value ? presets.value.map((item) => item.id===id ? preset:item) : [...presets.value,preset];
  const activePreset = next.find((item) => !itemConnectionMissing(item));
  emit('change',{ ...props.config, modelPresets:next, activePresetId:activePreset?.id, providerOverride:activePreset?.provider ?? null, modelOverrides:activePreset ? { ...props.config?.modelOverrides, [activePreset.provider]:activePreset.model } : props.config?.modelOverrides, defaultSize:activePreset?.defaultSize ?? props.config?.defaultSize });
  dialogOpen.value=false; message.success(t('settings.imageModelSaved'));
}
function remove(item: ImageGenModelPreset) {
  const next = presets.value.filter((preset) => preset.id !== item.id);
  const active = next.find((preset) => !itemConnectionMissing(preset));
  emit('change', { ...props.config, modelPresets: next, activePresetId: active?.id, providerOverride: active?.provider ?? null, modelOverrides: active ? { ...props.config?.modelOverrides, [active.provider]: active.model } : props.config?.modelOverrides, defaultSize: active?.defaultSize ?? props.config?.defaultSize });
}
</script>
<template>
  <div class="image-model-manager">
    <div class="image-model-manager-lead">
      <NText depth="3">{{ t('settings.imageModelLead') }}</NText>
      <ElButton type="primary" @click="openAdd">
        <template #icon><NIcon :component="Add" /></template>
        {{ t('settings.addImageModel') }}
      </ElButton>
    </div>
    <ElEmpty v-if="presets.length===0" :description="t('settings.noImageModels')">
      <template #extra><ElButton type="primary" @click="openAdd">{{ t('settings.addImageModel') }}</ElButton></template>
    </ElEmpty>
    <div v-else class="model-preset-grid">
      <ElCard
        v-for="item in presets"
        :key="item.id"
        :class="[
          'model-preset-card',
          {
            'model-preset-card-unavailable': itemConnectionMissing(item),
          },
        ]"
        :body-style="{ padding: '12px 14px' }"
        shadow="hover"
      >
        <div class="model-preset-card-content">
          <div class="model-preset-card-header">
            <div class="model-preset-card-title">
              <NIcon :component="ImageOutline" class="model-preset-icon" />
              <NText strong :ellipsis="{ tooltip: true }" class="model-preset-title-text">
                {{ item.name || item.model }}
              </NText>
            </div>
          </div>
          <div class="model-preset-card-main">
            <div class="model-preset-card-meta">
              <NText depth="3" :ellipsis="{ tooltip: true }" class="model-preset-provider-text">
                {{ providerLabel(item.provider) }}
              </NText>
            </div>
            <NText depth="3" :ellipsis="{ tooltip: true }" class="model-preset-model-text">
              {{ item.model }}
            </NText>
            <ElTag class="image-model-size-tag" size="small" effect="plain">
              {{ item.defaultSize || '1024x1024' }}
            </ElTag>
          </div>
          <div class="model-preset-card-footer">
            <ElTag
              v-if="itemConnectionMissing(item)"
              class="model-preset-card-connection-missing"
              type="warning"
              size="small"
              effect="plain"
              @click="openEdit(item)"
            >
              {{ t('settings.providerConnectionMissing') }}
            </ElTag>
            <div class="model-preset-card-footer-actions">
              <ElButton text size="small" @click="openEdit(item)">
                <template #icon><NIcon :component="CreateOutline" /></template>
                {{ t('common.edit') }}
              </ElButton>
              <ElButton text size="small" type="danger" @click="remove(item)">
                <template #icon><NIcon :component="TrashOutline" /></template>
                {{ t('common.delete') }}
              </ElButton>
            </div>
          </div>
        </div>
      </ElCard>
    </div>
    <ElDialog v-model="dialogOpen" :title="t('settings.imageModelTitle')" width="500px"><ElForm label-position="top"><ElFormItem :label="t('settings.provider')"><CottageSelect :model-value="selectedProviderConnection" :options="providerConnectionOptions" @change="changeProvider" /><NText v-if="formProviderConnectionMissing" class="settings-form-item-hint settings-form-item-hint--warning">{{ t('settings.providerConnectionMissingEditHint') }}</NText><div class="image-model-action-row"><button type="button" class="image-model-text-action" @click="dialogOpen=false; emit('openProviders')">{{ t('settings.addProvider') }}</button></div></ElFormItem><ElFormItem :label="t('settings.imageGenModel')"><CottageSelect v-model="form.model" filterable allow-create :options="modelOptions" /></ElFormItem><ElFormItem :label="t('settings.aliasOptional')"><ElInput v-model="form.name" /></ElFormItem><ElFormItem :label="t('settings.imageGenDefaultSize')"><ElInput v-model="form.defaultSize" /></ElFormItem></ElForm><template #footer><ElButton @click="dialogOpen=false">{{ t('common.cancel') }}</ElButton><ElButton type="primary" @click="save">{{ t('common.save') }}</ElButton></template></ElDialog>
  </div>
</template>
<style scoped>
.image-model-manager-lead{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}
.image-model-size-tag{align-self:flex-start}
.image-model-action-row{flex-basis:100%;width:100%;margin-top:8px}
.image-model-text-action{padding:2px 0;border:0;background:transparent;color:var(--el-color-primary);cursor:pointer;font:inherit;font-size:var(--cottage-font-sm)}
.settings-form-item-hint{display:block;margin-top:4px;font-size:12px;line-height:1.4}
.settings-form-item-hint--warning{color:var(--el-color-warning)}
</style>
