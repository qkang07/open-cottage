<script setup lang="ts">
import {
  ChevronForwardOutline,
  DocumentTextOutline,
  FolderOutline,
  HomeOutline,
  LogoGithub,
  MoonOutline,
  SearchOutline,
  SettingsOutline,
  SunnyOutline,
} from '@vicons/ionicons5';
import {
  ElButton,
  ElPopover
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSidebarCollapseStore } from '../../stores/sidebarCollapse';
import { useThemeStore } from '../../stores/theme';
import { useWorkspaceStore } from '../../stores/workspace';
import { officialLinks } from '../../config/officialLinks';
import DebugPanel from '../DebugPanel/DebugPanel.vue';
import CottageServiceStatusButton from './CottageServiceStatusButton.vue';
import VirtualWorkspaceUsage from './VirtualWorkspaceUsage.vue';
const { t } = useI18n();
const emit = defineEmits<{
  openSettings: [tab?: string];
}>();
const sidebarStore = useSidebarCollapseStore();
const themeStore = useThemeStore();
const workspaceStore = useWorkspaceStore();
const { isDark } = storeToRefs(themeStore);
const { snapshot } = storeToRefs(workspaceStore);
const workspaceName = computed(() => snapshot.value?.rootName ?? '');
const workspaceFileCount = computed(() => snapshot.value?.files.length ?? 0);
</script>
<template>
  <div class="collapsed-sidebar-rail">
    <div class="collapsed-sidebar-rail-top">
      <span class="cottage-logo-wrapper collapsed-sidebar-logo">
        <img
          :src="isDark ? '/logo-dark.svg' : '/logo-light.svg'"
          alt="Open Cottage"
          class="cottage-logo"
        />
      </span>
      <CottageTooltip :content="t('layout.expandSidebar')" placement="right">
        <ElButton
          text
          class="collapsed-sidebar-btn"
          @click="sidebarStore.expandSidebar('files')"
        >
          <template #icon>
            <NIcon :component="ChevronForwardOutline" />
          </template>
        </ElButton>
      </CottageTooltip>
      <CottageTooltip :content="t('layout.backToWelcome')" placement="right">
        <ElButton
          text
          class="collapsed-sidebar-btn"
          @click="workspaceStore.closeWorkspace()"
        >
          <template #icon>
            <NIcon :component="HomeOutline" />
          </template>
        </ElButton>
      </CottageTooltip>
      <div class="collapsed-sidebar-divider" aria-hidden />
      <ElPopover
        trigger="hover"
        placement="right-start"
        popper-class="sidebar-info-popover sidebar-info-popover--compact"
        :show-arrow="false"
        :width="200"
        :open-delay="300"
      >
        <template #reference>
          <ElButton
            text
            class="collapsed-sidebar-btn"
            @click="sidebarStore.expandSidebar('files')"
          >
            <template #icon>
              <NIcon :component="FolderOutline" />
            </template>
          </ElButton>
        </template>
        <div class="sidebar-compact-info">
          <NText v-if="workspaceName" strong class="sidebar-compact-info-name">
            {{ workspaceName }}
          </NText>
          <NText v-else depth="3">{{ t('files.noWorkspaceYet') }}</NText>
          <div v-if="workspaceName" class="sidebar-compact-info-meta">
            <NText depth="3">{{ workspaceFileCount }} {{ t('files.filesCount') }}</NText>
          </div>
        </div>
      </ElPopover>
      <CottageTooltip :content="t('files.search')" placement="right">
        <ElButton
          text
          class="collapsed-sidebar-btn"
          @click="sidebarStore.expandSidebar('search')"
        >
          <template #icon>
            <NIcon :component="SearchOutline" />
          </template>
        </ElButton>
      </CottageTooltip>
    </div>
    <div class="collapsed-sidebar-rail-bottom">
      <VirtualWorkspaceUsage compact />
      <CottageTooltip :content="t('welcome.docs')" placement="right">
        <a
          class="collapsed-sidebar-btn"
          :href="officialLinks.docs"
          target="_blank"
          rel="noreferrer"
          :aria-label="t('welcome.docs')"
        >
          <NIcon :component="DocumentTextOutline" />
        </a>
      </CottageTooltip>
      <CottageTooltip content="GitHub" placement="right">
        <a
          class="collapsed-sidebar-btn"
          :href="officialLinks.source"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
        >
          <NIcon :component="LogoGithub" />
        </a>
      </CottageTooltip>
      <CottageTooltip :content="isDark ? t('theme.toLight') : t('theme.toDark')" placement="right">
        <ElButton
          text
          class="collapsed-sidebar-btn"
          @click="themeStore.toggle()"
        >
          <template #icon>
            <NIcon :component="isDark ? SunnyOutline : MoonOutline" />
          </template>
        </ElButton>
      </CottageTooltip>
      <DebugPanel compact />
      <CottageTooltip :content="t('common.settings')" placement="right">
        <ElButton
          text
          class="collapsed-sidebar-btn"
          @click="emit('openSettings')"
        >
          <template #icon>
            <NIcon :component="SettingsOutline" />
          </template>
        </ElButton>
      </CottageTooltip>
      <CottageServiceStatusButton
        placement="right"
        @click="emit('openSettings', 'cottage-service')"
      />
    </div>
  </div>
</template>
