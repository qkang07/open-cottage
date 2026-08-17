import type { FileReferenceAnchor } from './fileReferences';
import type { ChatAttachment } from './attachments';

/** 持久化 / UI 用的引用摘要 */
export type StoredFileReference = {
  id?: string;
  path: string;
  label: string;
  entryType?: 'file' | 'directory';
  anchor?: FileReferenceAnchor;
  /** 未手动 @，来自预览区当前打开文件 */
  implicit?: boolean;
};

export type ComposedUserMessage = {
  /** 发给模型的完整文本 */
  llmContent: string;
  /** 输入框原文（UI 展示） */
  userText: string;
  references: readonly StoredFileReference[];
  /** 未手动引用时，默认指向的当前打开文件 */
  activeFilePath?: string;
  /** 图片附件（多模态） */
  attachments?: ChatAttachment[];
};

export type ParsedUserMessageDisplay = {
  userText: string;
  references: StoredFileReference[];
  activeFilePath?: string;
};

const REFS_OPEN = '<cottage_refs>';
const REFS_CLOSE = '</cottage_refs>';
const MSG_OPEN = '<cottage_message>';
const MSG_CLOSE = '</cottage_message>';
const HINTS_OPEN = '<cottage_write_hints>';
const HINTS_CLOSE = '</cottage_write_hints>';
const OPEN_FILE_CONTEXT_OPEN = '<cottage_open_file_context';
const OPEN_FILE_CONTEXT_CLOSE = '</cottage_open_file_context>';

export const buildActiveFileTag = (path: string): string =>
  `<cottage_active_file path="${escapeAttr(path)}" />`;

const escapeAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const LEGACY_HEADER_RE = new RegExp(
  '^以下为用户引用的工作区文件[^\\n]*:\\n([\\s\\S]*?)(?=\\n\\n<file_reference|\\n\\n---|\\n*$)',
);


export const serializeRefsForLlm = (
  refs: readonly StoredFileReference[],
): string => {
  if (!refs.length) return '';
  return `${REFS_OPEN}\n${JSON.stringify(refs)}\n${REFS_CLOSE}`;
};

export const buildLlmUserMessage = (parts: {
  references: readonly StoredFileReference[];
  fileBlocks: string;
  writeHints?: string;
  userText: string;
  activeFilePath?: string;
}): string => {
  const chunks: string[] = [];
  if (parts.activeFilePath) {
    chunks.push(buildActiveFileTag(parts.activeFilePath));
    chunks.push(buildOpenFileContextBlock(parts.activeFilePath));
  }
  const refsBlock = serializeRefsForLlm(parts.references);
  if (refsBlock) chunks.push(refsBlock);
  if (parts.fileBlocks.trim()) chunks.push(parts.fileBlocks.trim());
  if (parts.writeHints?.trim()) {
    chunks.push(`${HINTS_OPEN}\n${parts.writeHints.trim()}\n${HINTS_CLOSE}`);
  }
  const text = parts.userText.trim();
  if (text) {
    chunks.push(`${MSG_OPEN}\n${text}\n${MSG_CLOSE}`);
  }
  return chunks.join('\n\n');
};

/** 从持久化 content 解析 UI 展示（无 metadata 时兼容旧格式） */
export const parseUserMessageDisplay = (
  content: string,
  stored?: {
    userText?: string;
    fileReferences?: readonly StoredFileReference[];
    activeFilePath?: string;
  },
): ParsedUserMessageDisplay => {
  if (
    stored?.fileReferences?.length ||
    stored?.userText !== undefined ||
    stored?.activeFilePath
  ) {
    return {
      userText: stored.userText ?? '',
      references: [...(stored.fileReferences ?? [])],
      activeFilePath: stored.activeFilePath,
    };
  }

  const modern = parseModernFormat(content);
  if (modern) return modern;

  return parseLegacyFormat(content);
};

const parseModernFormat = (content: string): ParsedUserMessageDisplay | null => {
  const activeFilePath = parseActiveFilePath(content);
  const refsMatch = content.match(
    new RegExp(`${escapeRe(REFS_OPEN)}\\s*([\\s\\S]*?)\\s*${escapeRe(REFS_CLOSE)}`),
  );
  const msgMatch = content.match(
    new RegExp(`${escapeRe(MSG_OPEN)}\\s*([\\s\\S]*?)\\s*${escapeRe(MSG_CLOSE)}`),
  );
  if (!refsMatch && !msgMatch && !activeFilePath) return null;

  let references: StoredFileReference[] = [];
  if (refsMatch?.[1]) {
    try {
      const parsed = JSON.parse(refsMatch[1].trim()) as unknown;
      if (Array.isArray(parsed)) {
        references = parsed.filter(isStoredFileReference);
      }
    } catch {
      references = [];
    }
  }

  return {
    userText: msgMatch?.[1]?.trim() ?? '',
    references,
    activeFilePath,
  };
};

const parseLegacyFormat = (content: string): ParsedUserMessageDisplay => {
  const references: StoredFileReference[] = [];
  const headerMatch = content.match(LEGACY_HEADER_RE);
  if (headerMatch?.[1]) {
    for (const line of headerMatch[1].split('\n')) {
      const m = line.match(/^\s*-\s+(.+)$/);
      if (m?.[1]) {
        const label = m[1].trim();
        references.push({ path: label.split(/[[:(]/)[0] ?? label, label });
      }
    }
  }

  const parts = content.split(/\n---\n/);
  const userText =
    parts.length > 1 ? parts[parts.length - 1].trim() : content.trim();

  return { userText, references };
};

const isStoredFileReference = (v: unknown): v is StoredFileReference =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as StoredFileReference).path === 'string' &&
  typeof (v as StoredFileReference).label === 'string';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildOpenFileContextBlock = (path: string): string =>
  `${OPEN_FILE_CONTEXT_OPEN} path="${escapeAttr(path)}">\n` +
  '这是 IDE 当前打开的文件，仅作为上下文信息提供。\n' +
  '它不是用户显式引用的文件；除非用户明确要求，请不要假设必须修改该文件。\n' +
  `${OPEN_FILE_CONTEXT_CLOSE}`;

const parseActiveFilePath = (content: string): string | undefined => {
  const contextMatch = content.match(
    /<cottage_open_file_context\s+path="([^"]+)"[^>]*>/,
  );
  if (contextMatch?.[1]) {
    return unescapeAttr(contextMatch[1]);
  }
  const legacyMatch = content.match(/<cottage_active_file\s+path="([^"]+)"\s*\/>/);
  if (legacyMatch?.[1]) {
    return unescapeAttr(legacyMatch[1]);
  }
  return undefined;
};

const unescapeAttr = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
