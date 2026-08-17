<script setup lang="ts">
import { Add, CreateOutline, KeyOutline, TrashOutline } from '@vicons/ionicons5';
import { ElButton, ElDialog, ElEmpty, ElForm, ElFormItem, ElInput, ElMessage } from 'element-plus';
import { NIcon, NText } from '@/ui/element-plus-primitives';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { LLM_PROVIDER_DEFINITIONS, normalizeProviderId, providerLabel, type LlmProviderId } from '../../config/llmProviders';
import { fetchProviderModels } from '../../config/modelCatalog';
import { getProviderConnections, saveProviderSecrets, type ProviderSecretEntry, type ProviderSecrets } from '../../config/secrets';
import CottageSelect from '@/ui/CottageSelect.vue';

const props = defineProps<{ secrets: ProviderSecrets }>();
const emit = defineEmits<{ changed: [] }>();
const { t } = useI18n();
const message = ElMessage;
const open = ref(false);
const provider = ref<LlmProviderId>('openai');
const editingId = ref<string | null>(null);
const editingOriginalKey = ref('');
const alias = ref('');
const apiKey = ref('');
const baseUrl = ref('');
const connectionCheck = ref<'idle' | 'checking' | 'connected' | 'unverified' | 'failed'>('idle');
const connectionCheckDetail = ref('');
let connectionCheckTimer: ReturnType<typeof setTimeout> | null = null;
let connectionCheckRequest = 0;
const providerOptions = computed(() => LLM_PROVIDER_DEFINITIONS.map((item) => ({ value: item.id, label: item.label })));
const configuredConnections = computed(() =>
  LLM_PROVIDER_DEFINITIONS.flatMap((provider) =>
    getProviderConnections(props.secrets, provider.id).map((connection) => ({
      providerId: provider.id,
      label: connection.alias || provider.label,
      connection,
    })),
  ),
);

function resetConnectionCheck() {
  connectionCheckRequest += 1;
  if (connectionCheckTimer) {
    clearTimeout(connectionCheckTimer);
    connectionCheckTimer = null;
  }
  connectionCheck.value = 'idle';
  connectionCheckDetail.value = '';
}

function markKeyChanged() {
  // 输入新 Key 后，旧检查结果立即失效；不要取消刚触发的 paste 检查。
  connectionCheckRequest += 1;
  connectionCheck.value = 'idle';
  connectionCheckDetail.value = '';
}

function scheduleConnectionCheck() {
  if (connectionCheckTimer) clearTimeout(connectionCheckTimer);
  // paste 事件发生时输入框的 v-model 还未更新，下一轮再读取完整 Key。
  connectionCheckTimer = setTimeout(() => {
    connectionCheckTimer = null;
    void checkConnection();
  }, 0);
}

