<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ElButton,
  ElForm,
  ElFormItem,
  ElInput,
  ElSwitch,
  ElTag,
  ElMessage,
} from 'element-plus';
import {
  NIcon,
  NSpace,
  NText,
} from '@/ui/element-plus-primitives';
import {
  AlertCircleOutline,
  CheckmarkCircle,
  CloseCircle,
  FlashOutline,
  LogoApple,
  LogoWindows,
  OpenOutline,
  SearchOutline,
  ServerOutline,
  SyncOutline,
} from '@vicons/ionicons5';
import { storeToRefs } from 'pinia';
import { useCottageServiceStore } from '../../stores/cottageService';
import { cottageServiceTrustUrl } from '../../cottageService/client';
import { useAgentStore } from '../../stores/agent';
import { getCottageConfig } from '../../config/store';
import { saveLayeredCottageConfig } from '../../config/cottageStorage';
import { workspace } from '../../workspace/FileSystemWorkspace';

const { t } = useI18n();

/** Cottage Service 桌面版下载地址（占位，待发布后填入） */
const COTTAGE_SERVICE_DOWNLOADS = {
  windows: '',
  macAppleSilicon: '',
  macIntel: '',
} as const;

const capabilityLabel = (id: string): string => {
  const map: Record<string, string> = {
    search: t('settings.cottageCapSearch'),
    fetch: t('settings.cottageCapFetch'),
    proxy: t('settings.cottageCapProxy'),
    llm: t('settings.cottageCapProxy'),
  };
  return map[id] ?? id;
};

const message = ElMessage;
const cottageServiceStore = useCottageServiceStore();
const agentStore = useAgentStore();
const { status, error, candidates, connectedBaseUrl, capabilities } =
  storeToRefs(cottageServiceStore);

const manualUrl = ref('');
const autoDiscover = ref(true);
const probing = computed(() => status.value === 'probing');
const connecting = computed(() => status.value === 'connecting');
const isConnected = computed(() => status.value === 'connected');

const capabilityLabels = computed(() =>
  capabilities.value.map((id) => capabilityLabel(id)),
);

/** 将 restore 阶段的报错文案调整为更贴合设置页语境 */
const friendlyError = computed(() => {
  const raw = error.value ?? '';
  if (!raw) return '';
  return raw.replace(
    t('settings.errorReconnectInSettings'),
    t('settings.errorReconnectConfirm'),
  );
});

/** 状态卡片的展示信息（图标 / 标题 / 描述 / 色调） */
const statusMeta = computed(() => {
  if (isConnected.value) {
    return {
      tone: 'connected',
      icon: CheckmarkCircle,
      title: t('settings.cottageConnected'),
      desc: connectedBaseUrl.value ?? '',
    };
  }
  if (probing.value) {
    return {
      tone: 'busy',
      icon: SyncOutline,
      title: t('settings.cottageDetecting'),
      desc: t('settings.cottageProbingDesc'),
    };
  }
  if (connecting.value) {
    return {
      tone: 'busy',
      icon: SyncOutline,
      title: t('settings.cottageConnecting'),
      desc: manualUrl.value,
    };
  }
  if (status.value === 'error') {
    return {
      tone: 'error',
      icon: AlertCircleOutline,
      title: t('settings.connectFailed'),
      desc: friendlyError.value,
    };
  }
  return {
    tone: 'idle',
    icon: CloseCircle,
    title: t('settings.cottageDisconnected'),
    desc: t('settings.cottageIdleDesc'),
  };
});

/** 仅在未连接且填写了 https 地址时，提示信任自签名证书 */
const showCertHelp = computed(
  () => !isConnected.value && manualUrl.value.trim().startsWith('https://'),
);

const writableLevel = (): 'folder' | 'domain' =>
  workspace.isOpen ? 'folder' : 'domain';

async function remountAgent() {
  if (!agentStore.activeChatId) return;
  await agentStore.reloadSecrets({ remount: true });
}

async function handleDiscover() {
  await cottageServiceStore.discover(
    manualUrl.value.trim() ? [manualUrl.value.trim()] : [],
  );
  if (candidates.value.length === 0) {
    message.warning(t('settings.discoverNone'));
  }
}

async function handleConnect(baseUrl: string) {
  const ok = await cottageServiceStore.connect(baseUrl);
  if (ok) {
    message.success(
      t('settings.cottageConnectedToast', {
        url: cottageServiceStore.connectedBaseUrl ?? baseUrl,
      }),
    );
    manualUrl.value = '';
    await remountAgent();
  } else {
    message.error(error.value ?? t('settings.connectFailed'));
  }
}

async function handleManualConnect() {
  const url = manualUrl.value.trim();
  if (!url || !/^https?:\/\/.+/.test(url)) {
    message.warning(t('settings.invalidServiceUrl'));
    return;
  }
  await handleConnect(url);
}

