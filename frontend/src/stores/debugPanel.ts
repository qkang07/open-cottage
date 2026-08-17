import { defineStore } from 'pinia';
import { ref } from 'vue';

/** 调试面板可切换的标签页 */
export type DebugPanelTab = 'chat' | 'workers' | 'index' | 'tools';

/**
 * 调试面板全局状态。
 * 控制面板的打开/关闭以及当前激活的标签页。
 */
export const useDebugPanelStore = defineStore('debugPanel', () => {
  const open = ref(false);
  const activeTab = ref<DebugPanelTab>('chat');

  /** 打开调试面板并切换到指定标签页（默认 'chat'） */
  function show(tab: DebugPanelTab = 'chat') {
    activeTab.value = tab;
    open.value = true;
  }

  /** 关闭调试面板 */
  function close() {
    open.value = false;
  }

  return {
    open,
    activeTab,
    show,
    close,
  };
});
