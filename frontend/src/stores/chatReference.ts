import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';
import {
  anchorKey,
  newReferenceId,
  type ChatFileReference,
  type NewChatFileReference,
} from '../chat/fileReferences';

/**
 * 聊天文件引用管理。
 * 维护待发送的文件引用列表，并提供输入框聚焦控制。
 */
export const useChatReferenceStore = defineStore('chatReference', () => {
  const pendingReferences = ref<ChatFileReference[]>([]);
  const focusComposerRef = shallowRef<(() => void) | null>(null);

  /** 添加文件引用（去重） */
  function addReference(ref: NewChatFileReference) {
    const key = `${ref.path}\0${anchorKey(ref.anchor)}`;
    const exists = pendingReferences.value.some(
      (item) => `${item.path}\0${anchorKey(item.anchor)}` === key,
    );
    if (exists) return;
    pendingReferences.value = [
      ...pendingReferences.value,
      {
        id: newReferenceId(),
        path: ref.path,
        anchor: ref.anchor,
      },
    ];
  }

  /** 移除指定文件引用 */
  function removeReference(id: string) {
    pendingReferences.value = pendingReferences.value.filter((r) => r.id !== id);
  }

  /** 清空所有文件引用 */
  function clearReferences() {
    pendingReferences.value = [];
  }

  /** 注册输入框聚焦函数（由输入框组件调用） */
  function registerFocusComposer(fn: (() => void) | null) {
    focusComposerRef.value = fn;
  }

  /** 触发输入框聚焦 */
  function focusComposer() {
    focusComposerRef.value?.();
  }

  return {
    pendingReferences,
    addReference,
    removeReference,
    clearReferences,
    registerFocusComposer,
    focusComposer,
  };
});
