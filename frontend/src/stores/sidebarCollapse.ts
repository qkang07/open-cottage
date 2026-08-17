import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import type { SidebarView } from '../components/FileBrowser/sidebarView';
import { useExplorerModeStore } from './explorerMode';

/** 侧边栏展开时可显示的视图类型 */
export type SidebarExpandView = SidebarView | 'index';

/** 侧边栏收起时的宽度（像素） */
export const SIDEBAR_COLLAPSED_WIDTH = 52;

/**
 * 侧边栏折叠状态管理。
 * 控制侧边栏的展开/收起状态，以及文件管理器模式下的自动收起逻辑。
 */
export const useSidebarCollapseStore = defineStore('sidebarCollapse', () => {
  const explorerModeStore = useExplorerModeStore();

  const collapsed = ref(false);
  const requestExpandView = ref<SidebarExpandView | null>(null);

  watch(
    () => explorerModeStore.explorerMode,
    (mode) => {
      if (mode) collapsed.value = true;
    },
  );

  /** 设置侧边栏折叠状态 */
  function setCollapsed(value: boolean) {
    collapsed.value = value;
  }

  /** 切换侧边栏折叠状态 */
  function toggleCollapsed() {
    collapsed.value = !collapsed.value;
  }

  /** 展开侧边栏并切换到指定视图（默认 'files'） */
  function expandSidebar(view: SidebarExpandView = 'files') {
    requestExpandView.value = view;
    collapsed.value = false;
  }

  /** 清除展开视图请求（由 UI 组件消费后调用） */
  function clearExpandView() {
    requestExpandView.value = null;
  }

  return {
    collapsed,
    setCollapsed,
    toggleCollapsed,
    expandSidebar,
    requestExpandView,
    clearExpandView,
  };
});
