import { describe, expect, it } from 'vitest';
import {
  formatSpreadsheetRange,
  lettersToColIndex,
  normalizeSpreadsheetRange,
  parseA1Range,
} from './officeRanges';

describe('parseA1Range', () => {
  it('parses single cell', () => {
    expect(parseA1Range('B2')).toEqual({
      startRow: 2,
      startCol: 2,
      endRow: 2,
      endCol: 2,
    });
  });

  it('parses range', () => {
    expect(parseA1Range('A1:C3')).toEqual({
      startRow: 1,
      startCol: 1,
      endRow: 3,
      endCol: 3,
    });
  });
});

describe('lettersToColIndex', () => {
  it('maps Excel columns', () => {
    expect(lettersToColIndex('A')).toBe(1);
    expect(lettersToColIndex('AA')).toBe(27);
  });
});

describe('normalizeSpreadsheetRange', () => {
  it('uses a1 shorthand', () => {
    expect(
      normalizeSpreadsheetRange('Sheet1', { sheet: 'Sheet1', a1: 'D4:E5' }),
    ).toEqual({
      sheet: 'Sheet1',
      startRow: 4,
      startCol: 4,
      endRow: 5,
      endCol: 5,
    });
  });
});

describe('formatSpreadsheetRange', () => {
  it('formats range label', () => {
    expect(
      formatSpreadsheetRange({
        sheet: 'S',
        startRow: 1,
        startCol: 1,
        endRow: 2,
        endCol: 3,
      }),
    ).toBe('A1:C2');
  });
});
