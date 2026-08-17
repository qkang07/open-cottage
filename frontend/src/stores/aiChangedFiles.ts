import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { MessageChangedFile } from '../chat/messageChangedFiles';

/**
 * AI 改动标记。
 * 记录当前会话中由 AI 工具改动/生成/删除的文件路径，
 * 供文件管理器以角标形式展示「AI 动过哪些文件」，支持一键清除。
 */
export const useAiChangedFilesStore = defineStore('aiChangedFiles', () => {
  const changed = ref<MessageChangedFile[]>([]);

  const pathSet = computed(() => new Set(changed.value.map((f) => f.path)));

  /** 用最新推导结果整体替换（空列表即清空）；内容一致时不触发更新 */
  function sync(files: MessageChangedFile[]) {
    const key = files.map((f) => `${f.path}\0${f.kind}`).join('\n');
    const current = changed.value
      .map((f) => `${f.path}\0${f.kind}`)
      .join('\n');
    if (key === current) return;
    changed.value = files;
  }

  /** 某路径（或其子树内）是否被 AI 改动过 */
  function isTouched(path: string): boolean {
    if (pathSet.value.has(path)) return true;
    const prefix = `${path}/`;
    return changed.value.some((f) => f.path.startsWith(prefix));
  }

  /** 精确路径的改动类别（用于角标提示文案） */
  function kindOf(path: string): MessageChangedFile['kind'] | null {
    const found = changed.value.find((f) => f.path === path);
    return found ? found.kind : null;
  }

  /** 清除全部标记（用户确认已知晓） */
  function clearAll() {
    changed.value = [];
  }

  return { changed, sync, isTouched, kindOf, clearAll };
});
