import {
  colIndexToLetters,
  formatReferenceLabel,
  type ChatFileReference,
  type SpreadsheetAnchor,
} from './fileReferences';
import { resolveReferenceBlock, type ReadTextFileFn } from './resolveReferenceContent';
import {
  buildLlmUserMessage,
  type ComposedUserMessage,
  type StoredFileReference,
} from './userMessageFormat';

export type ReadFileFn = ReadTextFileFn;

const toStoredReference = (ref: ChatFileReference): StoredFileReference => ({
  id: ref.id,
  path: ref.path,
  label: formatReferenceLabel(ref),
  entryType: ref.entryType,
  anchor: ref.anchor,
});

export type ComposeUserMessageOptions = {
  /** 预览区当前打开的文件；作为额外上下文，不等同于显式引用 */
  activeFilePath?: string | null;
  /** 目录引用时用于展开目录下文件 */
  listFilesUnderPath?: (path: string) => Promise<string[]>;
};

export async function composeUserMessage(
  userText: string,
  references: readonly ChatFileReference[],
  readFile: ReadFileFn,
  options?: ComposeUserMessageOptions,
): Promise<ComposedUserMessage> {
  const trimmed = userText.trim();
  const activeFilePath = options?.activeFilePath?.trim() || undefined;

  if (!references.length && !activeFilePath) {
    return {
      llmContent: trimmed,
      userText: trimmed,
      references: [],
    };
  }

  const storedRefs = references.map(toStoredReference);

  const blocks: string[] = [];
  for (const ref of references) {
    blocks.push(
      await resolveReferenceBlock(ref, readFile, {
        listFilesUnderPath: options?.listFilesUnderPath,
      }),
    );
  }

  const llmContent = buildLlmUserMessage({
    references: storedRefs,
    fileBlocks: blocks.join('\n\n'),
    writeHints: buildWriteHints(references),
    userText: trimmed,
    activeFilePath,
  });

  return {
    llmContent,
    userText: trimmed,
    references: storedRefs,
    activeFilePath,
  };
}

const buildWriteHints = (references: readonly ChatFileReference[]): string => {
  const lines: string[] = [];
  for (const ref of references) {
    if (ref.anchor?.kind === 'spreadsheet') {
      lines.push(spreadsheetWriteHint(ref.path, ref.anchor));
    }
  }
  return lines.join('\n');
};

const spreadsheetWriteHint = (
  path: string,
  anchor: SpreadsheetAnchor,
): string => {
  const from = `${colIndexToLetters(anchor.startCol)}${anchor.startRow}`;
  const to = `${colIndexToLetters(anchor.endCol)}${anchor.endRow}`;
  const a1 = from === to ? from : `${from}:${to}`;
  const rows = anchor.endRow - anchor.startRow + 1;
  const cols = anchor.endCol - anchor.startCol + 1;
  return (
    `${path} → writeSpreadsheet patch: sheet="${anchor.sheet}" a1="${a1}" ` +
    `cells ${rows}×${cols}`
  );
};
