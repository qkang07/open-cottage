export type LinePatchAction =
  | 'replace'
  | 'delete'
  | 'insert_before'
  | 'insert_after';

export interface LinePatch {
  /** 1-based 行号 */
  start: number;
  /** 1-based，含首尾；省略时等同 start */
  end?: number;
  action: LinePatchAction;
  content?: string;
}

export interface ColumnPatch {
  /** 1-based 行号 */
  line: number;
  /** 1-based 列，含首 */
  start: number;
  /** 1-based 列，含尾；省略时等同 start */
  end?: number;
  content: string;
}

export interface RegexPatch {
  pattern: string;
  replacement: string;
  flags?: string;
  /** 最多替换次数；省略表示全部（需配合 g 标志） */
  maxReplacements?: number;
}

export interface ApplyPatchesInput {
  lines?: LinePatch[];
  columns?: ColumnPatch[];
  regex?: RegexPatch[];
}

export interface ApplyPatchesResult {
  content: string;
  lineEdits: number;
  columnEdits: number;
  regexReplacements: number;
}

interface SplitContent {
  lines: string[];
  eol: '\n' | '\r\n';
  trailingNewline: boolean;
}

const assertPositiveInt = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} 必须是大于 0 的整数`);
  }
};

const splitContent = (content: string): SplitContent => {
  const eol: '\n' | '\r\n' = content.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replace(/\r\n/g, '\n');
  const trailingNewline =
    normalized.length > 0 && normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (trailingNewline && lines.at(-1) === '') {
    lines.pop();
  }
  return { lines, eol, trailingNewline };
};

const joinContent = (
  lines: string[],
  eol: '\n' | '\r\n',
  trailingNewline: boolean,
) => {
  let result = lines.join(eol);
  if (trailingNewline) {
    result += eol;
  }
  return result;
};

const validateLinePatch = (patch: LinePatch, lineCount: number) => {
  assertPositiveInt(patch.start, 'lines.start');
  const end = patch.end ?? patch.start;
  assertPositiveInt(end, 'lines.end');
  if (end < patch.start) {
    throw new Error('lines.end 不能小于 lines.start');
  }

  switch (patch.action) {
    case 'replace':
    case 'insert_before':
    case 'insert_after':
      if (typeof patch.content !== 'string') {
        throw new Error(`lines.${patch.action} 需要 content`);
      }
      break;
    case 'delete':
      break;
    default:
      throw new Error(`未知的 lines.action: ${String(patch.action)}`);
  }

  if (patch.action === 'insert_before' || patch.action === 'insert_after') {
    if (patch.end !== undefined && patch.end !== patch.start) {
      throw new Error(`${patch.action} 不支持行范围，请只设置 start`);
    }
    const maxLine =
      patch.action === 'insert_after' ? lineCount + 1 : lineCount;
    if (patch.start > maxLine) {
      throw new Error(
        `${patch.action} 的 start=${patch.start} 超出范围（1-${maxLine}）`,
      );
    }
    return;
  }

  if (end > lineCount) {
    throw new Error(
      `行范围 ${patch.start}-${end} 超出文件行数 ${lineCount}`,
    );
  }
};

const applyLinePatch = (lines: string[], patch: LinePatch): void => {
  const end = patch.end ?? patch.start;
  const startIndex = patch.start - 1;
  const endIndex = end - 1;

  switch (patch.action) {
    case 'replace': {
      const inserted = (patch.content ?? '').split('\n');
      lines.splice(startIndex, endIndex - startIndex + 1, ...inserted);
      break;
    }
    case 'delete':
      lines.splice(startIndex, endIndex - startIndex + 1);
      break;
    case 'insert_before':
      lines.splice(startIndex, 0, ...(patch.content ?? '').split('\n'));
      break;
    case 'insert_after':
      lines.splice(startIndex + 1, 0, ...(patch.content ?? '').split('\n'));
      break;
  }
};

const applyLinePatches = (lines: string[], patches: LinePatch[]) => {
  const sorted = [...patches].sort((a, b) => b.start - a.start);
  for (const patch of sorted) {
    validateLinePatch(patch, lines.length);
    applyLinePatch(lines, patch);
  }
  return sorted.length;
};

const validateColumnPatch = (patch: ColumnPatch, lines: string[]) => {
  assertPositiveInt(patch.line, 'columns.line');
  assertPositiveInt(patch.start, 'columns.start');
  const end = patch.end ?? patch.start;
  assertPositiveInt(end, 'columns.end');
  if (end < patch.start) {
    throw new Error('columns.end 不能小于 columns.start');
  }
  if (patch.line > lines.length) {
    throw new Error(
      `columns.line=${patch.line} 超出文件行数 ${lines.length}`,
    );
  }
  const line = lines[patch.line - 1] ?? '';
  if (patch.start > line.length + 1) {
    throw new Error(
      `columns.start=${patch.start} 超出第 ${patch.line} 行长度 ${line.length}`,
    );
  }
  if (end > line.length) {
    throw new Error(
      `columns.end=${end} 超出第 ${patch.line} 行长度 ${line.length}`,
    );
  }
  if (typeof patch.content !== 'string') {
    throw new Error('columns 需要 content');
  }
};

const applyColumnPatch = (line: string, patch: ColumnPatch) => {
  const startIndex = patch.start - 1;
  const endIndex = (patch.end ?? patch.start) - 1;
  return (
    line.slice(0, startIndex) + patch.content + line.slice(endIndex + 1)
  );
};

const applyColumnPatches = (lines: string[], patches: ColumnPatch[]) => {
  const sorted = [...patches].sort((a, b) => {
    if (b.line !== a.line) return b.line - a.line;
    return b.start - a.start;
  });
  for (const patch of sorted) {
    validateColumnPatch(patch, lines);
    const index = patch.line - 1;
    lines[index] = applyColumnPatch(lines[index] ?? '', patch);
  }
  return sorted.length;
};

const expandReplacement = (
  replacement: string,
  match: string,
  captures: string[],
  offset: number,
  whole: string,
) =>
  replacement.replace(/\$(\$|&|`|'|\d+)/g, (_token, group) => {
    switch (group) {
      case '$':
        return '$';
      case '&':
        return match;
      case '`':
        return whole.slice(0, offset);
      case "'":
        return whole.slice(offset + match.length);
      default: {
        const index = Number(group);
        return captures[index - 1] ?? '';
      }
    }
  });

