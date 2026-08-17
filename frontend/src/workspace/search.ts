/**
 * 工作区检索与精确编辑的纯函数实现（不依赖 DOM / 文件系统，便于单测）：
 * - glob 匹配：供 findFiles、searchFiles 的 include/exclude 使用
 * - 文本逐行搜索：供 searchFiles 返回行号 + 上下文
 * - 查找-替换：供 editFile 进行精确字符串替换
 */

const escapeRegExp = (input: string): string =>
  input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 将 glob 编译为锚定的正则：
 * - 双星号跨目录匹配；双星号加斜杠允许零或多级目录
 * - 单星号匹配单层内任意字符（不跨斜杠）
 * - 问号匹配单个非斜杠字符
 * - 花括号 a,b 形式表示分支（逗号分隔，按字面转义）
 */
export const globToRegExp = (glob: string): RegExp => {
  const g = glob.trim();
  let re = '';
  let i = 0;

  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
      continue;
    }
    if (c === '?') {
      re += '[^/]';
      i += 1;
      continue;
    }
    if (c === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        i += 1;
        continue;
      }
      const parts = g
        .slice(i + 1, end)
        .split(',')
        .map((part) => escapeRegExp(part));
      re += `(?:${parts.join('|')})`;
      i = end + 1;
      continue;
    }
    re += escapeRegExp(c);
    i += 1;
  }

  return new RegExp(`^${re}$`);
};

export const matchesGlob = (path: string, glob: string): boolean =>
  globToRegExp(glob).test(path);

export const matchesAnyGlob = (
  path: string,
  globs: readonly string[] | undefined,
): boolean => {
  if (!globs?.length) return false;
  return globs.some((glob) => matchesGlob(path, glob));
};

/** 默认视为二进制（searchFiles 跳过，避免读出乱码） */
const BINARY_EXT =
  /\.(zip|gz|tgz|tar|rar|7z|pdf|png|jpe?g|gif|webp|bmp|ico|tiff?|mp4|webm|mov|m4v|avi|mkv|mp3|wav|flac|aac|ogg|woff2?|ttf|otf|eot|exe|dll|so|dylib|bin|class|wasm|doc|docx|xls|xlsx|ppt|pptx|key|psd|sketch|heic|avif)$/i;

export const isLikelyTextPath = (path: string): boolean => !BINARY_EXT.test(path);

export interface SearchLineMatch {
  line: number;
  text: string;
  before?: string[];
  after?: string[];
}

export interface SearchInContentOptions {
  contextLines?: number;
  maxMatches?: number;
}

/** 在单个文件文本中逐行匹配，返回命中行（1-based）与上下文 */
export const searchInContent = (
  content: string,
  matcher: RegExp,
  options: SearchInContentOptions = {},
): SearchLineMatch[] => {
  const lines = content.split('\n');
  const ctx = Math.max(0, options.contextLines ?? 0);
  const max = options.maxMatches ?? Number.POSITIVE_INFINITY;
  const matches: SearchLineMatch[] = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    matcher.lastIndex = 0;
    if (!matcher.test(lines[idx])) continue;

    const match: SearchLineMatch = { line: idx + 1, text: lines[idx] };
    if (ctx > 0) {
      const before = lines.slice(Math.max(0, idx - ctx), idx);
      const after = lines.slice(idx + 1, idx + 1 + ctx);
      if (before.length) match.before = before;
      if (after.length) match.after = after;
    }
    matches.push(match);
    if (matches.length >= max) break;
  }

  return matches;
};

/** 由查询串构建逐行匹配用的正则（非全局，避免 lastIndex 副作用） */
export const buildSearchMatcher = (
  query: string,
  options: { isRegex?: boolean; caseSensitive?: boolean } = {},
): RegExp => {
  const flags = options.caseSensitive ? '' : 'i';
  const source = options.isRegex ? query : escapeRegExp(query);
  return new RegExp(source, flags);
};

export interface SearchReplaceEdit {
  search: string;
  replace: string;
  replaceAll?: boolean;
}

export interface SearchReplaceResult {
  content: string;
  replacements: number;
}

const countOccurrences = (haystack: string, needle: string): number => {
  if (!needle) return 0;
  let count = 0;
  let pos = haystack.indexOf(needle);
  while (pos !== -1) {
    count += 1;
    pos = haystack.indexOf(needle, pos + needle.length);
  }
  return count;
};

/**
 * 顺序应用查找-替换：
 * - search 必须逐字符匹配（含缩进/换行）
 * - 默认要求唯一匹配；多处匹配需 replaceAll，否则抛错提示扩大上下文
 */
export const applySearchReplace = (
  source: string,
  edits: readonly SearchReplaceEdit[],
): SearchReplaceResult => {
  if (!edits.length) throw new Error('edits 至少包含 1 项');

  let content = source;
  let replacements = 0;

  edits.forEach((edit, index) => {
    if (!edit.search) {
      throw new Error(`edits[${index}].search 不能为空`);
    }
    const occurrences = countOccurrences(content, edit.search);
    if (occurrences === 0) {
      throw new Error(
        `edits[${index}]: 未找到要替换的文本，search 必须与文件内容精确匹配（含缩进与换行）`,
      );
    }
    if (occurrences > 1 && !edit.replaceAll) {
      throw new Error(
        `edits[${index}]: 匹配到 ${occurrences} 处，请在 search 中加入更多上下文使其唯一，或设置 replaceAll=true`,
      );
    }

    if (edit.replaceAll) {
      content = content.split(edit.search).join(edit.replace);
      replacements += occurrences;
    } else {
      content = content.replace(edit.search, () => edit.replace);
      replacements += 1;
    }
  });

  return { content, replacements };
};
