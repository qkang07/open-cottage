import { getPreviewKind } from '../workspace/previewKind';

export const COTTAGE_FILE_DRAG_TYPE = 'application/x-cottage-file-path';

export const MAX_INLINE_CHARS = 80_000;
export const MAX_INLINE_LINES = 500;

export type TextAnchor = {
  kind: 'text';
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type SpreadsheetAnchor = {
  kind: 'spreadsheet';
  sheet: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

export type WordAnchor = {
  kind: 'word';
  startParagraph: number;
  endParagraph: number;
  selectedText?: string;
};

export type PresentationAnchor = {
  kind: 'presentation';
  slideIndex: number;
  textIndex?: number;
  selectedText?: string;
};

export type FileReferenceAnchor =
  | TextAnchor
  | SpreadsheetAnchor
  | WordAnchor
  | PresentationAnchor;

export type ChatFileReference = {
  id: string;
  path: string;
  entryType?: 'file' | 'directory';
  anchor?: FileReferenceAnchor;
};

export type NewChatFileReference = {
  path: string;
  entryType?: 'file' | 'directory';
  anchor?: FileReferenceAnchor;
};

export const newReferenceId = () => crypto.randomUUID();

export const isTextReferenceable = (path: string): boolean => {
  const kind = getPreviewKind(path);
  return kind === 'text' || kind === 'markdown' || kind === 'html';
};

export const colIndexToLetters = (col: number): string => {
  let n = Math.max(1, col);
  let letters = '';
  while (n > 0) {
    n -= 1;
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26);
  }
  return letters;
};

export const anchorKey = (anchor?: FileReferenceAnchor): string =>
  anchor ? JSON.stringify(anchor) : '';

export const formatReferenceLabel = (ref: ChatFileReference): string => {
  const a = ref.anchor;
  if (ref.entryType === 'directory' && !a) return `${ref.path}/`;
  if (!a) return ref.path;
  if (a.kind === 'text') {
    const start = `${a.startLine}:${a.startColumn}`;
    const end = `${a.endLine}:${a.endColumn}`;
    if (start === end) return `${ref.path}:${start}`;
    return `${ref.path}:${start}-${end}`;
  }
  if (a.kind === 'spreadsheet') {
    const from = `${colIndexToLetters(a.startCol)}${a.startRow}`;
    const to = `${colIndexToLetters(a.endCol)}${a.endRow}`;
    const range = from === to ? from : `${from}:${to}`;
    return `${ref.path}[${a.sheet}]!${range}`;
  }
  if (a.kind === 'word') {
    if (a.startParagraph === a.endParagraph) {
      return `${ref.path}:¶${a.startParagraph}`;
    }
    return `${ref.path}:¶${a.startParagraph}-${a.endParagraph}`;
  }
  if (a.kind === 'presentation') {
    if (a.textIndex != null) {
      return `${ref.path}:slide${a.slideIndex}#${a.textIndex}`;
    }
    return `${ref.path}:slide${a.slideIndex}`;
  }
  return ref.path;
};

export type TextPosition = { line: number; column: number };

export const lineNumberAtOffset = (text: string, offset: number): number =>
  positionAtOffset(text, offset).line;

export const positionAtOffset = (text: string, offset: number): TextPosition => {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let column = 1;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
};

export const offsetAtPosition = (
  text: string,
  line: number,
  column: number,
): number => {
  const lines = text.split('\n');
  const lineIndex = Math.max(1, Math.min(line, lines.length)) - 1;
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) {
    offset += lines[i].length + 1;
  }
  const lineText = lines[lineIndex] ?? '';
  const colIndex = Math.max(1, column) - 1;
  return offset + Math.min(colIndex, lineText.length);
};

export const normalizeTextAnchor = (
  start: TextPosition,
  end: TextPosition,
): TextAnchor => {
  const startOffset =
    start.line * 100000 + start.column;
  const endOffset = end.line * 100000 + end.column;
  if (startOffset <= endOffset) {
    return {
      kind: 'text',
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
    };
  }
  return {
    kind: 'text',
    startLine: end.line,
    startColumn: end.column,
    endLine: start.line,
    endColumn: start.column,
  };
};

export const textAnchorFromOffsets = (
  text: string,
  startOffset: number,
  endOffset: number,
): TextAnchor =>
  normalizeTextAnchor(
    positionAtOffset(text, startOffset),
    positionAtOffset(text, endOffset),
  );

export const textAnchorFromSnippet = (
  source: string,
  snippet: string,
): TextAnchor | null => {
  const trimmed = snippet.trim();
  if (!trimmed) return null;
  const start = source.indexOf(trimmed);
  if (start < 0) return null;
  return textAnchorFromOffsets(source, start, start + trimmed.length);
};

export const normalizeSpreadsheetAnchor = (
  sheet: string,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): SpreadsheetAnchor => ({
  kind: 'spreadsheet',
  sheet,
  startRow: Math.min(r1, r2),
  startCol: Math.min(c1, c2),
  endRow: Math.max(r1, r2),
  endCol: Math.max(c1, c2),
});

export const extractTextByAnchor = (content: string, anchor: TextAnchor): string => {
  const startOffset = offsetAtPosition(
    content,
    anchor.startLine,
    anchor.startColumn,
  );
  const endOffset = offsetAtPosition(content, anchor.endLine, anchor.endColumn);
  const from = Math.min(startOffset, endOffset);
  const to = Math.max(startOffset, endOffset);
  return content.slice(from, to);
};

export const withLineNumbers = (content: string, startLine: number): string =>
  content
    .split('\n')
    .map((line, i) => `${startLine + i}| ${line}`)
    .join('\n');

export const truncateContent = (
  content: string,
  opts?: { maxChars?: number; maxLines?: number },
): { text: string; truncated: boolean } => {
  const maxChars = opts?.maxChars ?? MAX_INLINE_CHARS;
  const maxLines = opts?.maxLines ?? MAX_INLINE_LINES;
  const lines = content.split('\n');
  let truncated = false;
  let slice = lines;
  if (lines.length > maxLines) {
    slice = lines.slice(0, maxLines);
    truncated = true;
  }
  let text = slice.join('\n');
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }
  if (truncated) {
    text += '\n…（内容已截断；表格 readSpreadsheet，Word readWord，PPT readPresentation，文本 readFile）';
  }
  return { text, truncated };
};
