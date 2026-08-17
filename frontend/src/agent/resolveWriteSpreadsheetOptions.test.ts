import { describe, expect, it, vi } from 'vitest';
import type { ChatFileReference } from '../chat/fileReferences';
import { resolveWriteSpreadsheetOptions } from './resolveWriteSpreadsheetOptions';

vi.mock('./officeDocuments', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./officeDocuments')>();
  return {
    ...mod,
    readSpreadsheet: vi.fn().mockResolvedValue({
      sheets: {
        工具列表: Array.from({ length: 20 }, () => ['a', 'b', 'c']),
      },
      sheetNames: ['工具列表'],
    }),
  };
});

const spreadsheetRef = (
  path: string,
  sheet: string,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): ChatFileReference => ({
  id: '1',
  path,
  anchor: {
    kind: 'spreadsheet',
    sheet,
    startRow,
    startCol,
    endRow,
    endCol,
  },
});

describe('resolveWriteSpreadsheetOptions', () => {
  it('auto patch when cells match user spreadsheet reference', async () => {
    const refs = [
      spreadsheetRef('工具功能表.xlsx', '工具列表', 6, 2, 9, 2),
    ];
    const resolved = await resolveWriteSpreadsheetOptions(
      {
        path: '工具功能表.xlsx',
        content: {
          cells: [['qbox_mkdir'], ['qbox_rename'], ['qbox_deleteFile'], ['qbox_deleteEntry']],
        },
      },
      refs,
    );
    expect(resolved.mode).toBe('patch');
    expect(resolved.target?.spreadsheetRange).toEqual({
      sheet: '工具列表',
      a1: 'B6:B9',
    });
  });

  it('rejects replace that would shrink sheet row count', async () => {
    await expect(
      resolveWriteSpreadsheetOptions(
        {
          path: '工具功能表.xlsx',
          mode: 'replace',
          content: {
            sheets: { 工具列表: [['only', 'four'], ['rows', 'here'], ['x', 'y'], ['a', 'b']] },
          },
        },
        [],
      ),
    ).rejects.toThrow(/不能用 replace/);
  });

  it('rejects non-spreadsheet path', async () => {
    await expect(
      resolveWriteSpreadsheetOptions(
        { path: 'doc.docx', content: { cells: [['a']] } },
        [],
      ),
    ).rejects.toThrow(/仅支持 xlsx/);
  });
});
