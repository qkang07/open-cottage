<script setup lang="ts">
import {
  ref } from 'vue';
import { ElConfigProvider
} from 'element-plus';
import { storeToRefs } from 'pinia';
import CottageContent from './components/Welcome/CottageContent.vue';
import { useLocaleStore } from './stores/locale';
import { useWorkspaceStore } from './stores/workspace';
import { onMounted, onUnmounted } from 'vue';

const showSettingsInPreview = ref(false);
const workspaceStore = useWorkspaceStore();
const localeStore = useLocaleStore();
const { elementLocale } = storeToRefs(localeStore);

onMounted(() => {
  void workspaceStore.tryRestoreLastWorkspace();
});

onUnmounted(() => {
  workspaceStore.revokePreviewUrlOnUnmount();
});
</script>

<template>
  <ElConfigProvider
    :locale="elementLocale"
  >
    <CottageContent
      :show-settings-in-preview="showSettingsInPreview"
      @open-settings-in-preview="showSettingsInPreview = true"
      @close-settings-in-preview="showSettingsInPreview = false"
    />
  </ElConfigProvider>
</template>

<style src="./App.css"></style>
