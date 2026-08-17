<script setup lang="ts">
import {
  ChevronBackOutline,
  HomeOutline,
  MoonOutline,
  SettingsOutline,
  SunnyOutline } from '@vicons/ionicons5';
import { ElButton } from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ChatPanel from '../Chat/ChatPanel.vue';
import StagedChangesPanel from '../Chat/StagedChangesPanel.vue';
import FileBrowser from '../FileBrowser/FileBrowser.vue';
import NewEntryDialog from '../FileBrowser/NewEntryDialog.vue';
import FileExplorer from '../FileExplorer/FileExplorer.vue';
import CollapsedSidebarRail from '../FileBrowser/CollapsedSidebarRail.vue';
import CottageServiceStatusButton from '../FileBrowser/CottageServiceStatusButton.vue';
import Preview from '../Preview/Preview.vue';
import SettingsPanel from '../Settings/SettingsPanel.vue';
import DebugPanel from '../DebugPanel/DebugPanel.vue';
import WelcomePage from './WelcomePage.vue';
import { useExplorerModeStore } from '../../stores/explorerMode';
import {
  SIDEBAR_COLLAPSED_WIDTH,
  useSidebarCollapseStore,
} from '../../stores/sidebarCollapse';
import { useThemeStore } from '../../stores/theme';
import { useWorkspaceStore } from '../../stores/workspace';
import { useAgentStore } from '../../stores/agent';
import {
  getPendingStagedApproval,
  pendingStagedApprovalRevision,
} from '../../platform/staging';
const props = defineProps<{
  showSettingsInPreview?: boolean;
}>();
const emit = defineEmits<{
  openSettingsInPreview: [];
  closeSettingsInPreview: [];
}>();
const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const explorerModeStore = useExplorerModeStore();
const sidebarStore = useSidebarCollapseStore();
const themeStore = useThemeStore();
const agentStore = useAgentStore();
const { chat, activeChatId } = storeToRefs(agentStore);
const { snapshot, restoring, loading, selectedPath } = storeToRefs(workspaceStore);
const { explorerMode } = storeToRefs(explorerModeStore);
const { collapsed } = storeToRefs(sidebarStore);
const { isDark } = storeToRefs(themeStore);
const compactViewport = ref(false);
const showFocusedMain = computed(
  () => showMainPanel.value && !compactViewport.value,
);
/** 打开设置时定位到的 tab（如 cottage-service） */
const settingsInitialTab = ref<string | undefined>();
function openSettings(tab?: string) {
  settingsInitialTab.value = tab;
  if (!props.showSettingsInPreview) {
    emit('openSettingsInPreview');
  }
}
function closeSettings() {
  settingsInitialTab.value = undefined;
  emit('closeSettingsInPreview');
}
// 待审批项按「当前展示的 Agent 自身 sessionId」解析，而非全局活跃交互会话（后者可能漂移）
const stagedSessionId = computed<string | null>(
  () => chat.value?.getSessionId() ?? activeChatId.value ?? null,
);
const hasPendingStagedReview = computed(() => {
  void pendingStagedApprovalRevision.value;
  return Boolean(
    getPendingStagedApproval(stagedSessionId.value)?.store.pendingEntriesList()
      .length,
  );
});

watch(explorerMode, (active) => {
  if (active && props.showSettingsInPreview) {
    closeSettings();
  }
});

