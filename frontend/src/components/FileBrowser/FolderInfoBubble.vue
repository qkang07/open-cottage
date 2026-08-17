<script setup lang="ts">
import {
  FolderOpenOutline } from '@vicons/ionicons5';
import { ElButton,
  ElDivider
} from 'element-plus';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useSidebarCollapseStore } from '../../stores/sidebarCollapse';
import { useWorkspaceStore } from '../../stores/workspace';
import WorkspaceSwitcher from '../WorkspaceSwitcher/WorkspaceSwitcher.vue';
const workspaceStore = useWorkspaceStore();
const sidebarStore = useSidebarCollapseStore();
const { snapshot, selectedPath, loading } = storeToRefs(workspaceStore);
const countDirectories = (files: readonly string[]): number => {
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      dirs.add(parts.slice(0, index).join('/'));
    }
  }
  return dirs.size;
};
const folderCount = computed(() =>
  snapshot.value ? countDirectories(snapshot.value.files) : 0,
);
</script>
<template>
  <div v-if="!snapshot" class="sidebar-info-bubble">
    <NText depth="3">尚未打开工作区</NText>
  </div>
  <div v-else class="sidebar-info-bubble">
    <NText strong class="sidebar-info-bubble-title">
      {{ snapshot.rootName }}
    </NText>
    <NText depth="3" class="sidebar-info-bubble-desc">
      当前工作区
    </NText>
    <dl class="sidebar-info-bubble-meta">
      <div>
        <dt>文件</dt>
        <dd>{{ snapshot.files.length }}</dd>
      </div>
      <div>
        <dt>文件夹</dt>
        <dd>{{ folderCount }}</dd>
      </div>
      <div v-if="selectedPath">
        <dt>选中</dt>
        <dd>{{ selectedPath }}</dd>
      </div>
    </dl>
    <ElDivider style="margin: 12px 0" />
    <div class="sidebar-info-bubble-actions">
      <WorkspaceSwitcher />
      <ElButton
        type="primary"
        block
        :disabled="loading"
        @click="sidebarStore.expandSidebar('files')"
      >
        <template #icon>
          <NIcon :component="FolderOpenOutline" />
        </template>
        展开文件浏览器
      </ElButton>
    </div>
  </div>
</template>
