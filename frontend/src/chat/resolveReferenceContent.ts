import {
  readPresentation,
  readSpreadsheet,
  readWordDocument,
} from '../agent/officeDocuments';
import { splitWordParagraphs } from '../agent/officeRanges';
import {
  colIndexToLetters,
  extractTextByAnchor,
  formatReferenceLabel,
  isTextReferenceable,
  truncateContent,
  withLineNumbers,
  type ChatFileReference,
  type FileReferenceAnchor,
  type SpreadsheetAnchor,
  type TextAnchor,
} from './fileReferences';

export type ReadTextFileFn = (path: string) => Promise<string>;
export type ListFilesUnderPathFn = (path: string) => Promise<string[]>;

type ResolveReferenceBlockOptions = {
  listFilesUnderPath?: ListFilesUnderPathFn;
};

export async function resolveReferenceBlock(
  ref: ChatFileReference,
  readTextFile: ReadTextFileFn,
  options?: ResolveReferenceBlockOptions,
): Promise<string> {
  const label = formatReferenceLabel(ref);
  const pathAttr = escapeAttr(ref.path);

  if (ref.entryType === 'directory') {
    return resolveDirectoryBlock(ref.path, pathAttr, label, readTextFile, options);
  }

  if (!ref.anchor) {
    if (!isTextReferenceable(ref.path)) {
      return officeHintBlock(ref.path, label, ref.anchor);
    }
    try {
      const content = await readTextFile(ref.path);
      const { text } = truncateContent(content);
      return `<file_reference path="${pathAttr}">\n${text}\n</file_reference>`;
    } catch (error) {
      return errorBlock(ref.path, label, error);
    }
  }

  const anchor = ref.anchor;
  if (anchor.kind === 'text') {
    return resolveTextBlock(ref.path, pathAttr, label, anchor, readTextFile);
  }
  if (anchor.kind === 'spreadsheet') {
    return resolveSpreadsheetBlock(ref.path, pathAttr, label, anchor);
  }
  if (anchor.kind === 'word') {
    return resolveWordBlock(ref.path, pathAttr, label, anchor);
  }
  return resolvePresentationBlock(ref.path, pathAttr, label, anchor);
}

const resolveTextBlock = async (
  path: string,
  pathAttr: string,
  label: string,
  anchor: TextAnchor,
  readTextFile: ReadTextFileFn,
): Promise<string> => {
  try {
    const content = await readTextFile(path);
    const slice = extractTextByAnchor(content, anchor);
    const { text } = truncateContent(slice);
    const loc = `${anchor.startLine}:${anchor.startColumn}-${anchor.endLine}:${anchor.endColumn}`;
    const numbered = withLineNumbers(text, anchor.startLine);
    return (
      `<file_reference path="${pathAttr}" location="${loc}">\n` +
      numbered +
      `\n</file_reference>`
    );
  } catch (error) {
    return errorBlock(path, label, error);
  }
};

const resolveSpreadsheetBlock = async (
  path: string,
  pathAttr: string,
  label: string,
  anchor: SpreadsheetAnchor,
): Promise<string> => {
  try {
    const data = await readSpreadsheet(path, { sheet: anchor.sheet });
    const rows = data.sheets[anchor.sheet] ?? [];
    const lines: string[] = [];
    for (let r = anchor.startRow; r <= anchor.endRow; r++) {
      const row = rows[r - 1] ?? [];
      const cells: string[] = [];
      for (let c = anchor.startCol; c <= anchor.endCol; c++) {
        const v = row[c - 1];
        cells.push(v === null || v === undefined ? '' : String(v));
      }
      lines.push(
        `${colIndexToLetters(anchor.startCol)}${r}: ${cells.join('\t')}`,
      );
    }
    const body = lines.join('\n');
    const { text } = truncateContent(body, { maxLines: MAX_TABLE_ROWS });
    const rangeAttr = `${colIndexToLetters(anchor.startCol)}${anchor.startRow}:${colIndexToLetters(anchor.endCol)}${anchor.endRow}`;
    return (
      `<file_reference path="${pathAttr}" type="spreadsheet" sheet="${escapeAttr(anchor.sheet)}" range="${rangeAttr}">\n` +
      text +
      `\n</file_reference>`
    );
  } catch (error) {
    return errorBlock(path, label, error);
  }
};

const MAX_TABLE_ROWS = 200;
const MAX_DIRECTORY_FILES = 12;
const MAX_DIRECTORY_TOTAL_CHARS = 24_000;
const MAX_DIRECTORY_FILE_CHARS = 4_000;
const MAX_DIRECTORY_FILE_LINES = 160;

