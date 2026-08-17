import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * 文件管理器模式状态。
 * 控制文件管理器的开关、文件树展开状态、导航历史与工作空间绑定。
 */
export const useExplorerModeStore = defineStore('explorerMode', () => {
  const explorerMode = ref(false);

  // ─── 文件树展开状态 ───────────────────────────────────────────────────────
  const expandedKeys = ref<string[]>([]);

  // ─── 文件管理器导航位置 ───────────────────────────────────────────────────
  const currentDir = ref('');
  const history = ref<string[]>(['']);
  const historyIndex = ref(0);

  // 当前状态所属的工作空间，切换工作空间时重置位置与展开状态
  const boundRootName = ref<string | null>(null);

  /** 打开文件管理器 */
  function openExplorer() {
    explorerMode.value = true;
  }

  /** 关闭文件管理器 */
  function closeExplorer() {
    explorerMode.value = false;
  }

  /** 切换文件管理器开关 */
  function toggleExplorer() {
    explorerMode.value = !explorerMode.value;
  }

  /** 设置指定节点的展开/收起状态 */
  function setNodeExpanded(key: string, expanded: boolean) {
    if (expanded) {
      if (!expandedKeys.value.includes(key)) {
        expandedKeys.value = [...expandedKeys.value, key];
      }
    } else {
      expandedKeys.value = expandedKeys.value.filter((item) => item !== key);
    }
  }

  /** 设置文件管理器导航位置与历史记录 */
  function setExplorerLocation(dir: string, nextHistory: string[], index: number) {
    currentDir.value = dir;
    history.value = nextHistory;
    historyIndex.value = index;
  }

  /** 切换工作空间时调用：若根目录变化则清空记忆的位置与展开状态 */
  function syncWorkspace(rootName: string | null) {
    if (rootName === boundRootName.value) return;
    boundRootName.value = rootName;
    expandedKeys.value = [];
    currentDir.value = '';
    history.value = [''];
    historyIndex.value = 0;
  }

  return {
    explorerMode,
    expandedKeys,
    currentDir,
    history,
    historyIndex,
    openExplorer,
    closeExplorer,
    toggleExplorer,
    setNodeExpanded,
    setExplorerLocation,
    syncWorkspace,
  };
});
