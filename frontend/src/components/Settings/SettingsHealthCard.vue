<script setup lang="ts">
import { CheckmarkCircleOutline, WarningOutline } from '@vicons/ionicons5';
import { NIcon } from '@/ui/element-plus-primitives';
import { useI18n } from 'vue-i18n';

defineProps<{
  hasApiKey: boolean;
  serviceConnected: boolean;
}>();
const { t } = useI18n();
</script>

<template>
  <section class="settings-health-card" :aria-label="t('settings.connectionStatus')">
    <div class="settings-health-grid">
      <div class="settings-health-item" :class="{ 'is-ready': hasApiKey }">
        <NIcon :component="hasApiKey ? CheckmarkCircleOutline : WarningOutline" />
        <span>{{ t('settings.healthKey') }} · {{ hasApiKey ? t('settings.healthReady') : t('settings.healthNeedsAction') }}</span>
      </div>
      <div class="settings-health-item" :class="{ 'is-ready': serviceConnected }">
        <NIcon :component="serviceConnected ? CheckmarkCircleOutline : WarningOutline" />
        <span>{{ t('settings.healthService') }} · {{ serviceConnected ? t('settings.healthReady') : t('settings.healthOptional') }}</span>
      </div>
    </div>
  </section>
</template>
