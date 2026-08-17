import { defineStore } from 'pinia';
import { ref } from 'vue';

/** 新建文件还是文件夹 */
export type NewEntryMode = 'file' | 'folder';

export interface NewEntryRequest {
  /** 创建文件还是文件夹 */
  mode: NewEntryMode;
  /** 初始（或锁定）的目标目录，'' 表示工作空间根目录 */
  dir: string;
  /** 为 true 时目录固定不可更改（例如在文件夹上右键新建） */
  lockDir: boolean;
}

/** 全局「新建文件/文件夹」对话框状态，供文件浏览器、文件管理器、预览欢迎页共用 */
export const useNewEntryDialogStore = defineStore('newEntryDialog', () => {
  const request = ref<NewEntryRequest | null>(null);

  /** 打开新建对话框 */
  function open(req: NewEntryRequest) {
    request.value = req;
  }

  /** 关闭新建对话框 */
  function close() {
    request.value = null;
  }

  return { request, open, close };
});
