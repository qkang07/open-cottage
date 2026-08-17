<script setup lang="ts">
import CottageSelect from '@/ui/CottageSelect.vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { isAppLocale, LOCALE_OPTIONS, type AppLocale } from '../i18n';
import { useLocaleStore } from '../stores/locale';

const props = withDefaults(
  defineProps<{
    /** 仅显示短标签（侧栏等紧凑场景） */
    compact?: boolean;
  }>(),
  { compact: false },
);

const { t } = useI18n();
const localeStore = useLocaleStore();
const { locale } = storeToRefs(localeStore);

const options = computed(() =>
  LOCALE_OPTIONS.map((item) => ({
    value: item.value,
    label: props.compact
      ? item.value === 'zh-CN'
        ? '中文'
        : 'EN'
      : t(item.labelKey),
  })),
);

const selected = computed({
  get: () => locale.value,
  set: (value: string | number | null | undefined) => {
    if (typeof value === 'string' && isAppLocale(value)) {
      localeStore.setLocale(value as AppLocale);
    }
  },
});
</script>

<template>
  <CottageSelect
    v-model="selected"
    :options="options"
    :select-style="compact ? { width: '76px' } : { minWidth: '140px' }"
  />
</template>
