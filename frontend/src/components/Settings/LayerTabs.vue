<script setup lang="ts">
import { ElTabPane, ElTabs } from 'element-plus';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
  folderLabel?: string;
  domainLabel?: string;
}>();

defineSlots<{
  folder(): unknown;
  domain(): unknown;
}>();

const { t } = useI18n();
const resolvedFolderLabel = computed(
  () => props.folderLabel ?? t('settings.layerWorkspace'),
);
const resolvedDomainLabel = computed(
  () => props.domainLabel ?? t('settings.layerGlobal'),
);

const activeLayer = ref<'folder' | 'domain'>('folder');
defineExpose({ activeLayer });
</script>

<template>
  <ElTabs v-model="activeLayer" class="layer-tabs">
    <ElTabPane name="folder">
      <template #label>
        <span class="layer-tab-label">{{ resolvedFolderLabel }}</span>
      </template>
      <slot name="folder" />
    </ElTabPane>
    <ElTabPane name="domain">
      <template #label>
        <span class="layer-tab-label">{{ resolvedDomainLabel }}</span>
      </template>
      <slot name="domain" />
    </ElTabPane>
  </ElTabs>
</template>

<style scoped>
.layer-tabs {
  width: 100%;
}
.layer-tab-label {
  font-size: 13px;
  font-weight: 500;
}
</style>
