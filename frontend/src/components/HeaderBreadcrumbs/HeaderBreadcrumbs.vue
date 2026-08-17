<script setup lang="ts">
import {
  DocumentOutline,
  FolderOutline } from '@vicons/ionicons5';
import { ElBreadcrumb,
  ElBreadcrumbItem
} from 'element-plus';
import {
  NIcon
} from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useWorkspaceStore } from '../../stores/workspace';
import './HeaderBreadcrumbs.css';
const workspaceStore = useWorkspaceStore();
const { selectedPath } = storeToRefs(workspaceStore);
const parts = computed(() =>
  selectedPath.value ? selectedPath.value.split('/').filter(Boolean) : [],
);
</script>
<template>
  <div v-if="selectedPath" class="header-breadcrumbs">
    <ElBreadcrumb>
      <ElBreadcrumbItem v-for="(part, index) in parts" :key="`${part}-${index}`">
        <NIcon
          :component="index === parts.length - 1 ? DocumentOutline : FolderOutline"
          style="vertical-align: -0.125em"
        />
        <span style="margin-left: 4px">{{ part }}</span>
      </ElBreadcrumbItem>
    </ElBreadcrumb>
  </div>
</template>
