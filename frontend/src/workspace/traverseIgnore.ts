/**
 * 工作区递归遍历时的默认跳过目录（打开工作区、RAG、snapshot 等）。
 * 用户主动展开文件树、进入资源管理器或手动计算大小时再深入这些目录。
 */

export const TRAVERSE_SKIP_DIR_NAMES = ['node_modules', '.git'] as const;

export type TraverseSkipDirName = (typeof TRAVERSE_SKIP_DIR_NAMES)[number];

export function isTraverseSkippedDirName(name: string): boolean {
  return (TRAVERSE_SKIP_DIR_NAMES as readonly string[]).includes(name);
}

/** 路径任一段为跳过目录名时，视为处于「忽略区」内 */
export function pathHasTraverseSkippedSegment(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return false;
  return normalized.split('/').some(isTraverseSkippedDirName);
}

/**
 * 解析本次递归是否应跳过 node_modules / .git。
 * - 显式传入 skipIgnoredDirs 时优先
 * - 从「忽略区」内开始遍历时（prefix 含 node_modules 等）不跳过
 */
export function resolveTraverseSkipIgnored(
  prefix: string | undefined,
  explicit?: boolean,
): boolean {
  if (explicit !== undefined) return explicit;
  if (pathHasTraverseSkippedSegment(prefix ?? '')) return false;
  return true;
}