const applyRegexPatch = (content: string, patch: RegexPatch) => {
  let flags = patch.flags ?? 'g';
  if (patch.maxReplacements !== undefined && !flags.includes('g')) {
    flags += 'g';
  }

  let regex: RegExp;
  try {
    regex = new RegExp(patch.pattern, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无效的正则 pattern: ${message}`);
  }

  let replacements = 0;
  const limit = patch.maxReplacements;

  const next = content.replace(regex, (match, ...args) => {
    const offset = args[args.length - 2];
    const whole = args[args.length - 1];
    const captures = args.slice(0, -2) as string[];

    if (limit !== undefined && replacements >= limit) {
      return match;
    }

    replacements += 1;
    return expandReplacement(
      patch.replacement,
      match,
      captures,
      offset as number,
      whole as string,
    );
  });

  return { content: next, replacements };
};

const applyRegexPatches = (content: string, patches: RegexPatch[]) => {
  let current = content;
  let total = 0;
  for (const patch of patches) {
    if (typeof patch.pattern !== 'string' || !patch.pattern) {
      throw new Error('regex.pattern 不能为空');
    }
    if (typeof patch.replacement !== 'string') {
      throw new Error('regex.replacement 必须是字符串');
    }
    const { content: next, replacements } = applyRegexPatch(current, patch);
    current = next;
    total += replacements;
  }
  return { content: current, replacements: total };
};

export const applyFilePatches = (
  content: string,
  input: ApplyPatchesInput,
): ApplyPatchesResult => {
  const { lines: linePatches = [], columns: columnPatches = [], regex: regexPatches = [] } =
    input;

  if (
    linePatches.length === 0 &&
    columnPatches.length === 0 &&
    regexPatches.length === 0
  ) {
    throw new Error('至少需要提供 lines、columns、regex 之一');
  }

  const split = splitContent(content);
  const lineEdits =
    linePatches.length > 0 ? applyLinePatches(split.lines, linePatches) : 0;
  const columnEdits =
    columnPatches.length > 0
      ? applyColumnPatches(split.lines, columnPatches)
      : 0;

  let result = joinContent(split.lines, split.eol, split.trailingNewline);
  let regexReplacements = 0;
  if (regexPatches.length > 0) {
    const regexResult = applyRegexPatches(result, regexPatches);
    result = regexResult.content;
    regexReplacements = regexResult.replacements;
  }

  return {
    content: result,
    lineEdits,
    columnEdits,
    regexReplacements,
  };
};
