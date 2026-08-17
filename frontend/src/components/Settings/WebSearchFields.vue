<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElButton, ElForm, ElFormItem, ElInput, ElMessage, ElSwitch } from 'element-plus';
import { storeToRefs } from 'pinia';
import CottageSelect from '@/ui/CottageSelect.vue';
import { NText } from '@/ui/element-plus-primitives';
import type { ThirdPartySearchProviderId } from '../../config/constants';
import { getCottageConfig } from '../../config/store';
import { saveLayeredCottageConfig } from '../../config/cottageStorage';
import {
  loadProviderSecrets,
  saveProviderSecrets,
  type ProviderSecrets,
} from '../../config/secrets';
import {
  THIRD_PARTY_SEARCH_PROVIDERS,
  thirdPartySearchProviderLabel,
} from '../../agent/thirdPartySearch';
import {
  COTTAGE_SERVICE_SEARCH_ENGINES,
  type CottageServiceSearchEngine,
} from '../../cottageService/client';
import { useAgentStore } from '../../stores/agent';
import { useCottageServiceStore } from '../../stores/cottageService';
import { useWorkspaceStore } from '../../stores/workspace';

const { t } = useI18n();
const message = ElMessage;
const workspaceStore = useWorkspaceStore();
const agentStore = useAgentStore();
const cottageServiceStore = useCottageServiceStore();
const { snapshot } = storeToRefs(workspaceStore);
const { status, useSearch, useFetch, capabilities, connectedBaseUrl } =
  storeToRefs(cottageServiceStore);

const isConnected = computed(() => status.value === 'connected');

const thirdPartyProvider = ref<ThirdPartySearchProviderId>('tavily');
const cottageEngine = ref<CottageServiceSearchEngine>('baidu');
const apiKey = ref('');
const secrets = ref<ProviderSecrets>({});
const savingKey = ref(false);

const providerLabel = computed(() =>
  thirdPartySearchProviderLabel(thirdPartyProvider.value),
);
const hasSavedKey = computed(() =>
  Boolean(secrets.value[thirdPartyProvider.value]?.apiKey),
);

const thirdPartyOptions = computed(() =>
  THIRD_PARTY_SEARCH_PROVIDERS.map((id) => ({
    value: id,
    label: thirdPartySearchProviderLabel(id),
  })),
);

const ENGINE_LABEL_KEYS: Record<
  CottageServiceSearchEngine,
  'settings.engineDuckduckgo' | 'settings.engineBing' | 'settings.engineBaidu' | 'settings.engineGoogle'
> = {
  duckduckgo: 'settings.engineDuckduckgo',
  bing: 'settings.engineBing',
  baidu: 'settings.engineBaidu',
  google: 'settings.engineGoogle',
};

const cottageEngineOptions = computed(() =>
  COTTAGE_SERVICE_SEARCH_ENGINES.map((id) => ({
    value: id,
    label: t(ENGINE_LABEL_KEYS[id]),
  })),
);

const canUseCottageSearch = computed(
  () => isConnected.value && capabilities.value.includes('search'),
);
const canUseCottageFetch = computed(
  () => isConnected.value && capabilities.value.includes('fetch'),
);

const cottageSearchEnabled = computed({
  get: () => useSearch.value,
  set: (v: boolean) => {
    void toggleCottageSearch(Boolean(v));
  },
});

const cottageFetchEnabled = computed({
  get: () => useFetch.value,
  set: (v: boolean) => {
    void toggleCottageFetch(Boolean(v));
  },
});

async function toggleCottageSearch(enabled: boolean) {
  await cottageServiceStore.setUseSearch(enabled);
  await remountAgent();
  message.success(
    enabled
      ? t('settings.cottageSearchViaService')
      : t('settings.cottageSearchViaBrowser'),
  );
}

async function toggleCottageFetch(enabled: boolean) {
  await cottageServiceStore.setUseFetch(enabled);
  await remountAgent();
  message.success(
    enabled
      ? t('settings.cottageFetchViaService')
      : t('settings.cottageFetchViaBrowser'),
  );
}

async function load() {
  secrets.value = await loadProviderSecrets();
  const cfg = getCottageConfig().webSearch;
  thirdPartyProvider.value = cfg?.thirdPartyProvider ?? 'tavily';
  cottageEngine.value = cfg?.engine ?? 'baidu';
  apiKey.value = '';
}
onMounted(load);

async function remountAgent() {
  if (!agentStore.activeChatId) return;
  await agentStore.reloadSecrets({ remount: true });
}