const resolveDirectoryBlock = async (
  path: string,
  pathAttr: string,
  label: string,
  readTextFile: ReadTextFileFn,
  options?: ResolveReferenceBlockOptions,
): Promise<string> => {
  const listFilesUnderPath = options?.listFilesUnderPath;
  if (!listFilesUnderPath) {
    return (
      `<folder_reference path="${pathAttr}" error="list-unavailable">\n` +
      `无法展开目录 ${label}：当前环境未提供目录读取能力\n` +
      `</folder_reference>`
    );
  }
  try {
    const allFiles = (await listFilesUnderPath(path))
      .filter((p) => p.startsWith(`${path}/`))
      .sort((a, b) => a.localeCompare(b));
    const textFiles = allFiles.filter(isTextReferenceable);
    const selectedFiles = textFiles.slice(0, MAX_DIRECTORY_FILES);
    const parts: string[] = [];
    let totalChars = 0;
    for (const filePath of selectedFiles) {
      if (totalChars >= MAX_DIRECTORY_TOTAL_CHARS) break;
      try {
        const raw = await readTextFile(filePath);
        const { text } = truncateContent(raw, {
          maxChars: MAX_DIRECTORY_FILE_CHARS,
          maxLines: MAX_DIRECTORY_FILE_LINES,
        });
        const block = `## ${filePath}\n${text}`;
        parts.push(block);
        totalChars += block.length;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const block = `## ${filePath}\n（读取失败：${msg}）`;
        parts.push(block);
        totalChars += block.length;
      }
    }
    const headerLines: string[] = [
      `目录：${path}`,
      `共 ${allFiles.length} 个文件，文本文件 ${textFiles.length} 个`,
      `已展开 ${Math.min(selectedFiles.length, parts.length)} 个文本文件`,
    ];
    if (textFiles.length > MAX_DIRECTORY_FILES) {
      headerLines.push(`其余 ${textFiles.length - MAX_DIRECTORY_FILES} 个文本文件未展开`);
    }
    const body = [...headerLines, '', ...parts].join('\n');
    return `<folder_reference path="${pathAttr}">\n${body}\n</folder_reference>`;
  } catch (error) {
    return errorBlock(path, label, error);
  }
};

const resolveWordBlock = async (
  path: string,
  pathAttr: string,
  label: string,
  anchor: import('./fileReferences').WordAnchor,
): Promise<string> => {
  try {
    const { text } = await readWordDocument(path);
    const paragraphs = splitWordParagraphs(text);
    const start = Math.max(1, anchor.startParagraph);
    const end = Math.min(paragraphs.length, anchor.endParagraph);
    const slice = paragraphs.slice(start - 1, end);
    let body = slice
      .map((p, i) => `¶${start + i}: ${p}`)
      .join('\n\n');
    if (anchor.selectedText) {
      body += `\n\n（用户选中文本）\n${anchor.selectedText}`;
    }
    const { text: truncated } = truncateContent(body);
    const loc = `paragraphs="${start}-${end}"`;
    return (
      `<file_reference path="${pathAttr}" type="word" ${loc}>\n` +
      truncated +
      `\n</file_reference>`
    );
  } catch (error) {
    return errorBlock(path, label, error);
  }
};

const resolvePresentationBlock = async (
  path: string,
  pathAttr: string,
  label: string,
  anchor: import('./fileReferences').PresentationAnchor,
): Promise<string> => {
  try {
    const { slides } = await readPresentation(path);
    const slide = slides.find((s) => s.index === anchor.slideIndex);
    if (!slide) {
      throw new Error(`幻灯片不存在: ${anchor.slideIndex}`);
    }
    const lines: string[] = [`幻灯片 ${anchor.slideIndex}`];
    if (anchor.textIndex != null) {
      const block = slide.texts[anchor.textIndex - 1];
      if (block) {
        lines.push(`文本块 #${anchor.textIndex}: ${block}`);
      }
    } else {
      slide.texts.forEach((t, i) => {
        lines.push(`#${i + 1}: ${t}`);
      });
    }
    if (anchor.selectedText) {
      lines.push('', `（用户选中文本）\n${anchor.selectedText}`);
    }
    const body = lines.join('\n');
    const loc =
      anchor.textIndex != null
        ? `slide="${anchor.slideIndex}" text="${anchor.textIndex}"`
        : `slide="${anchor.slideIndex}"`;
    return (
      `<file_reference path="${pathAttr}" type="presentation" ${loc}>\n` +
      body +
      `\n</file_reference>`
    );
  } catch (error) {
    return errorBlock(path, label, error);
  }
};

const officeHintBlock = (
  path: string,
  label: string,
  anchor?: FileReferenceAnchor,
) => {
  const pathAttr = escapeAttr(path);
  const loc = anchor ? ` location="${escapeAttr(formatAnchorAttr(anchor))}"` : '';
  return (
    `<file_reference path="${pathAttr}"${loc}>\n` +
    `（${label}：表格用 readSpreadsheet，Word 用 readWord，PPT 用 readPresentation）\n` +
    `</file_reference>`
  );
};

const formatAnchorAttr = (anchor: FileReferenceAnchor): string => {
  if (anchor.kind === 'spreadsheet') {
    return `${anchor.sheet}!${colIndexToLetters(anchor.startCol)}${anchor.startRow}`;
  }
  if (anchor.kind === 'word') {
    return `¶${anchor.startParagraph}-${anchor.endParagraph}`;
  }
  if (anchor.kind === 'presentation') {
    return `slide${anchor.slideIndex}`;
  }
  return `${anchor.startLine}:${anchor.startColumn}`;
};

const errorBlock = (path: string, label: string, error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    `<file_reference path="${escapeAttr(path)}" error="read-failed">\n` +
    `无法读取 ${label}：${msg}\n` +
    `</file_reference>`
  );
};

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