async function handleDisconnect() {
  await cottageServiceStore.disconnect();
  message.success(t('settings.cottageDisconnectedToast'));
  await remountAgent();
}

function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function handleDownload(platform: keyof typeof COTTAGE_SERVICE_DOWNLOADS) {
  const url = COTTAGE_SERVICE_DOWNLOADS[platform].trim();
  if (!url) {
    message.warning(t('settings.cottageServiceDownloadUnavailable'));
    return;
  }
  openInNewTab(url);
}

function openTrustCertPage(targetUrl?: string) {
  const url = (targetUrl ?? manualUrl.value).trim();
  if (!url || !/^https:\/\/.+/.test(url)) {
    message.warning(t('settings.needHttpsUrl'));
    return;
  }
  openInNewTab(cottageServiceTrustUrl(url));
}

async function toggleAutoDiscover(v: boolean | string | number) {
  autoDiscover.value = Boolean(v);
  await saveLayeredCottageConfig(
    { cottageService: { autoDiscover: Boolean(v) } },
    { level: writableLevel() },
  );
}

onMounted(() => {
  const cfg = getCottageConfig().cottageService;
  manualUrl.value = cfg?.baseUrl ?? '';
  autoDiscover.value = cfg?.autoDiscover ?? true;
});
</script>

<template>
  <NText depth="3" class="settings-panel-lead">
    {{ t('settings.cottageServiceLead') }}
  </NText>

  <!-- 软件下载 -->
  <div class="settings-section-block cottage-service-download">
    <NText tag="h3" class="settings-section-title settings-section-title--inline">
      {{ t('settings.cottageServiceDownload') }}
    </NText>
    <NText depth="3" class="settings-form-item-hint">
      {{ t('settings.cottageServiceDownloadHint') }}
    </NText>
    <NSpace :size="8" class="cottage-service-download-actions">
      <ElButton @click="handleDownload('windows')">
        <template #icon><NIcon :component="LogoWindows" /></template>
        {{ t('settings.cottageServiceDownloadWindows') }}
      </ElButton>
      <ElButton @click="handleDownload('macAppleSilicon')">
        <template #icon><NIcon :component="LogoApple" /></template>
        {{ t('settings.cottageServiceDownloadMacAppleSilicon') }}
      </ElButton>
      <ElButton @click="handleDownload('macIntel')">
        <template #icon><NIcon :component="LogoApple" /></template>
        {{ t('settings.cottageServiceDownloadMacIntel') }}
      </ElButton>
    </NSpace>
  </div>

  <!-- 连接状态卡片 -->
  <div
    class="cottage-service-status"
    :class="`cottage-service-status--${statusMeta.tone}`"
  >
    <span class="cottage-service-status-icon">
      <NIcon
        :component="statusMeta.icon"
        :class="{ 'cottage-service-spin': statusMeta.tone === 'busy' }"
      />
    </span>
    <div class="cottage-service-status-body">
      <div class="cottage-service-status-title">{{ statusMeta.title }}</div>
      <div v-if="statusMeta.desc" class="cottage-service-status-desc">
        {{ statusMeta.desc }}
      </div>
      <div v-if="isConnected && capabilityLabels.length" class="cottage-service-caps">
        <ElTag
          v-for="cap in capabilityLabels"
          :key="cap"
          size="small"
          type="success"
          effect="light"
        >
          {{ cap }}
        </ElTag>
      </div>
    </div>
    <ElButton
      v-if="isConnected"
      size="small"
      type="danger"
      plain
      @click="handleDisconnect"
    >
      {{ t('settings.disconnect') }}
    </ElButton>
  </div>

  <!-- 连接设置（已连接时收起，界面更清爽） -->
  <div v-if="!isConnected" class="settings-section-block">
    <NText tag="h3" class="settings-section-title settings-section-title--inline">
      {{ t('settings.connectionSettings') }}
    </NText>
    <ElForm label-position="top" class="ai-settings-form">
      <ElFormItem :label="t('settings.serviceUrl')">
        <ElInput
          v-model="manualUrl"
          :placeholder="t('settings.serviceUrlPlaceholder')"
        />
        <NSpace :size="8" style="margin-top: 8px">
          <ElButton
            size="small"
            type="primary"
            :loading="connecting"
            :disabled="!manualUrl.trim()"
            @click="handleManualConnect"
          >
            {{ t('settings.connect') }}
          </ElButton>
          <ElButton size="small" :loading="probing" @click="handleDiscover">
            <template #icon><NIcon :component="SearchOutline" /></template>
            {{ t('settings.detect') }}
          </ElButton>
        </NSpace>
      </ElFormItem>

      <ElFormItem :label="t('settings.scanLocalPorts')">
        <ElSwitch
          :model-value="autoDiscover"
          @update:model-value="toggleAutoDiscover"
        />
        <NText depth="3" class="settings-form-item-hint">
          {{ t('settings.scanLocalPortsHint') }}
        </NText>
      </ElFormItem>
    </ElForm>

    <!-- 自签名 HTTPS 证书：轻量提示 -->
    <div v-if="showCertHelp" class="cottage-service-cert-hint">
      <NIcon :component="OpenOutline" class="cottage-service-cert-hint-icon" />
      <span class="cottage-service-cert-hint-text">
        {{ t('settings.certHelpText') }}
      </span>
      <ElButton
        text
        type="primary"
        size="small"
        :disabled="!manualUrl.trim()"
        @click="openTrustCertPage()"
      >
        {{ t('settings.openTrustCert') }}
      </ElButton>
    </div>
  </div>

  <!-- 探测到的候选服务 -->
  <div v-if="candidates.length" class="settings-section-block cottage-service-candidates">
    <NText tag="h3" class="settings-section-title settings-section-title--inline">
      {{ t('settings.discoveredServices') }}
    </NText>
    <div
      v-for="c in candidates"
      :key="c.baseUrl"
      class="cottage-service-candidate"
    >
      <div class="cottage-service-candidate-main">
        <NSpace align="center" :size="6">
          <NIcon :component="c.ok ? ServerOutline : FlashOutline" />
          <NText strong>{{ c.baseUrl }}</NText>
          <ElTag v-if="c.ok" type="success" size="small">{{ t('settings.healthy') }}</ElTag>
          <ElTag v-else-if="c.certError" type="warning" size="small">{{ t('settings.certUntrusted') }}</ElTag>
          <NText v-if="c.latencyMs != null" depth="3" style="font-size: 12px">{{ c.latencyMs }}ms</NText>
        </NSpace>
        <NText depth="3" class="settings-form-item-hint">
          {{
            t('settings.capabilitiesList', {
              list:
                c.capabilities.map((id) => capabilityLabel(id)).join(t('common.listJoin')) ||
                '—',
            })
          }}
          <template v-if="c.engines?.length">
            ｜{{ t('settings.enginesList', { list: c.engines.join(t('common.listJoin')) }) }}
          </template>
        </NText>
      </div>
      <NSpace :size="8">
        <ElButton
          v-if="c.certError"
          size="small"
          type="warning"
          @click="openTrustCertPage(c.baseUrl)"
        >
          {{ t('settings.trustCertInNewWindow') }}
        </ElButton>
        <ElButton
          v-if="c.ok"
          size="small"
          type="primary"
          :loading="connecting"
          @click="handleConnect(c.baseUrl)"
        >
          {{ t('settings.connect') }}
        </ElButton>
        <ElButton size="small" @click="openInNewTab(c.baseUrl)">{{ t('common.open') }}</ElButton>
      </NSpace>
    </div>
  </div>
