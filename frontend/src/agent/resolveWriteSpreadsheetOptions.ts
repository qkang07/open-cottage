import type { ChatFileReference, SpreadsheetAnchor } from '../chat/fileReferences';
import { getWorkspaceActiveFile } from '../chat/workspaceActiveFile';
import { colIndexToLetters } from '../chat/fileReferences';
import {
  detectOfficeKind,
  readSpreadsheet,
  type DocumentWriteContent,
  type PatchOfficeTarget,
  type SpreadsheetContent,
} from './officeDocuments';
import { normalizeSpreadsheetRange } from './officeRanges';
import {
  normalizeSpreadsheetSheets,
  normalizeToolWriteContent,
  spreadsheetRangeSchema,
  toolWriteSpreadsheetInputSchema,
  type StructuredWriteInput,
  writeContentSchema,
} from './spreadsheetWriteSchema';
import type { z } from 'zod';

export type WriteSpreadsheetToolInput = z.infer<
  typeof toolWriteSpreadsheetInputSchema
>;

const pathsEqual = (a: string, b: string): boolean =>
  a.replace(/\\/g, '/') === b.replace(/\\/g, '/');

const spreadsheetAnchorToTarget = (
  anchor: SpreadsheetAnchor,
): PatchOfficeTarget['spreadsheetRange'] => {
  const from = `${colIndexToLetters(anchor.startCol)}${anchor.startRow}`;
  const to = `${colIndexToLetters(anchor.endCol)}${anchor.endRow}`;
  const a1 = from === to ? from : `${from}:${to}`;
  return { sheet: anchor.sheet, a1 };
};

const findSpreadsheetRef = (
  path: string,
  refs: readonly ChatFileReference[],
): SpreadsheetAnchor | undefined => {
  for (const ref of refs) {
    if (!pathsEqual(ref.path, path)) continue;
    if (ref.anchor?.kind === 'spreadsheet') return ref.anchor;
  }
  return undefined;
};

const cellsMatchAnchor = (
  cells: (string | number | boolean | null)[][],
  anchor: SpreadsheetAnchor,
): boolean => {
  const rows = anchor.endRow - anchor.startRow + 1;
  const cols = anchor.endCol - anchor.startCol + 1;
  return (
    cells.length === rows && cells.every((row) => row.length === cols)
  );
};

const getSpreadsheetCells = (
  structured: StructuredWriteInput,
  sheetHint?: string,
): (string | number | boolean | null)[][] | undefined => {
  if (structured.cells !== undefined) {
    return structured.cells;
  }
  let sheets = structured.sheets;
  if (sheets === undefined && structured.rows !== undefined) {
    sheets = structured.rows;
  }
  if (sheets === undefined) return undefined;

  const normalized = normalizeSpreadsheetSheets(
    sheets,
    structured.sheetNames,
  );
  const name =
    sheetHint ??
    structured.sheetNames?.[0] ??
    Object.keys(normalized)[0];
  if (!name) return undefined;
  return normalized[name];
};

const toPatchTarget = (
  target: NonNullable<WriteSpreadsheetToolInput['target']>,
): PatchOfficeTarget => {
  if (!target.spreadsheetRange) return {};
  const range = spreadsheetRangeSchema.parse(target.spreadsheetRange);
  return {
    spreadsheetRange: normalizeSpreadsheetRange(range.sheet, range),
  };
};

const assertSafeSpreadsheetReplace = async (
  path: string,
  content: SpreadsheetContent,
): Promise<void> => {
  const existing = await readSpreadsheet(path);
  for (const name of content.sheetNames) {
    const oldRows = existing.sheets[name]?.length ?? 0;
    const newRows = content.sheets[name]?.length ?? 0;
    if (oldRows > 0 && newRows > 0 && newRows < oldRows) {
      throw new Error(
        `表格「${name}」不能用 replace 只写入 ${newRows} 行（原表 ${oldRows} 行），会丢失其余数据。` +
          '请使用 mode=patch，并设置 target.spreadsheetRange（与 readSpreadsheet/用户引用范围一致），content 用 cells 或同尺寸的 sheets。',
      );
    }
  }
};

export type ResolvedWriteSpreadsheetOptions = {
  mode: 'replace' | 'patch';
  target?: PatchOfficeTarget;
  content: DocumentWriteContent;
};

const ensureSpreadsheetPatchTarget = (
  target: PatchOfficeTarget | undefined,
  refAnchor: SpreadsheetAnchor | undefined,
): PatchOfficeTarget => {
  if (target?.spreadsheetRange) return target;
  if (refAnchor) {
    return { ...target, spreadsheetRange: spreadsheetAnchorToTarget(refAnchor) };
  }
  throw new Error(
    '表格局部写入须提供 target.spreadsheetRange（sheet + a1），或让用户在消息中引用该单元格区域',
  );
};

/** 解析 writeSpreadsheet 的 mode/target；用户引用表格区域时自动 patch */
export const resolveWriteSpreadsheetOptions = async (
  input: WriteSpreadsheetToolInput,
  refs: readonly ChatFileReference[],
): Promise<ResolvedWriteSpreadsheetOptions> => {
  const activeFile = getWorkspaceActiveFile();
  const path =
    input.path.trim() ||
    activeFile ||
    refs[0]?.path ||
    '';
  if (!path) {
    throw new Error('请指定表格路径，或在预览区打开目标文件');
  }

  const resolvedInput = { ...input, path };
  const { mode: explicitMode, target: rawTarget } = resolvedInput;
  const kind = detectOfficeKind(path);
  if (kind !== 'spreadsheet') {
    throw new Error('writeSpreadsheet 仅支持 xlsx/xls/csv');
  }

  const rawStructured = normalizeToolWriteContent(resolvedInput.content);
  let target = rawTarget ? toPatchTarget(rawTarget) : undefined;

  if (typeof rawStructured === 'object' && rawStructured !== null) {
    const structured = rawStructured as StructuredWriteInput;
    const refAnchor = findSpreadsheetRef(path, refs);
    const cells = getSpreadsheetCells(structured, refAnchor?.sheet);

    if (explicitMode === 'replace') {
      const content = writeContentSchema.parse(
        rawStructured,
      ) as DocumentWriteContent;
      if (typeof content === 'object' && 'sheets' in content) {
        await assertSafeSpreadsheetReplace(path, content);
      }
      return { mode: 'replace', target, content };
    }

    const shouldPatch =
      explicitMode === 'patch' ||
      (cells !== undefined &&
        refAnchor !== undefined &&
        cellsMatchAnchor(cells, refAnchor));

    if (shouldPatch && cells !== undefined) {
      target = ensureSpreadsheetPatchTarget(target, refAnchor);
      const content = writeContentSchema.parse(
        structured.cells !== undefined
          ? rawStructured
          : { ...structured, cells, sheetNames: [refAnchor!.sheet] },
      ) as DocumentWriteContent;
      return { mode: 'patch', target, content };
    }

    if (cells !== undefined) {
      throw new Error(
        'content.cells 须配合 mode=patch 与 target.spreadsheetRange；行列数须与范围一致，或让用户引用该表格区域',
      );
    }
  }

  const content = writeContentSchema.parse(
    rawStructured,
  ) as DocumentWriteContent;
  const mode = explicitMode ?? 'replace';

  if (mode === 'replace' && typeof content === 'object' && 'sheets' in content) {
    await assertSafeSpreadsheetReplace(path, content);
  }

  return { mode, target, content };
};