async function handleProviderChange(next: ThirdPartySearchProviderId) {
  const prev = thirdPartyProvider.value;
  thirdPartyProvider.value = next;
  apiKey.value = '';
  if (!snapshot.value) {
    message.warning(t('common.openWorkspaceFirst'));
    thirdPartyProvider.value = prev;
    return;
  }
  try {
    await saveLayeredCottageConfig(
      { webSearch: { thirdPartyProvider: next } },
      { level: 'folder' },
    );
    await remountAgent();
    message.success(t('settings.webSearchUpdated'));
  } catch (error) {
    thirdPartyProvider.value = prev;
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function handleEngineChange(next: CottageServiceSearchEngine) {
  const prev = cottageEngine.value;
  cottageEngine.value = next;
  if (!snapshot.value) {
    message.warning(t('common.openWorkspaceFirst'));
    cottageEngine.value = prev;
    return;
  }
  try {
    await saveLayeredCottageConfig(
      { webSearch: { engine: next } },
      { level: 'folder' },
    );
    await remountAgent();
    message.success(t('settings.webSearchUpdated'));
  } catch (error) {
    cottageEngine.value = prev;
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function saveKey() {
  if (!snapshot.value) {
    message.warning(t('common.openWorkspaceFirst'));
    return;
  }
  const key = apiKey.value.trim();
  if (!key) {
    message.warning(t('settings.enterThirdPartyKey'));
    return;
  }
  savingKey.value = true;
  try {
    const next: ProviderSecrets = {
      ...secrets.value,
      [thirdPartyProvider.value]: { apiKey: key },
    };
    await saveProviderSecrets(next);
    secrets.value = next;
    await saveLayeredCottageConfig(
      { webSearch: { thirdPartyProvider: thirdPartyProvider.value } },
      { level: 'folder' },
    );
    apiKey.value = '';
    await remountAgent();
    message.success(
      t('settings.thirdPartyKeySaved', { name: providerLabel.value }),
    );
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    savingKey.value = false;
  }
}
</script>

<template>
  <ElForm label-position="top" class="ai-settings-form">
    <ElFormItem :label="t('settings.thirdPartySearchSource')">
      <CottageSelect
        :model-value="thirdPartyProvider"
        :disabled="!snapshot"
        :options="thirdPartyOptions"
        @update:model-value="(v) => handleProviderChange(v as ThirdPartySearchProviderId)"
      />
      <NText depth="3" class="settings-form-item-hint">
        {{ t('settings.thirdPartySearchHint') }}
      </NText>
    </ElFormItem>

    <ElFormItem
      :label="hasSavedKey
        ? t('settings.thirdPartyKeyLabelSaved', { name: providerLabel })
        : t('settings.thirdPartyKeyLabel', { name: providerLabel })"
    >
      <ElInput
        v-model="apiKey"
        type="password"
        show-password
        :disabled="!snapshot"
        :placeholder="hasSavedKey ? t('settings.keepSavedKey') : t('settings.pasteApiKey')"
        autocomplete="off"
      />
      <ElButton
        type="primary"
        size="small"
        :loading="savingKey"
        :disabled="!snapshot"
        @click="void saveKey()"
      >
        {{ t('settings.saveKey') }}
      </ElButton>
    </ElFormItem>

    <ElFormItem :label="t('settings.searchEngine')">
      <CottageSelect
        :model-value="cottageEngine"
        :disabled="!snapshot"
        :options="cottageEngineOptions"
        @update:model-value="(v) => handleEngineChange(v as CottageServiceSearchEngine)"
      />
      <NText depth="3" class="settings-form-item-hint">
        {{ t('settings.cottageEngineHint') }}
      </NText>
    </ElFormItem>

    <ElFormItem v-if="canUseCottageSearch" :label="t('settings.viaCottageSearch')">
      <ElSwitch v-model="cottageSearchEnabled" :disabled="!snapshot" />
      <NText depth="3" class="settings-form-item-hint">
        {{ t('settings.cottageSearchHint', { url: connectedBaseUrl }) }}
      </NText>
    </ElFormItem>

    <ElFormItem v-if="canUseCottageFetch" :label="t('settings.viaCottageFetch')">
      <ElSwitch v-model="cottageFetchEnabled" :disabled="!snapshot" />
      <NText depth="3" class="settings-form-item-hint">
        {{ t('settings.cottageFetchHint') }}
      </NText>
    </ElFormItem>

    <ElFormItem v-if="!isConnected" label="Cottage Service">
      <NText depth="3" class="settings-form-item-hint">
        {{ t('settings.cottageServiceNotConnected') }}
      </NText>
    </ElFormItem>
  </ElForm>
</template>
