import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { MessageChangedFile } from '../chat/messageChangedFiles';
import {
  discardPendingStagedEntry,
  getPendingStagedApproval,
} from '../platform/staging/stagedApprovalGate';
import { workspace } from '../workspace/FileSystemWorkspace';
import { useWorkspaceStore } from './workspace';

const HANDLED_CHANGES_STORAGE_KEY = 'open-cottage.ai-changed-files.handled.v1';
const DEFAULT_SCOPE_KEY = '__default__';
type HandledChangesByScope = Record<string, Record<string, string>>;

const loadHandledChanges = (): HandledChangesByScope => {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(HANDLED_CHANGES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as HandledChangesByScope)
      : {};
  } catch {
    return {};
  }
};

/**
 * AI 改动标记。
 * 记录当前会话中由 AI 工具改动/生成/删除的文件路径，
 * 供文件树/管理器展示状态，并恢复会话内首次改动前的基线。
 */
export const useAiChangedFilesStore = defineStore('aiChangedFiles', () => {
  const workspaceStore = useWorkspaceStore();
  const changed = ref<MessageChangedFile[]>([]);
  const scopeId = ref<string | null>(null);
  const handledChangesByScope = ref<HandledChangesByScope>(loadHandledChanges());

  const pathSet = computed(() => new Set(changed.value.map((f) => f.path)));

  /** 用最新推导结果整体替换（空列表即清空）；内容一致时不触发更新 */
  function sync(files: MessageChangedFile[], nextScopeId: string | null = null) {
    scopeId.value = nextScopeId;
    const handled = handledChangesByScope.value[nextScopeId ?? DEFAULT_SCOPE_KEY] ?? {};
    const visible = files.filter(
      (file) => handled[file.path] !== (file.changeId ?? ''),
    );
    const key = visible
      .map((f) => `${f.path}\0${f.kind}\0${f.changeId ?? ''}`)
      .join('\n');
    const current = changed.value
      .map((f) => `${f.path}\0${f.kind}\0${f.changeId ?? ''}`)
      .join('\n');
    if (key === current) return;
    changed.value = visible;
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

  function canReset(path: string): boolean {
    const file = changed.value.find((item) => item.path === path);
    if (!file) return false;
    return Boolean(
      file.reset || getPendingStagedApproval(scopeId.value)?.store.get(path),
    );
  }

  const markHandled = (file: MessageChangedFile) => {
    const key = scopeId.value ?? DEFAULT_SCOPE_KEY;
    handledChangesByScope.value = {
      ...handledChangesByScope.value,
      [key]: {
        ...(handledChangesByScope.value[key] ?? {}),
        [file.path]: file.changeId ?? '',
      },
    };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(
          HANDLED_CHANGES_STORAGE_KEY,
          JSON.stringify(handledChangesByScope.value),
        );
      }
    } catch {
      // 浏览器禁用存储时仍保留当前运行期状态。
    }
    changed.value = changed.value.filter((item) => item.path !== file.path);
  };

  /** 保留文件内容，仅将本次工具改动标记为已处理。 */
  function acknowledgeOne(path: string): void {
    const file = changed.value.find((item) => item.path === path);
    if (!file) return;
    markHandled(file);
  }

  function acknowledgeAll(): void {
    for (const file of [...changed.value]) markHandled(file);
  }

  /** 恢复会话内首次 AI 改动前的文件内容；新建文件则删除。 */
  async function resetOne(path: string): Promise<void> {
    const file = changed.value.find((item) => item.path === path);
    if (!file) throw new Error('未找到该文件的 AI 改动记录');

    // 暂存区中的改动尚未写入真实工作区，“重置”应直接丢弃该暂存项。
    const pending = getPendingStagedApproval(scopeId.value);
    if (pending?.store.get(path)) {
      discardPendingStagedEntry(path, scopeId.value);
      markHandled(file);
      return;
    }

    if (!file.reset) throw new Error('该文件缺少可恢复的改动前基线');

    if (file.reset.kind === 'delete') {
      if ((await workspace.getEntryKind(path)) !== null) {
        await workspaceStore.deletePaths([path]);
      }
    } else {
      await workspace.writeFile(path, file.reset.content);
      if (workspaceStore.selectedPath === path) {
        await workspaceStore.selectFile(path);
      }
    }
    markHandled(file);
  }

  async function resetAll(): Promise<{ failed: string[] }> {
    const failed: string[] = [];
    for (const file of [...changed.value]) {
      try {
        await resetOne(file.path);
      } catch {
        failed.push(file.path);
      }
    }
    return { failed };
  }

  return {
    changed,
    sync,
    isTouched,
    kindOf,
    canReset,
    acknowledgeOne,
    acknowledgeAll,
    resetOne,
    resetAll,
  };
});
