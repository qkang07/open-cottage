/** Office 读写共用的范围类型（与聊天引用 anchor 语义一致） */

export type SpreadsheetRange = {
  sheet: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
};

export type WordRange = {
  startParagraph: number;
  endParagraph: number;
};

export type PresentationTarget = {
  slideIndex: number;
  textIndex?: number;
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

export const lettersToColIndex = (letters: string): number => {
  const upper = letters.toUpperCase();
  let col = 0;
  for (let i = 0; i < upper.length; i++) {
    const code = upper.charCodeAt(i);
    if (code < 65 || code > 90) {
      throw new Error(`无效的列标: ${letters}`);
    }
    col = col * 26 + (code - 64);
  }
  return col;
};

/** 解析 A1 或 A1:C3（1-based） */
export const parseA1Range = (
  range: string,
): Omit<SpreadsheetRange, 'sheet'> => {
  const trimmed = range.trim().toUpperCase();
  const parts = trimmed.split(':');
  const parseCell = (cell: string) => {
    const match = /^([A-Z]+)(\d+)$/.exec(cell);
    if (!match) throw new Error(`无效的单元格: ${cell}`);
    return {
      row: Number(match[2]),
      col: lettersToColIndex(match[1]),
    };
  };
  if (parts.length === 1) {
    const c = parseCell(parts[0]);
    return {
      startRow: c.row,
      startCol: c.col,
      endRow: c.row,
      endCol: c.col,
    };
  }
  if (parts.length === 2) {
    const a = parseCell(parts[0]);
    const b = parseCell(parts[1]);
    return {
      startRow: Math.min(a.row, b.row),
      startCol: Math.min(a.col, b.col),
      endRow: Math.max(a.row, b.row),
      endCol: Math.max(a.col, b.col),
    };
  }
  throw new Error(`无效的范围: ${range}`);
};

export const normalizeSpreadsheetRange = (
  sheet: string,
  range: Partial<SpreadsheetRange> & { a1?: string },
): SpreadsheetRange => {
  if (range.a1) {
    const parsed = parseA1Range(range.a1);
    return { sheet, ...parsed };
  }
  const startRow = range.startRow ?? 1;
  const startCol = range.startCol ?? 1;
  const endRow = range.endRow ?? startRow;
  const endCol = range.endCol ?? startCol;
  return {
    sheet,
    startRow: Math.min(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endRow: Math.max(startRow, endRow),
    endCol: Math.max(startCol, endCol),
  };
};

export const normalizeWordRange = (range: Partial<WordRange>): WordRange => {
  const start = range.startParagraph ?? 1;
  const end = range.endParagraph ?? start;
  return {
    startParagraph: Math.min(start, end),
    endParagraph: Math.max(start, end),
  };
};

export const formatSpreadsheetRange = (range: SpreadsheetRange): string => {
  const from = `${colIndexToLetters(range.startCol)}${range.startRow}`;
  const to = `${colIndexToLetters(range.endCol)}${range.endRow}`;
  return from === to ? from : `${from}:${to}`;
};

export const splitWordParagraphs = (text: string): string[] => {
  const byBlank = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  return text.split('\n').map((p) => p.trim()).filter(Boolean);
};
