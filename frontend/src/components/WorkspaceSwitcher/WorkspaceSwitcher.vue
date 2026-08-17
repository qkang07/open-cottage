<script setup lang="ts">
import {
  CheckmarkOutline,
  ChevronDownOutline,
  FolderOpenOutline,
  TimeOutline,
  } from '@vicons/ionicons5';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import type {
  DropdownOption
} from '@/ui/element-plus-types';

import CottageTooltip from '@/ui/CottageTooltip.vue';
import ContextMenuPanel from '@/ui/ContextMenuPanel.vue';
import { storeToRefs } from 'pinia';
import { computed, h, ref } from 'vue';
import type { RecentWorkspace } from '../../workspace/workspacePersistence';
import { useWorkspaceStore } from '../../stores/workspace';
const workspaceStore = useWorkspaceStore();
const {
  snapshot,
  activeWorkspaceId,
  recentWorkspaces,
  restoring,
  loading,
} = storeToRefs(workspaceStore);
const open = ref(false);
const triggerRef = ref<HTMLButtonElement | null>(null);
const menuPos = ref({ x: 0, y: 0 });
const formatOpenedAt = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
const folderNameFromPath = (path: string) => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return path;
  const segments = normalized.split('/');
  return segments[segments.length - 1] || path;
};
const displayWorkspaceName = (item: RecentWorkspace) =>
  item.alias?.trim() || folderNameFromPath(item.path) || item.name;
const activeWorkspaceAlias = computed(
  () =>
    recentWorkspaces.value.find((item) => item.id === activeWorkspaceId.value)?.alias?.trim() ??
    '',
);
const label = computed(
  () => activeWorkspaceAlias.value || snapshot.value?.rootName || '选择工作空间',
);
const menuOptions = computed((): DropdownOption[] => {
  const items: DropdownOption[] = [];
  if (recentWorkspaces.value.length > 0) {
    items.push(
      { key: 'recent-label', type: 'group', label: '最近打开' },
      ...recentWorkspaces.value.map((item) => ({
        key: item.id,
        icon: () =>
          h(NIcon, {
            component:
              item.id === activeWorkspaceId.value
                ? CheckmarkOutline
                : TimeOutline,
          }),
        label: () =>
          h(
            'div',
            {
              class: 'workspace-switcher-item',
            },
            [
            h(
              NText,
              {
                ellipsis: true,
                class: 'workspace-switcher-item-name',
              },
              { default: () => displayWorkspaceName(item) },
            ),
            h(
              NText,
              { depth: 3, class: 'workspace-switcher-meta' },
              { default: () => formatOpenedAt(item.lastOpenedAt) },
            ),
            ],
          ),
      })),
      { type: 'divider', key: 'divider' },
    );
  }
  items.push({
    key: 'open-new',
    icon: () => h(NIcon, { component: FolderOpenOutline }),
    label: '打开文件夹…',
  });
  return items;
});
function onMenuSelect(key: string) {
  if (key === 'recent-label' || key === 'divider') return;
  open.value = false;
  if (key === 'open-new') {
    void workspaceStore.openWorkspace();
    return;
  }
  if (key === activeWorkspaceId.value && snapshot.value) return;
  void workspaceStore.openRecentWorkspace(key);
}

function toggleMenu() {
  if (restoring.value) return;
  if (!open.value && triggerRef.value) {
    const rect = triggerRef.value.getBoundingClientRect();
    menuPos.value = { x: rect.left, y: rect.bottom + 4 };
  }
  open.value = !open.value;
}
</script>
<template>
  <CottageTooltip :content="label" placement="top" delay="lazy">
    <span>
      <button
        ref="triggerRef"
        type="button"
        class="workspace-switcher-trigger"
        :class="{ 'workspace-switcher-trigger-open': open }"
        :disabled="restoring"
        @click="toggleMenu"
      >
        <NIcon :component="FolderOpenOutline" />
        <NText
          ellipsis
          class="workspace-switcher-label"
          :depth="loading && !snapshot ? 3 : undefined"
        >
          {{ label }}
        </NText>
        <NIcon :component="ChevronDownOutline" class="workspace-switcher-caret" />
      </button>
    </span>
  </CottageTooltip>
  <ContextMenuPanel
    :show="open"
    :x="menuPos.x"
    :y="menuPos.y"
    :options="menuOptions"
    class-name="workspace-switcher-menu"
    @select="onMenuSelect(String($event))"
    @update:show="open = $event"
  />
</template>