</template>

<style scoped>
/* 软件下载 */
.cottage-service-download-actions {
  margin-top: 10px;
}

/* 连接状态卡片 */
.cottage-service-status {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: var(--cottage-space-lg);
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-fill-color-lighter);
}
.cottage-service-status-icon {
  display: inline-flex;
  flex: none;
  margin-top: 1px;
  font-size: 22px;
  line-height: 1;
}
.cottage-service-status-body {
  flex: 1;
  min-width: 0;
}
.cottage-service-status-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.cottage-service-status-desc {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-text-color-secondary);
  word-break: break-all;
}
.cottage-service-caps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

/* 状态色调 */
.cottage-service-status--connected {
  border-color: var(--el-color-success-light-5);
  background: var(--el-color-success-light-9);
}
.cottage-service-status--connected .cottage-service-status-icon {
  color: var(--el-color-success);
}
.cottage-service-status--error {
  border-color: var(--el-color-danger-light-5);
  background: var(--el-color-danger-light-9);
}
.cottage-service-status--error .cottage-service-status-icon {
  color: var(--el-color-danger);
}
.cottage-service-status--busy .cottage-service-status-icon {
  color: var(--el-color-warning);
}
.cottage-service-status--idle .cottage-service-status-icon {
  color: var(--el-text-color-secondary);
}

.cottage-service-spin {
  animation: cottage-service-spin 1s linear infinite;
}
@keyframes cottage-service-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 自签名证书轻量提示 */
.cottage-service-cert-hint {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.cottage-service-cert-hint-icon {
  flex: none;
  color: var(--el-color-warning);
}
.cottage-service-cert-hint-text {
  flex: 1;
  min-width: 180px;
  line-height: 1.5;
}

/* 探测候选列表 */
.cottage-service-candidate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
  margin-bottom: 8px;
}
.cottage-service-candidate-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
