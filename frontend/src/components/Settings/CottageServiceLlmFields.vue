<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElSwitch, ElMessage } from 'element-plus';
import { NText } from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { useCottageServiceStore } from '../../stores/cottageService';
import { useAgentStore } from '../../stores/agent';
import { providerLabel, normalizeProviderId } from '../../config/llmProviders';

const props = defineProps<{
  provider: string;
}>();

const { t } = useI18n();
const message = ElMessage;
const cottageServiceStore = useCottageServiceStore();
const agentStore = useAgentStore();
const { status, useLlm, connectedBaseUrl, capabilities } =
  storeToRefs(cottageServiceStore);

const isConnected = computed(() => status.value === 'connected');

const providerId = computed(() => normalizeProviderId(props.provider));

const canUseHttpProxy = computed(
  () => isConnected.value && capabilities.value.includes('proxy'),
);

const httpProxyEnabled = computed({
  get: () => useLlm.value,
  set: (v: boolean) => {
    void handleToggle(Boolean(v));
  },
});

async function handleToggle(enabled: boolean) {
  await cottageServiceStore.setUseLlm(enabled);
  if (agentStore.activeChatId) {
    await agentStore.reloadSecrets({ remount: true });
  }
  message.success(
    enabled
      ? t('settings.cottageProxyEnabledToast')
      : t('settings.cottageProxyDisabledToast'),
  );
}
</script>

<template>
  <div v-if="canUseHttpProxy" class="cottage-proxy-panel">
    <div class="cottage-proxy-panel__row">
      <div class="cottage-proxy-panel__text">
        <span class="cottage-proxy-panel__title">{{ t('settings.viaCottageProxy') }}</span>
        <NText depth="3" class="cottage-proxy-panel__hint">
          {{
            t('settings.cottageProxyHint', {
              provider: providerLabel(providerId),
              url: connectedBaseUrl,
            })
          }}
        </NText>
      </div>
      <ElSwitch v-model="httpProxyEnabled" />
    </div>
  </div>
  <NText
    v-else-if="!isConnected"
    depth="3"
    class="cottage-proxy-connect-hint"
  >
    {{ t('settings.cottageProxyConnectHint') }}
  </NText>
</template>

<style scoped>
.cottage-proxy-panel {
  margin: -6px 0 18px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--cottage-surface-sunken);
  border: 1px solid color-mix(in srgb, var(--cottage-border) 70%, transparent);
}

.cottage-proxy-panel__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.cottage-proxy-panel__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.cottage-proxy-panel__title {
  font-size: var(--cottage-font-sm, 13px);
  font-weight: 500;
  line-height: 1.4;
  color: var(--el-text-color-primary);
}

.cottage-proxy-panel__hint {
  font-size: 12px;
  line-height: 1.45;
  margin: 0;
}

.cottage-proxy-panel :deep(.el-switch) {
  flex-shrink: 0;
  margin-top: 1px;
}

.cottage-proxy-connect-hint {
  display: block;
  margin: -8px 0 16px;
  font-size: 12px;
  line-height: 1.45;
}
</style>
