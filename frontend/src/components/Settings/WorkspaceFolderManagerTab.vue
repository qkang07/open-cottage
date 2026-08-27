<script setup lang="ts">
import {
  AddOutline,
  CheckmarkOutline,
  EllipsisHorizontalOutline,
  FolderOpenOutline,
  ServerOutline,
  TimeOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import {
  ElButton,
  ElCard,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElInput,
  ElMessage,
  ElMessageBox,
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NText,
} from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import type { RecentWorkspace } from '../../workspace/workspacePersistence';
import { VIRTUAL_WORKSPACE_ID } from '../../workspace/VirtualWorkspace';

const { t } = useI18n();
const message = ElMessage;
const workspaceStore = useWorkspaceStore();
const { recentWorkspaces, activeWorkspaceId, loading } = storeToRefs(workspaceStore);
const { virtualWorkspaceUsageBytes } = storeToRefs(workspaceStore);
const aliasDraftMap = ref<Record<string, string>>({});
const loadingMap = ref<Record<string, boolean>>({});
const adding = ref(false);

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
};

const formatOpenedAt = (timestamp: number) =>
  new Date(timestamp).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

const folderNameFromPath = (path: string) => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return path;
  const segments = normalized.split('/');
  return segments[segments.length - 1] || path;
};

const displayTitle = (item: RecentWorkspace) =>
  item.alias?.trim() || folderNameFromPath(item.path) || item.name;

const displayPath = (item: RecentWorkspace) => item.path || item.name;

const aliasDraft = (item: RecentWorkspace) =>
  aliasDraftMap.value[item.id] ?? item.alias ?? '';

const updateAliasDraft = (id: string, value: string) => {
  aliasDraftMap.value = {
    ...aliasDraftMap.value,
    [id]: value,
  };
};

const saveAlias = async (item: RecentWorkspace) => {
  const nextAlias = aliasDraft(item).trim();
  const currentAlias = item.alias?.trim() ?? '';
  if (nextAlias === currentAlias) return;
  loadingMap.value = { ...loadingMap.value, [item.id]: true };
  try {
    workspaceStore.updateRecentWorkspaceAlias(item.id, nextAlias);
    message.success(nextAlias ? t('settings.aliasUpdated') : t('settings.aliasCleared'));
  } finally {
    loadingMap.value = { ...loadingMap.value, [item.id]: false };
  }
};

const addFolder = async () => {
  adding.value = true;
  try {
    await workspaceStore.addWorkspaceToRecent();
    message.success(t('settings.workspaceAdded'));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    adding.value = false;
  }
};

