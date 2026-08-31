import { normalizePath } from '../workspace/pathUtils';

export interface WorkspaceFileLinkTarget {
  path: string;
  line?: number;
  column?: number;
}

const URI_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;
const WINDOWS_ABSOLUTE_RE = /^[a-z]:[\\/]/i;

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * 将助手回复中的 Markdown 链接解析为工作区文件。
 * 支持工作区相对路径、带根目录名的绝对路径，以及 `:line[:column]` / `#Lline` 定位。
 * HTTP、mailto、页面锚点等仍交给浏览器处理。
 */
export const resolveWorkspaceFileLink = (
  href: string,
  rootName: string | null | undefined,
  knownFiles: readonly string[],
): WorkspaceFileLinkTarget | null => {
  let raw = safeDecodeURIComponent(href.trim());
  if (!raw || raw.startsWith('#') || raw.startsWith('//')) return null;

  const isWindowsAbsolute = WINDOWS_ABSOLUTE_RE.test(raw);
  const isFileUrl = /^file:/i.test(raw);

  if (isFileUrl) {
    raw = raw.replace(/^file:\/\/+?/i, '');
    if (/^\/[a-z]:[\\/]/i.test(raw)) raw = raw.slice(1);
  }

  let line: number | undefined;
  let column: number | undefined;
  const hashIndex = raw.indexOf('#');
  if (hashIndex >= 0) {
    const fragment = raw.slice(hashIndex + 1);
    const lineMatch = /^L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/i.exec(fragment);
    if (lineMatch) {
      line = Number(lineMatch[1]);
      column = lineMatch[2] ? Number(lineMatch[2]) : undefined;
    }
    raw = raw.slice(0, hashIndex);
  }
  raw = raw.split('?', 1)[0] ?? raw;

  const suffixMatch = /:(\d+)(?::(\d+))?$/.exec(raw);
  if (suffixMatch) {
    line ??= Number(suffixMatch[1]);
    column ??= suffixMatch[2] ? Number(suffixMatch[2]) : undefined;
    raw = raw.slice(0, suffixMatch.index);
  }
  if (URI_SCHEME_RE.test(raw) && !isWindowsAbsolute && !isFileUrl) return null;

  const slashPath = raw.replace(/\\/g, '/');
  if (slashPath.split('/').includes('..')) return null;
  const normalized = normalizePath(slashPath);
  if (!normalized) return null;

  const known = new Set(knownFiles.map(normalizePath));
  const candidates: string[] = [normalized];
  let rootRelativeCandidate: string | null = null;
  if (rootName) {
    const parts = normalized.split('/');
    const rootIndex = parts.findIndex(
      (part) => part.toLocaleLowerCase() === rootName.toLocaleLowerCase(),
    );
    if (rootIndex >= 0 && rootIndex < parts.length - 1) {
      rootRelativeCandidate = parts.slice(rootIndex + 1).join('/');
      candidates.unshift(rootRelativeCandidate);
    }
  }

  for (const candidate of candidates) {
    if (known.has(candidate)) return { path: candidate, line, column };
  }
  if (rootRelativeCandidate) {
    return { path: rootRelativeCandidate, line, column };
  }

  // 绝对路径无法在浏览器中读取其真实根路径；仅在后缀唯一匹配时转换。
  const suffixMatches = knownFiles
    .map(normalizePath)
    .filter((path) => normalized.endsWith(`/${path}`));
  if (suffixMatches.length === 1) {
    return { path: suffixMatches[0], line, column };
  }

  // 相对路径可能是快照尚未包含的新文件，交给工作区 API 做最终存在性检查。
  const looksAbsolute = isWindowsAbsolute || isFileUrl || slashPath.startsWith('/');
  return looksAbsolute ? null : { path: normalized, line, column };
};
