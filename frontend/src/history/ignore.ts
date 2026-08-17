/**
 * 追踪/忽略 glob 匹配工具
 *
 * 用于 History 和 RAG 模块过滤需要跟踪/索引的文件。
 * 使用简单的 glob 匹配实现（不依赖外部库），支持：
 * - `**` 匹配任意层级目录
 * - `*` 匹配单层内任意字符
 * - `{a,b}` 花括号扩展
 */

/**
 * 将简单 glob 模式转换为正则表达式
 */
function globToRegex(pattern: string): RegExp {
  // 展开花括号 {a,b,c} → (a|b|c)
  let expanded = pattern.replace(
    /\{([^}]+)\}/g,
    (_, group: string) => `(${group.split(',').map((s) => s.trim()).join('|')})`,
  );

  // 转义正则特殊字符（除了 * 和 ?）
  expanded = expanded.replace(/[.+^${}()|[\]\\]/g, '\\$&');

  // 还原花括号扩展中的分组，并把组内被转义的 | 恢复为 alternation
  expanded = expanded.replace(/\\\(([^)]+)\\\)/g, (_, group: string) => {
    return `(${group.replace(/\\\|/g, '|')})`;
  });

  // ** → 任意层级
  expanded = expanded.replace(/\*\*/g, '{{GLOBSTAR}}');
  // * → 单层（不含 /）
  expanded = expanded.replace(/\*/g, '[^/]*');
  // 还原 **
  expanded = expanded.replace(/\{\{GLOBSTAR\}\}/g, '.*');
  // ? → 单字符
  expanded = expanded.replace(/\?/g, '[^/]');

  return new RegExp(`^${expanded}$`);
}

/**
 * 判断路径是否匹配任一 glob 模式
 */
export function matchesAny(path: string, patterns: string[]): boolean {
  const normalized = path.replace(/\\/g, '/');
  return patterns.some((p) => globToRegex(p).test(normalized));
}

/**
 * 判断文件是否应被追踪
 * @param path 文件相对路径
 * @param trackGlobs 包含模式（默认 ['**']）
 * @param ignoreGlobs 忽略模式
 */
export function shouldTrack(
  path: string,
  trackGlobs: string[],
  ignoreGlobs: string[],
): boolean {
  const normalized = path.replace(/\\/g, '/');
  // 首先检查是否在忽略列表
  if (matchesAny(normalized, ignoreGlobs)) return false;
  // 然后检查是否匹配跟踪列表
  return matchesAny(normalized, trackGlobs);
}

/**
 * 过滤文件列表，返回应被追踪的文件
 */
export function filterTrackedFiles(
  files: string[],
  trackGlobs: string[],
  ignoreGlobs: string[],
): string[] {
  return files.filter((f) => shouldTrack(f, trackGlobs, ignoreGlobs));
}

/**
 * 生成最终忽略规则。.cottage/** 是不可覆盖的系统排除项，
 * 避免历史对象与元数据被递归捕获。
 */
export function buildIgnoreGlobs(userIgnores: string[]): string[] {
  return [...userIgnores, '.cottage/**'];
}
