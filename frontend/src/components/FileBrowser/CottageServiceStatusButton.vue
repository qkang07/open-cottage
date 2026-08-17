<script setup lang="ts">
import { WifiOutline } from '@vicons/ionicons5';
import { ElButton } from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import { NIcon } from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useCottageServiceStore } from '../../stores/cottageService';

withDefaults(
  defineProps<{
    /** tooltip 方向 */
    placement?: 'top' | 'bottom' | 'left' | 'right';
  }>(),
  { placement: 'top' },
);

const emit = defineEmits<{
  click: [];
}>();

const { t } = useI18n();
const cottageServiceStore = useCottageServiceStore();
const { status, connectedBaseUrl, error } = storeToRefs(cottageServiceStore);

const tone = computed(() => {
  if (status.value === 'connected') return 'connected';
  if (status.value === 'probing' || status.value === 'connecting') return 'busy';
  if (status.value === 'error') return 'error';
  return 'idle';
});

const label = computed(() => {
  switch (status.value) {
    case 'connected':
      return connectedBaseUrl.value
        ? `${t('settings.cottageConnected')} · ${connectedBaseUrl.value}`
        : t('settings.cottageConnected');
    case 'probing':
      return t('settings.cottageDetecting');
    case 'connecting':
      return t('settings.cottageConnecting');
    case 'error':
      return error.value
        ? `${t('settings.connectFailed')}: ${error.value}`
        : t('settings.connectFailed');
    default:
      return t('settings.cottageDisconnected');
  }
});

const tooltip = computed(
  () => `${t('settings.tabs.cottageService')} — ${label.value}`,
);
</script>

<template>
  <CottageTooltip :content="tooltip" :placement="placement" delay="instant">
    <ElButton
      text
      class="collapsed-sidebar-btn cottage-service-status-btn"
      :class="`cottage-service-status-btn--${tone}`"
      :aria-label="tooltip"
      @click="emit('click')"
    >
      <template #icon>
        <span class="cottage-service-status-btn-icon">
          <NIcon :component="WifiOutline" />
          <span class="cottage-service-status-dot" aria-hidden />
        </span>
      </template>
    </ElButton>
  </CottageTooltip>
</template>