watch(selectedPath, (path, prev) => {
  if (path && path !== prev && props.showSettingsInPreview) {
    closeSettings();
  }
});
const leftWidth = ref(320);
const rightWidth = ref(520);
const contentRef = ref<HTMLElement | null>(null);
/** 用户是否手动拖过右侧分割条；拖过之后不再自动重算预览/聊天比例 */
let rightSplitUserAdjusted = false;
/** 中栏有实质内容（文件预览 / 资源管理器 / 暂存审批）时才显示预览区 */
const showMainPanel = computed(
  () =>
    Boolean(selectedPath.value) ||
    explorerMode.value ||
    hasPendingStagedReview.value,
);
function applyPreviewChatSplit() {
  if (rightSplitUserAdjusted || !showMainPanel.value) return;
  const el = contentRef.value;
  if (!el) return;
  const total = el.clientWidth;
  if (total <= 0) return;
  const available = total - sidebarWidth.value;
  if (available <= 0) return;
  // 预览:聊天 = 1:1
  rightWidth.value = Math.max(220, Math.round(available / 2));
}
const dragState = ref<{
  side: 'left' | 'right';
  startX: number;
  startWidth: number;
} | null>(null);
function stopDragging() {
  if (!dragState.value) return;
  dragState.value = null;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  document.body.classList.remove('is-resizing-panels');
}
function handleGlobalMouseMove(event: MouseEvent) {
  const drag = dragState.value;
  if (!drag) return;
  const delta =
    drag.side === 'left'
      ? event.clientX - drag.startX
      : drag.startX - event.clientX;
  const nextWidth =
    drag.side === 'left'
      ? Math.max(180, drag.startWidth + delta)
      : Math.max(220, drag.startWidth + delta);
  if (drag.side === 'left') {
    leftWidth.value = nextWidth;
  } else {
    rightWidth.value = nextWidth;
    rightSplitUserAdjusted = true;
  }
}
function handleMouseDown(side: 'left' | 'right', e: MouseEvent) {
  if (e.button !== 0) return;
  if (side === 'right' && !showMainPanel.value) return;
  e.preventDefault();
  stopDragging();
  dragState.value = {
    side,
    startX: e.clientX,
    startWidth: side === 'left' ? leftWidth.value : rightWidth.value,
  };
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.body.classList.add('is-resizing-panels');
}
function handleSplitterKeyDown(side: 'left' | 'right', event: KeyboardEvent) {
  const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  if (!direction) return;
  event.preventDefault();
  const delta = side === 'left' ? direction * 20 : -direction * 20;
  if (side === 'left') {
    leftWidth.value = Math.max(180, leftWidth.value + delta);
  } else {
    rightWidth.value = Math.max(220, rightWidth.value + delta);
    rightSplitUserAdjusted = true;
  }
}
function updateViewportLayout() {
  compactViewport.value = window.innerWidth < 980;
}
onMounted(() => {
  window.addEventListener('mousemove', handleGlobalMouseMove, true);
  window.addEventListener('mouseup', stopDragging, true);
  window.addEventListener('blur', stopDragging);
  document.addEventListener('mouseleave', stopDragging);
  updateViewportLayout();
  window.addEventListener('resize', updateViewportLayout);
});
onUnmounted(() => {
  window.removeEventListener('mousemove', handleGlobalMouseMove, true);
  window.removeEventListener('mouseup', stopDragging, true);
  window.removeEventListener('blur', stopDragging);
  document.removeEventListener('mouseleave', stopDragging);
  window.removeEventListener('resize', updateViewportLayout);
  stopDragging();
});
const sidebarWidth = computed(() =>
  collapsed.value || compactViewport.value ? SIDEBAR_COLLAPSED_WIDTH : leftWidth.value,
);
// 打开文件预览 / 资源管理器等中栏内容时，按 1:1 设定预览与聊天宽度
watch(
  [snapshot, showMainPanel, sidebarWidth],
  ([hasSnapshot]) => {
    if (hasSnapshot && showMainPanel.value) {
      void nextTick(applyPreviewChatSplit);
    }
  },
  { immediate: true },
);
</script>
<template>
  <div v-if="restoring || (loading && !snapshot)" class="cottage-welcome-shell">
    <div class="centered welcome-loading">
      <div class="loading-brand" aria-busy="true" aria-live="polite">
        <div class="loading-logo-ring">
          <img
            :src="isDark ? '/logo-dark.svg' : '/logo-light.svg'"
            alt="Open Cottage"
            class="loading-logo-img"
          />
        </div>
        <span class="loading-brand-name">Open Cottage</span>
        <span class="loading-slogan">{{ t('welcome.slogan') }}</span>
        <div class="loading-dots">
          <span /><span /><span />
        </div>
        <span class="loading-message">
          {{ restoring ? t('welcome.restoringWorkspace') : t('welcome.openingWorkspace') }}
        </span>
        <span class="loading-subtext">
          {{ t('welcome.loadingHint') }}
        </span>
      </div>
    </div>
  </div>
  <div v-else-if="!snapshot" class="cottage-welcome-shell">
    <WelcomePage @open-settings="openSettings()" />
  </div>
  <div v-else class="cottage-content" ref="contentRef">
    <div
      :class="['cottage-sidebar', { 'cottage-sidebar-collapsed': collapsed || compactViewport }]"
      :style="{ width: `${sidebarWidth}px` }"
    >
      <CollapsedSidebarRail
        v-if="collapsed || compactViewport"
        @open-settings="openSettings"
      />
      <template v-else>
        <div class="cottage-sidebar-header">
          <span class="cottage-logo-wrapper">
            <img
              :src="isDark ? '/logo-dark.svg' : '/logo-light.svg'"
              alt="Open Cottage"
              class="cottage-logo"
            />
          </span>
          <NText strong class="cottage-sidebar-title">
            Open Cottage
          </NText>
          <div class="cottage-sidebar-header-actions">
            <CottageTooltip :content="t('layout.backToWelcome')" placement="top">
              <ElButton
                text
                class="sidebar-layout-toggle-btn"
                @click="workspaceStore.closeWorkspace()"
              >
                <template #icon>
                  <NIcon :component="HomeOutline" />
                </template>
              </ElButton>
            </CottageTooltip>
            <CottageTooltip :content="t('layout.collapseSidebar')" placement="top">
              <ElButton
                text
                class="sidebar-layout-toggle-btn"
                @click="sidebarStore.setCollapsed(true)"
              >
                <template #icon>
                  <NIcon :component="ChevronBackOutline" />
                </template>
              </ElButton>
            </CottageTooltip>
          </div>
        </div>
        <div class="cottage-sidebar-content">
          <FileBrowser @open-settings="openSettings" />
        </div>
        <div class="cottage-sidebar-footer">
          <CottageTooltip :content="t('layout.aiSettingsTitle')" placement="top" delay="normal">
            <ElButton
              text
              class="cottage-sidebar-settings-btn"
              @click="openSettings()"
            >
              <template #icon>
                <NIcon :component="SettingsOutline" />
              </template>
              {{ t('common.settings') }}
            </ElButton>
          </CottageTooltip>
          <div class="cottage-sidebar-footer-actions">
            <CottageTooltip
              :content="isDark ? t('theme.toLight') : t('theme.toDark')"
              placement="top"
            >
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
            <CottageServiceStatusButton @click="openSettings('cottage-service')" />
          </div>
        </div>
      </template>
    </div>
    <div v-if="showFocusedMain" class="cottage-main">
      <div
        v-if="!collapsed && !compactViewport"
        class="splitter splitter-floating splitter-left"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        :aria-label="t('layout.resizeSidebar')"
        @mousedown="(e) => handleMouseDown('left', e)"
        @keydown="(e) => handleSplitterKeyDown('left', e)"
      />
      <div
        v-if="!compactViewport"
        class="splitter splitter-floating splitter-right"
        role="separator"
        tabindex="0"
        aria-orientation="vertical"
        :aria-label="t('layout.resizePanel')"
        @mousedown="(e) => handleMouseDown('right', e)"
        @keydown="(e) => handleSplitterKeyDown('right', e)"
      />
      <div class="cottage-main-body">
        <StagedChangesPanel v-if="hasPendingStagedReview" :session-id="stagedSessionId" />
        <FileExplorer v-else-if="explorerMode" />
        <Preview v-else />
      </div>
    </div>
    <div
      v-else-if="!collapsed && !compactViewport"
      class="splitter splitter-floating splitter-left cottage-empty-left-splitter"
      :style="{ left: `${sidebarWidth}px` }"
      @mousedown="(e) => handleMouseDown('left', e)"
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="t('layout.resizeSidebar')"
      @keydown="(e) => handleSplitterKeyDown('left', e)"
    />
    <div
      class="cottage-aside"
      :class="{ 'cottage-aside-expanded': !showMainPanel }"
      :style="showMainPanel && !compactViewport ? { width: `${rightWidth}px` } : undefined"
    >
      <ChatPanel @open-settings="openSettings()" />
    </div>
    <NewEntryDialog />
  </div>
  <Teleport to="body">
    <div
      v-if="props.showSettingsInPreview"
      class="ai-settings-float-layer"
      @click="closeSettings()"
    >
      <div class="ai-settings-float-panel" @click.stop>
        <SettingsPanel
          :initial-tab="settingsInitialTab"
          @close="closeSettings()"
        />
      </div>
    </div>
  </Teleport>
</template>