const confirmRemove = (item: RecentWorkspace) => {
  const title = displayTitle(item);
  void ElMessageBox.confirm(
    item.id === activeWorkspaceId.value
      ? t('settings.removeWorkspaceConfirmActive', { title })
      : t('settings.removeWorkspaceConfirm', { title }),
    t('settings.removeWorkspaceTitle'),
    {
      confirmButtonText: t('common.remove'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    },
  )
    .then(async () => {
      try {
        await workspaceStore.removeRecentWorkspace(item.id);
        message.success(t('settings.workspaceRemoved'));
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    })
    .catch(() => undefined);
};

const openFolder = (item: RecentWorkspace) => {
  if (item.id === activeWorkspaceId.value) return;
  void workspaceStore.openRecentWorkspace(item.id).catch((error) => {
    message.error(error instanceof Error ? error.message : String(error));
  });
};

const isActive = (item: RecentWorkspace) => item.id === activeWorkspaceId.value;

const openVirtualWorkspace = () => {
  if (activeWorkspaceId.value === VIRTUAL_WORKSPACE_ID) return;
  void workspaceStore.openVirtualWorkspace().catch((error) => {
    message.error(error instanceof Error ? error.message : String(error));
  });
};

const confirmClearVirtualWorkspace = () => {
  void ElMessageBox.confirm(
    t('settings.clearVirtualWorkspaceConfirm'),
    t('settings.clearVirtualWorkspaceTitle'),
    {
      confirmButtonText: t('settings.clearVirtualWorkspace'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
    },
  )
    .then(async () => {
      await workspaceStore.resetVirtualWorkspace();
      message.success(t('settings.virtualWorkspaceCleared'));
    })
    .catch((error) => {
      if (error === 'cancel' || error === 'close') return;
      message.error(error instanceof Error ? error.message : String(error));
    });
};

const handleCardCommand = (item: RecentWorkspace, command: string | number | object) => {
  const cmd = String(command);
  if (cmd === 'delete') confirmRemove(item);
};
</script>

<template>
  <div class="workspace-folder-manager">
    <ElCard
      :class="[
        'workspace-folder-card',
        'workspace-virtual-card',
        { 'workspace-folder-card-active': activeWorkspaceId === VIRTUAL_WORKSPACE_ID },
      ]"
      :body-style="{ padding: '12px 14px' }"
      shadow="never"
    >
      <div class="workspace-folder-card-content">
        <div class="workspace-folder-card-header">
          <div class="workspace-folder-card-title">
            <NIcon :component="ServerOutline" class="workspace-folder-icon" />
            <NText strong class="workspace-folder-title-text">
              {{ t('settings.virtualWorkspace') }}
            </NText>
          </div>
          <CottageTooltip
            :content="activeWorkspaceId === VIRTUAL_WORKSPACE_ID ? t('common.current') : t('settings.switchWorkspaceAction')"
            placement="top"
          >
            <ElButton
              class="workspace-folder-select-btn"
              :type="activeWorkspaceId === VIRTUAL_WORKSPACE_ID ? 'primary' : 'default'"
              :plain="activeWorkspaceId !== VIRTUAL_WORKSPACE_ID"
              circle
              size="small"
              @click="openVirtualWorkspace"
            >
              <template #icon><NIcon :component="CheckmarkOutline" /></template>
            </ElButton>
          </CottageTooltip>
        </div>
        <NText depth="3">{{ t('settings.virtualWorkspaceDescription') }}</NText>
        <NText depth="3">
          {{ t('settings.virtualWorkspaceUsage', { size: formatBytes(virtualWorkspaceUsageBytes) }) }}
        </NText>
        <div class="workspace-folder-card-footer">
          <ElButton text type="danger" size="small" @click="confirmClearVirtualWorkspace">
            <template #icon><NIcon :component="TrashOutline" /></template>
            {{ t('settings.clearVirtualWorkspace') }}
          </ElButton>
        </div>
      </div>
    </ElCard>
    <div class="workspace-folder-manager-toolbar">
      <NText depth="3" class="workspace-folder-manager-hint">
        {{ t('settings.rememberedWorkspacesHint', { n: recentWorkspaces.length }) }}
      </NText>
      <ElButton
        type="primary"
        size="small"
        :loading="adding || loading"
        @click="addFolder"
      >
        <template #icon>
          <NIcon :component="AddOutline" />
        </template>
        {{ t('settings.addWorkspace') }}
      </ElButton>
    </div>
    <ElEmpty
      v-if="recentWorkspaces.length === 0"
      :description="t('settings.noSavedFolders')"
    >
      <ElButton type="primary" :loading="adding" @click="addFolder">
        <template #icon>
          <NIcon :component="FolderOpenOutline" />
        </template>
        {{ t('settings.addWorkspace') }}
      </ElButton>
    </ElEmpty>
    <div v-else class="workspace-folder-grid">
      <ElCard
        v-for="item in recentWorkspaces"
        :key="item.id"
        :class="[
          'workspace-folder-card',
          { 'workspace-folder-card-active': isActive(item) },
        ]"
        :body-style="{ padding: '12px 14px' }"
        shadow="hover"
      >
        <div class="workspace-folder-card-content">
          <div class="workspace-folder-card-header">
            <div class="workspace-folder-card-title">
              <NIcon :component="FolderOpenOutline" class="workspace-folder-icon" />
              <NText strong :ellipsis="{ tooltip: true }" class="workspace-folder-title-text">
                {{ displayTitle(item) }}
              </NText>
            </div>
            <CottageTooltip
              :content="
                isActive(item)
                  ? t('common.current')
                  : t('settings.switchWorkspaceAction')
              "
              placement="top"
            >
              <ElButton
                class="workspace-folder-select-btn"
                :type="isActive(item) ? 'primary' : 'default'"
                :plain="!isActive(item)"
                circle
                size="small"
                @click="openFolder(item)"
              >
                <template #icon>
                  <NIcon :component="CheckmarkOutline" />
                </template>
              </ElButton>
            </CottageTooltip>
          </div>
          <div class="workspace-folder-card-main">
            <div class="workspace-folder-card-meta">
              <NIcon :component="TimeOutline" class="workspace-folder-meta-icon" />
              <NText depth="3" class="workspace-folder-meta-text">
                {{ t('settings.lastOpened', { time: formatOpenedAt(item.lastOpenedAt) }) }}
              </NText>
            </div>
            <NText
              depth="3"
              :ellipsis="{ tooltip: true }"
              class="workspace-folder-path-text"
            >
              {{ displayPath(item) }}
            </NText>
            <ElInput
              :model-value="aliasDraft(item)"
              size="small"
              :placeholder="t('settings.folderAliasPlaceholder')"
              :disabled="Boolean(loadingMap[item.id])"
              @update:model-value="(v) => updateAliasDraft(item.id, String(v))"
              @keyup.enter="saveAlias(item)"
              @blur="saveAlias(item)"
            />
          </div>
          <div class="workspace-folder-card-footer">
            <ElDropdown trigger="click" @command="(cmd) => handleCardCommand(item, cmd)">
              <span>
                <CottageTooltip :content="t('common.moreActions')" placement="top" delay="normal">
                  <ElButton text circle size="small">
                    <template #icon>
                      <NIcon :component="EllipsisHorizontalOutline" />
                    </template>
                  </ElButton>
                </CottageTooltip>
              </span>
              <template #dropdown>
                <ElDropdownMenu>
                  <ElDropdownItem command="delete">
                    <NIcon :component="TrashOutline" class="workspace-folder-menu-icon" />
                    {{ t('common.delete') }}
                  </ElDropdownItem>
                </ElDropdownMenu>
              </template>
            </ElDropdown>
          </div>
        </div>
      </ElCard>
    </div>
  </div>
</template>

<style scoped>
.workspace-folder-menu-icon {
  margin-right: 6px;
  font-size: 14px;
  vertical-align: middle;
}
</style>
