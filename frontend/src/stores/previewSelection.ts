import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { FileReferenceAnchor } from '../chat/fileReferences';

/** 当前预览选中的文件引用锚点，null 表示无选中 */
export type PreviewSelection = FileReferenceAnchor | null;

/**
 * 预览选中状态管理。
 * 存储当前选中的文件引用锚点，供预览面板使用。
 */
export const usePreviewSelectionStore = defineStore('previewSelection', () => {
  const selectionRef = shallowRef<PreviewSelection>(null);

  /** 设置预览选中项 */
  function setSelection(selection: PreviewSelection) {
    selectionRef.value = selection;
  }

  /** 清除预览选中项 */
  function clearSelection() {
    selectionRef.value = null;
  }

  /** 获取当前预览选中项 */
  function getSelection() {
    return selectionRef.value;
  }

  return {
    getSelection,
    setSelection,
    clearSelection,
  };
});
