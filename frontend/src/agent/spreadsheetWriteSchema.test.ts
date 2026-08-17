import { describe, expect, it } from 'vitest';
import {
  normalizeSpreadsheetSheets,
  normalizeToolWriteContent,
  toolWriteSpreadsheetInputSchema,
  writeContentSchema,
} from './spreadsheetWriteSchema';

describe('normalizeSpreadsheetSheets', () => {
  it('accepts sheets as 2d array with sheetNames', () => {
    const rows = [
      ['工具分类', '工具名称'],
      ['文件读写', 'readFile'],
    ];
    const out = normalizeSpreadsheetSheets(rows, ['工具列表']);
    expect(out).toEqual({ 工具列表: rows });
  });

  it('accepts sheets as record', () => {
    const out = normalizeSpreadsheetSheets({ Sheet1: [['a']] });
    expect(out).toEqual({ Sheet1: [['a']] });
  });
});

describe('writeContentSchema', () => {
  it('parses LLM-style spreadsheet payload', () => {
    const parsed = writeContentSchema.parse({
      sheets: [
        ['工具分类', '工具名称', '功能说明'],
        ['文件读写', 'readFile', '读取文件'],
      ],
      sheetNames: ['工具列表'],
    });
    expect(typeof parsed).toBe('object');
    if (typeof parsed === 'string') throw new Error('expected object');
    expect(parsed.sheets).toEqual({
      工具列表: [
        ['工具分类', '工具名称', '功能说明'],
        ['文件读写', 'readFile', '读取文件'],
      ],
    });
    expect(parsed.sheetNames).toEqual(['工具列表']);
  });
});

describe('toolWriteSpreadsheetInputSchema', () => {
  it('accepts tool payload then normalizes via writeContentSchema', () => {
    const toolInput = toolWriteSpreadsheetInputSchema.parse({
      path: 'out.xlsx',
      content: {
        sheets: { Sheet1: [['a', 1]] },
      },
    });
    const normalized = writeContentSchema.parse(
      normalizeToolWriteContent(toolInput.content),
    );
    expect(typeof normalized).toBe('object');
    if (typeof normalized === 'string') throw new Error('expected object');
    expect(normalized.sheets).toEqual({ Sheet1: [['a', 1]] });
  });

  it('accepts patch mode with cells and range', () => {
    const toolInput = toolWriteSpreadsheetInputSchema.parse({
      path: 'out.xlsx',
      mode: 'patch',
      target: {
        spreadsheetRange: { sheet: 'Data', a1: 'B2:C2' },
      },
      content: {
        sheetNames: ['Data'],
        cells: [['x', 'y']],
      },
    });
    expect(toolInput.mode).toBe('patch');
    const normalized = writeContentSchema.parse(
      normalizeToolWriteContent(toolInput.content),
    );
    if (typeof normalized === 'string') throw new Error('expected object');
    expect(normalized.sheets).toEqual({ Data: [['x', 'y']] });
  });

});
