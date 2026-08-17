import { describe, expect, it } from 'vitest';
import {
  colIndexToLetters,
  extractTextByAnchor,
  formatReferenceLabel,
  lineNumberAtOffset,
  positionAtOffset,
  textAnchorFromOffsets,
} from './fileReferences';

describe('positionAtOffset', () => {
  it('returns line and column', () => {
    expect(positionAtOffset('ab\ncd', 3)).toEqual({ line: 2, column: 1 });
    expect(positionAtOffset('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });
});

describe('textAnchorFromOffsets', () => {
  it('captures intra-line columns', () => {
    const anchor = textAnchorFromOffsets('hello world', 6, 11);
    expect(anchor).toEqual({
      kind: 'text',
      startLine: 1,
      startColumn: 7,
      endLine: 1,
      endColumn: 12,
    });
  });
});

describe('extractTextByAnchor', () => {
  it('extracts precise substring', () => {
    const anchor = textAnchorFromOffsets('one\ntwo\nthree', 4, 7);
    expect(extractTextByAnchor('one\ntwo\nthree', anchor)).toBe('two');
  });
});

describe('colIndexToLetters', () => {
  it('maps column index to Excel letters', () => {
    expect(colIndexToLetters(1)).toBe('A');
    expect(colIndexToLetters(27)).toBe('AA');
  });
});

describe('formatReferenceLabel', () => {
  it('formats text columns', () => {
    expect(
      formatReferenceLabel({
        id: '1',
        path: 'src/a.ts',
        anchor: {
          kind: 'text',
          startLine: 3,
          startColumn: 5,
          endLine: 10,
          endColumn: 2,
        },
      }),
    ).toBe('src/a.ts:3:5-10:2');
  });

  it('formats spreadsheet range', () => {
    expect(
      formatReferenceLabel({
        id: '1',
        path: 'data.xlsx',
        anchor: {
          kind: 'spreadsheet',
          sheet: 'Sheet1',
          startRow: 1,
          startCol: 1,
          endRow: 3,
          endCol: 2,
        },
      }),
    ).toBe('data.xlsx[Sheet1]!A1:B3');
  });

  it('formats directory reference', () => {
    expect(
      formatReferenceLabel({
        id: 'dir-1',
        path: 'src/components',
        entryType: 'directory',
      }),
    ).toBe('src/components/');
  });
});

describe('lineNumberAtOffset', () => {
  it('returns 1 at start', () => {
    expect(lineNumberAtOffset('a\nb\nc', 0)).toBe(1);
  });
});
