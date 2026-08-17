/**
 * 延迟遍历目录：配置忽略项（node_modules 等）与超大目录（单层条目超阈值）。
 */

import { isTraverseSkippedDirName } from './traverseIgnore';

/** 单层条目数超过此阈值时暂停自动递归，等用户展开后再加载 */
export const DEFAULT_LARGE_DIR_ENTRY_THRESHOLD = 500;

export type DeferredDirReason = 'ignored' | 'large';

export interface DeferredDirInfo {
  reason: DeferredDirReason;
  entryCount?: number;
}

export function shouldDeferDirectory(
  dirName: string,
  entryCount: number,
  skipIgnored: boolean,
): DeferredDirInfo | null {
  if (skipIgnored && isTraverseSkippedDirName(dirName)) {
    return { reason: 'ignored' };
  }
  if (entryCount > DEFAULT_LARGE_DIR_ENTRY_THRESHOLD) {
    return { reason: 'large', entryCount };
  }
  return null;
}

export function getDeferredDirTooltip(
  info: DeferredDirInfo,
  dirName: string,
): string {
  if (info.reason === 'ignored') {
    return `「${dirName}」为默认跳过的依赖或版本库目录。展开或进入后将加载内容，完整扫描可能较慢。`;
  }
  const count = info.entryCount ?? DEFAULT_LARGE_DIR_ENTRY_THRESHOLD;
  return `「${dirName}」包含 ${count} 个条目，已超过自动扫描阈值。为提升性能已暂停展开，点击展开或进入后将加载内容。`;
}

export function deferredInfoForDirName(dirName: string): DeferredDirInfo | null {
  if (isTraverseSkippedDirName(dirName)) {
    return { reason: 'ignored' };
  }
  return null;
}
