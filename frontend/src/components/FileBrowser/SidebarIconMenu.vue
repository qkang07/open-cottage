<script setup lang="ts">
import {
  AppsOutline,
  CreateOutline,
  FolderOutline,
  FolderOpenOutline,
  SearchOutline,
  TimeOutline,
} from '@vicons/ionicons5';

import CottageTooltip from '@/ui/CottageTooltip.vue';
import type { Component } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SidebarView } from './sidebarView';

defineProps<{
  activeView: SidebarView;
  explorerMode?: boolean;
  explorerDisabled?: boolean;
  historyEnabled?: boolean;
  createDisabled?: boolean;
}>();
const emit = defineEmits<{
  change: [view: SidebarView];
  toggleExplorer: [];
  openHistory: [];
  createFile: [];
  createFolder: [];
}>();
const { t } = useI18n();
const VIEWS: { key: SidebarView; icon: Component; label: string }[] = [
  { key: 'files', icon: FolderOutline, label: '文件浏览器' },
  { key: 'search', icon: SearchOutline, label: '搜索' },
];
</script>
<template>
  <div class="sidebar-icon-menu">
    <CottageTooltip
      v-for="{ key, icon: Icon, label } in VIEWS"
      :key="key"
      :content="label"
      placement="bottom"
    >
      <button
        type="button"
        :class="
          activeView === key
            ? 'sidebar-icon-menu-btn sidebar-icon-menu-btn-active'
            : 'sidebar-icon-menu-btn'
        "
        :aria-label="label"
        :aria-pressed="activeView === key"
        @click="emit('change', key)"
      >
        <component :is="Icon" />
      </button>
    </CottageTooltip>
    <CottageTooltip
      v-if="historyEnabled"
      :content="t('files.fileHistory')"
      placement="bottom"
    >
      <button
        type="button"
        class="sidebar-icon-menu-btn"
        :aria-label="t('files.fileHistory')"
        @click="emit('openHistory')"
      >
        <TimeOutline />
      </button>
    </CottageTooltip>
    <span class="sidebar-icon-menu-divider" aria-hidden />
    <CottageTooltip :content="t('files.newFileShort')" placement="bottom">
      <button
        type="button"
        class="sidebar-icon-menu-btn"
        :aria-label="t('files.newFileShort')"
        :disabled="createDisabled"
        @click="emit('createFile')"
      >
        <CreateOutline />
      </button>
    </CottageTooltip>
    <CottageTooltip :content="t('files.newFolder')" placement="bottom">
      <button
        type="button"
        class="sidebar-icon-menu-btn"
        :aria-label="t('files.newFolder')"
        :disabled="createDisabled"
        @click="emit('createFolder')"
      >
        <FolderOpenOutline />
      </button>
    </CottageTooltip>
    <span class="sidebar-icon-menu-divider" aria-hidden />
    <CottageTooltip
      :content="explorerMode ? '返回预览' : '文件管理器'"
      placement="bottom"
    >
      <button
        type="button"
        :class="
          explorerMode
            ? 'sidebar-icon-menu-btn sidebar-icon-menu-btn-active'
            : 'sidebar-icon-menu-btn'
        "
        :aria-label="explorerMode ? '返回预览' : '文件管理器'"
        :aria-pressed="explorerMode"
        :disabled="explorerDisabled"
        @click="emit('toggleExplorer')"
      >
        <AppsOutline />
      </button>
    </CottageTooltip>
  </div>
</template>
