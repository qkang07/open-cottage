import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { DirectorySizeResult } from '../workspace/explorerTypes';
import { normalizePath } from '../workspace/pathUtils';

/** 文件系统元数据缓存（如文件夹递归大小） */
export const useFilesystemMetadataStore = defineStore('filesystemMetadata', () => {
  const directorySizes = ref<Record<string, DirectorySizeResult>>({});

  /** 获取指定目录的大小缓存 */
  function getDirectorySize(path: string): DirectorySizeResult | undefined {
    return directorySizes.value[normalizePath(path)];
  }

  /** 更新目录大小缓存（仅当数据变化时触发响应式更新） */
  function setDirectorySize(path: string, result: DirectorySizeResult) {
    const key = normalizePath(path);
    const prev = directorySizes.value[key];
    if (
      prev &&
      prev.totalBytes === result.totalBytes &&
      prev.fileCount === result.fileCount &&
      prev.directoryCount === result.directoryCount
    ) {
      return;
    }
    directorySizes.value = { ...directorySizes.value, [key]: result };
  }

  /** 清空所有目录大小缓存 */
  function clearAll() {
    directorySizes.value = {};
  }

  return {
    directorySizes,
    getDirectorySize,
    setDirectorySize,
    clearAll,
  };
});