async function checkConnection() {
  const key = apiKey.value.trim();
  if (!key) return;
  const request = ++connectionCheckRequest;
  connectionCheck.value = 'checking';
  connectionCheckDetail.value = '';
  try {
    const result = await fetchProviderModels({
      providerId: provider.value,
      apiKey: key,
      secretBaseUrl: baseUrl.value.trim() || undefined,
      force: true,
    });
    if (request !== connectionCheckRequest) return;
    if (result.source === 'provider_api') {
      connectionCheck.value = 'connected';
      connectionCheckDetail.value = t('settings.providerCheckConnected', { count: result.models.length });
    } else if (result.error) {
      connectionCheck.value = 'failed';
      connectionCheckDetail.value = t('settings.providerCheckFailed', { error: result.error });
    } else {
      connectionCheck.value = 'unverified';
      connectionCheckDetail.value = t('settings.providerCheckUnverified');
    }
  } catch (error) {
    if (request !== connectionCheckRequest) return;
    connectionCheck.value = 'failed';
    connectionCheckDetail.value = t('settings.providerCheckFailed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function connectionIdFor(providerId: LlmProviderId, entry: ProviderSecretEntry): string | undefined {
  if (entry.id) return entry.id;
  // 旧版单 Key 配置没有连接 ID；编辑时使用和迁移逻辑一致的稳定 ID，
  // 这样改 Key 会替换原配置，而不是被当成一条新增连接。
  const legacy = props.secrets[providerId];
  return legacy?.apiKey === entry.apiKey ? `legacy_${providerId}` : undefined;
}

function openEditor(id?: LlmProviderId, entry?: ProviderSecretEntry) {
  resetConnectionCheck();
  provider.value = id ?? 'openai';
  editingId.value = id && entry ? connectionIdFor(id, entry) ?? null : null;
  editingOriginalKey.value = entry?.apiKey.trim() ?? '';
  alias.value = entry?.alias ?? '';
  apiKey.value = entry?.apiKey ?? '';
  baseUrl.value = entry?.baseUrl ?? '';
  open.value = true;
}

async function save() {
  if (!apiKey.value.trim()) return;
  const storedConnections = props.secrets.providerConnections?.[provider.value] ?? [];
  const legacyConnection = props.secrets[provider.value];
  // 将旧的单 Key 配置一并纳入去重与迁移。相同厂商下，API Key 是唯一键。
  const current = [
    ...(legacyConnection ? [{ ...legacyConnection, id: legacyConnection.id ?? `legacy_${provider.value}` }] : []),
    ...storedConnections,
  ];
  const normalizedKey = apiKey.value.trim();
  const originalKey = editingOriginalKey.value;
  const sameKey = current.find((item) => item.apiKey.trim() === normalizedKey);
  const id = editingId.value ?? sameKey?.id ?? `connection_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const entry: ProviderSecretEntry = {
    id,
    alias: alias.value.trim() || undefined,
    apiKey: normalizedKey,
    baseUrl: baseUrl.value.trim() || undefined,
  };
  const connections = [
    ...current.filter(
      (item) =>
        item.id !== id &&
        item.apiKey.trim() !== normalizedKey &&
        (!originalKey || item.apiKey.trim() !== originalKey),
    ),
    entry,
  ];
  const nextSecrets: ProviderSecrets = {
    ...props.secrets,
    providerConnections: { ...props.secrets.providerConnections, [provider.value]: connections },
  };
  // 迁移完成后移除旧格式，避免同一 Key 再次作为“默认”出现。
  delete nextSecrets[provider.value];
  await saveProviderSecrets(nextSecrets);
  open.value = false;
  message.success(t('settings.providerSaved'));
  emit('changed');
}

async function remove(providerId: LlmProviderId, entry: ProviderSecretEntry) {
  const id = connectionIdFor(providerId, entry);
  const key = entry.apiKey.trim();
  if (!id && !key) return;
  try {
    const legacyConnection = props.secrets[providerId];
    const current = [
      ...(legacyConnection
        ? [{ ...legacyConnection, id: legacyConnection.id ?? `legacy_${providerId}` }]
        : []),
      ...(props.secrets.providerConnections?.[providerId] ?? []),
    ];
    // 历史连接可能没有 id；同一服务商下 API Key 已是唯一键，故可安全作为回退标识。
    const next = current.filter(
      (item) => (id ? item.id !== id : true) && item.apiKey.trim() !== key,
    );
    const nextSecrets: ProviderSecrets = {
      ...props.secrets,
      providerConnections: { ...props.secrets.providerConnections, [providerId]: next },
    };
    delete nextSecrets[providerId];
    await saveProviderSecrets(nextSecrets);
    emit('changed');
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}
</script>

<template>
  <div class="provider-manager">
    <div class="provider-manager-lead">
      <NText depth="3">{{ t('settings.providerLead') }}</NText>
      <ElButton type="primary" @click="openEditor()"><template #icon><NIcon :component="Add" /></template>{{ t('settings.addProvider') }}</ElButton>
    </div>
    <ElEmpty v-if="configuredConnections.length === 0" :description="t('settings.noProviders')" />
    <div v-else class="provider-manager-list">
      <div v-for="item in configuredConnections" :key="item.connection.id || `${item.providerId}-${item.connection.apiKey}`" class="provider-manager-row">
        <span><NIcon :component="KeyOutline" /> {{ item.label }}</span>
        <div><ElButton text @click="openEditor(item.providerId, item.connection)"><template #icon><NIcon :component="CreateOutline" /></template>{{ t('common.edit') }}</ElButton><ElButton text type="danger" @click="void remove(item.providerId, item.connection)"><template #icon><NIcon :component="TrashOutline" /></template>{{ t('common.delete') }}</ElButton></div>
      </div>
    </div>
    <ElDialog v-model="open" :title="t('settings.providerConfigTitle')" width="500px">
      <ElForm label-position="top">
        <ElFormItem :label="t('settings.provider')"><CottageSelect v-model="provider" :disabled="Boolean(editingId)" :options="providerOptions" @change="(v) => openEditor(normalizeProviderId(String(v)))" /></ElFormItem>
        <ElFormItem :label="t('settings.aliasOptional')"><ElInput v-model="alias" /></ElFormItem>
        <ElFormItem :label="`API Key（${providerLabel(provider)}）`"><ElInput v-model="apiKey" type="password" show-password autocomplete="off" @update:model-value="markKeyChanged" @paste="scheduleConnectionCheck" /><div v-if="connectionCheck !== 'idle'" class="provider-connection-check" :class="`is-${connectionCheck}`"><span>{{ connectionCheck === 'checking' ? t('settings.providerCheckRunning') : connectionCheckDetail }}</span><ElButton v-if="connectionCheck !== 'checking'" text @click="void checkConnection()">{{ t('settings.providerCheckAgain') }}</ElButton></div></ElFormItem>
        <ElFormItem :label="t('settings.baseUrlOptional')"><ElInput v-model="baseUrl" :placeholder="t('settings.baseUrlCustomPlaceholder')" @update:model-value="resetConnectionCheck" /></ElFormItem>
      </ElForm>
      <template #footer><ElButton @click="open = false">{{ t('common.cancel') }}</ElButton><ElButton type="primary" :disabled="!apiKey.trim()" @click="void save()">{{ t('common.save') }}</ElButton></template>
    </ElDialog>
  </div>
</template>

<style scoped>
.provider-manager-lead{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px}.provider-manager-list{display:grid}.provider-manager-row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid var(--el-border-color-lighter)}.provider-manager-row span{display:flex;align-items:center;gap:8px}.provider-connection-check{display:flex;align-items:center;gap:6px;width:100%;margin-top:7px;font-size:var(--cottage-font-xs);line-height:1.4}.provider-connection-check.is-checking,.provider-connection-check.is-unverified{color:var(--cottage-muted)}.provider-connection-check.is-connected{color:var(--el-color-success)}.provider-connection-check.is-failed{color:var(--el-color-warning)}.provider-connection-check :deep(.el-button){height:auto;padding:0;font-size:inherit}
</style>
