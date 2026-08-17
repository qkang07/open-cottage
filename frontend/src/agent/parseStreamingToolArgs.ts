/** 从流式累积中的工具参数 JSON 片段提取字段（不要求完整 JSON） */

export const FILE_WRITE_TOOL_NAMES = ['writeFile', 'createFile'] as const;

export type FileWriteToolName = (typeof FILE_WRITE_TOOL_NAMES)[number];

export const isFileWriteToolName = (name: string): name is FileWriteToolName =>
  (FILE_WRITE_TOOL_NAMES as readonly string[]).includes(name);

const unescapeJsonStringFragment = (raw: string): string => {
  let result = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      result += ch;
      continue;
    }
    i++;
    if (i >= raw.length) break;
    const next = raw[i];
    switch (next) {
      case '"':
        result += '"';
        break;
      case '\\':
        result += '\\';
        break;
      case '/':
        result += '/';
        break;
      case 'n':
        result += '\n';
        break;
      case 'r':
        result += '\r';
        break;
      case 't':
        result += '\t';
        break;
      case 'b':
        result += '\b';
        break;
      case 'f':
        result += '\f';
        break;
      case 'u': {
        if (i + 4 < raw.length) {
          result += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16));
          i += 4;
        }
        break;
      }
      default:
        result += next;
    }
  }
  return result;
};

export const extractPartialJsonString = (
  raw: string,
  key: string,
): string | undefined => {
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*"`);
  const match = keyPattern.exec(raw);
  if (!match) return undefined;

  const start = match.index + match[0].length;
  let escaped = '';
  let i = start;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"') {
      return unescapeJsonStringFragment(escaped);
    }
    if (ch === '\\') {
      escaped += ch;
      i++;
      if (i < raw.length) escaped += raw[i];
      i++;
      continue;
    }
    escaped += ch;
    i++;
  }
  return unescapeJsonStringFragment(escaped);
};

export const parseStreamingFileWriteArgs = (
  argsRaw: string,
): { path?: string; content?: string; complete: boolean } => {
  const path = extractPartialJsonString(argsRaw, 'path');
  const content = extractPartialJsonString(argsRaw, 'content');
  let complete = false;
  try {
    const parsed = JSON.parse(argsRaw) as unknown;
    complete =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    complete = false;
  }
  return { path, content, complete };
};
