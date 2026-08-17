import { normalizePath } from '../workspace/pathUtils';

export interface UnifiedHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

export interface UnifiedPatchFile {
  /** 工作区相对路径 */
  path: string;
  hunks: UnifiedHunk[];
  isNew: boolean;
  isDelete: boolean;
}

export interface ApplyUnifiedPatchResult {
  path: string;
  before: string;
  after: string;
  created: boolean;
  deleted: boolean;
}

const stripAbPrefix = (raw: string): string => {
  const pathPart = raw.trim().split('\t')[0]?.trim() ?? raw.trim();
  if (pathPart === '/dev/null') return '/dev/null';
  if (pathPart.startsWith('a/') || pathPart.startsWith('b/')) {
    return pathPart.slice(2);
  }
  return pathPart;
};

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s@@/;

export const parseUnifiedHunks = (body: string): UnifiedHunk[] => {
  const lines = body.split('\n');
  const hunks: UnifiedHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const match = lines[i]?.match(HUNK_HEADER_RE);
    if (!match) {
      i += 1;
      continue;
    }
    const oldStart = Number(match[1]);
    const oldCount = match[2] != null ? Number(match[2]) : 1;
    const newStart = Number(match[3]);
    const newCount = match[4] != null ? Number(match[4]) : 1;
    i += 1;
    const hunkLines: string[] = [];
    while (i < lines.length) {
      const line = lines[i] ?? '';
      if (line.startsWith('@@') || /^---\s/.test(line) || /^\+\+\+\s/.test(line)) {
        break;
      }
      if (line === '\\ No newline at end of file') {
        i += 1;
        continue;
      }
      if (
        line.startsWith(' ') ||
        line.startsWith('+') ||
        line.startsWith('-')
      ) {
        hunkLines.push(line);
        i += 1;
        continue;
      }
      // 模型有时漏写前导空格：非空且不像路径头时，当作上下文
      if (line.length > 0 && !line.startsWith('diff ') && !line.startsWith('index ')) {
        hunkLines.push(` ${line}`);
        i += 1;
        continue;
      }
      break;
    }
    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }
  return hunks;
};

/**
 * 解析可能含多文件的 unified diff。
 * 支持标准 `--- / +++` 头；路径会去掉 a/ b/ 前缀。
 */
export const parseUnifiedPatch = (patchText: string): UnifiedPatchFile[] => {
  const text = patchText.replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const lines = text.split('\n');
  const files: UnifiedPatchFile[] = [];
  let i = 0;

  while (i < lines.length) {
    while (
      i < lines.length &&
      !/^---\s/.test(lines[i] ?? '') &&
      !(lines[i] ?? '').startsWith('@@')
    ) {
      i += 1;
    }
    if (i >= lines.length) break;

    if ((lines[i] ?? '').startsWith('@@')) {
      const rest = lines.slice(i).join('\n');
      const hunks = parseUnifiedHunks(rest);
      if (hunks.length) {
        files.push({ path: '', hunks, isNew: false, isDelete: false });
      }
      break;
    }

    const oldLine = lines[i] ?? '';
    i += 1;
    const newLine = lines[i] ?? '';
    if (!/^\+\+\+\s/.test(newLine)) {
      throw new Error(`unified diff 缺少 +++ 行（在 "${oldLine}" 之后）`);
    }
    i += 1;

    const oldPath = stripAbPrefix(oldLine.replace(/^---\s+/, ''));
    const newPath = stripAbPrefix(newLine.replace(/^\+\+\+\s+/, ''));
    const isNew = oldPath === '/dev/null';
    const isDelete = newPath === '/dev/null';
    const path = normalizePath(isDelete ? oldPath : newPath);
    if (!path || path === '/dev/null') {
      throw new Error('unified diff 文件路径无效');
    }

    const hunkStart = i;
    while (i < lines.length && !/^---\s/.test(lines[i] ?? '')) {
      i += 1;
    }
    const hunks = parseUnifiedHunks(lines.slice(hunkStart, i).join('\n'));
    files.push({ path, hunks, isNew, isDelete });
  }

  return files;
};

const applyHunk = (lines: string[], hunk: UnifiedHunk): string[] => {
  // oldStart 为 1-based。oldCount=0 时表示在 oldStart 行之后插入（oldStart=0 则文件开头）
  const start =
    hunk.oldCount === 0
      ? Math.min(lines.length, Math.max(0, hunk.oldStart))
      : Math.max(0, hunk.oldStart - 1);

  let oldIndex = start;
  const replacement: string[] = [];

  for (const raw of hunk.lines) {
    const tag = raw[0];
    const body = raw.slice(1);
    if (tag === '+') {
      replacement.push(body);
      continue;
    }
    if (tag === '-' || tag === ' ') {
      if (oldIndex >= lines.length || lines[oldIndex] !== body) {
        throw new Error(
          `hunk 上下文不匹配（行 ${oldIndex + 1}）：期望 ${JSON.stringify(body)}，实际 ${JSON.stringify(lines[oldIndex])}`,
        );
      }
      if (tag === ' ') replacement.push(body);
      oldIndex += 1;
      continue;
    }
    throw new Error(`无法识别的 hunk 行：${JSON.stringify(raw)}`);
  }

  return [...lines.slice(0, start), ...replacement, ...lines.slice(oldIndex)];
};

/** 将一组 hunk 应用到单个文件内容（从后往前，避免行号漂移） */
export const applyHunksToContent = (
  content: string,
  hunks: readonly UnifiedHunk[],
): string => {
  const sorted = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  let lines = content === '' ? [] : content.split('\n');
  for (const hunk of sorted) {
    lines = applyHunk(lines, hunk);
  }
  return lines.join('\n');
};

export interface ApplyParsedPatchOptions {
  /** 读取现有文件；不存在时返回 null */
  readFile: (path: string) => Promise<string | null>;
  /** 覆盖路径（裸 hunk 无 ---/+++ 时必填） */
  defaultPath?: string;
}

/**
 * 解析并应用 multi-file unified patch，返回每个文件的前后内容。
 * 不落盘；由调用方负责 write/delete。
 */
export const applyUnifiedPatch = async (
  patchText: string,
  options: ApplyParsedPatchOptions,
): Promise<ApplyUnifiedPatchResult[]> => {
  const files = parseUnifiedPatch(patchText);
  if (!files.length) throw new Error('patch 为空或无法解析');

  const results: ApplyUnifiedPatchResult[] = [];
  for (const file of files) {
    const path = file.path || normalizePath(options.defaultPath ?? '');
    if (!path) {
      throw new Error('patch 未包含文件路径，请在参数中提供 path');
    }

    if (file.isDelete) {
      const before = (await options.readFile(path)) ?? '';
      results.push({
        path,
        before,
        after: '',
        created: false,
        deleted: true,
      });
      continue;
    }

    const existing = await options.readFile(path);
    if (file.isNew) {
      if (existing != null) {
        throw new Error(`无法新建：文件已存在 ${path}`);
      }
      const after = applyHunksToContent('', file.hunks);
      results.push({
        path,
        before: '',
        after,
        created: true,
        deleted: false,
      });
      continue;
    }

    if (existing == null) {
      throw new Error(`文件不存在：${path}`);
    }
    const after = applyHunksToContent(existing, file.hunks);
    results.push({
      path,
      before: existing,
      after,
      created: false,
      deleted: false,
    });
  }
  return results;
};
