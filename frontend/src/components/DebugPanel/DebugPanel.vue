<script setup lang="ts">
import {
  BugOutline,
  CloseOutline,
  ConstructOutline,
  HardwareChipOutline,
  TerminalOutline,
} from '@vicons/ionicons5';
import { ElButton } from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import { NIcon, NText } from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { onMounted, onUnmounted, watch } from 'vue';
import { useDebugPanelStore } from '../../stores/debugPanel';
import ChatDebugTab from './ChatDebugTab.vue';
import ToolInvokeTab from './ToolInvokeTab.vue';
import WorkerMonitorTab from './WorkerMonitorTab.vue';

withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  { compact: false },
);

const debugPanelStore = useDebugPanelStore();
const { open, activeTab } = storeToRefs(debugPanelStore);


function close() {
  debugPanelStore.close();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    close();
  }
}

watch(open, (visible) => {
  document.body.style.overflow = visible ? 'hidden' : '';
});

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  document.body.style.overflow = '';
});
</script>

<template>
  <CottageTooltip v-if="compact" content="调试面板" placement="top">
    <ElButton
      text
      class="collapsed-sidebar-btn"
      @click="debugPanelStore.show()"
    >
      <template #icon>
        <NIcon :component="BugOutline" />
      </template>
    </ElButton>
  </CottageTooltip>
  <CottageTooltip v-else content="调试面板" placement="top">
    <ElButton
      text
      style="color: var(--cottage-muted)"
      @click="debugPanelStore.show()"
    >
      <template #icon>
        <NIcon :component="BugOutline" />
      </template>
      调试
    </ElButton>
  </CottageTooltip>

  <Teleport to="body">
    <Transition name="debug-panel-fade">
      <div
        v-if="open"
        class="debug-panel-scrim"
        aria-hidden="true"
        @click="close"
      />
    </Transition>
    <Transition name="debug-panel-slide">
      <aside
        v-if="open"
        class="debug-panel-shell"
        role="dialog"
        aria-label="调试面板"
        @click.stop
      >
        <header class="debug-panel-header">
          <div class="debug-panel-header__brand">
            <span class="debug-panel-header__icon">
              <NIcon :component="BugOutline" />
            </span>
            <div>
              <NText strong class="debug-panel-header__title">调试面板</NText>
              <div class="debug-panel-header__subtitle">Inspector</div>
            </div>
          </div>
          <CottageTooltip content="关闭 (Esc)" placement="top">
            <ElButton
              class="cottage-icon-btn"
              @click="close"
            >
              <template #icon>
                <NIcon :component="CloseOutline" />
              </template>
            </ElButton>
          </CottageTooltip>
        </header>

        <nav class="debug-panel-tabs" aria-label="调试面板分页">
          <button
            type="button"
            class="debug-panel-tab"
            :class="{ 'is-active': activeTab === 'chat' }"
            @click="activeTab = 'chat'"
          >
            <NIcon :component="HardwareChipOutline" />
            <span>聊天底层信息</span>
          </button>
          <button
            type="button"
            class="debug-panel-tab"
            :class="{ 'is-active': activeTab === 'workers' }"
            @click="activeTab = 'workers'"
          >
            <NIcon :component="ConstructOutline" />
            <span>系统线程监控</span>
          </button>
          <button
            type="button"
            class="debug-panel-tab"
            :class="{ 'is-active': activeTab === 'tools' }"
            @click="activeTab = 'tools'"
          >
            <NIcon :component="TerminalOutline" />
            <span>工具调用</span>
          </button>
        </nav>

        <div class="debug-panel-body">
          <ChatDebugTab
            v-show="activeTab === 'chat'"
            :visible="open && activeTab === 'chat'"
          />
          <WorkerMonitorTab
            v-show="activeTab === 'workers'"
            :visible="open && activeTab === 'workers'"
          />
          <ToolInvokeTab
            v-show="activeTab === 'tools'"
            :visible="open && activeTab === 'tools'"
          />
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
