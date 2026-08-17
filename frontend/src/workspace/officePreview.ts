import {
  readPresentation,
  readSpreadsheet,
  readWordDocumentHtml,
} from '../agent/officeDocuments';
import { extractOfficeContentRef } from '../content/extractors/office';
import type { FilePreview, PreviewKind } from './previewKind';

const SPREADSHEET_PREVIEW_MAX_ROWS = 5000;

export const loadOfficeFilePreview = async (
  path: string,
  kind: Extract<PreviewKind, 'spreadsheet' | 'word' | 'presentation'>,
): Promise<FilePreview> => {
  // 同步写入 Content Model 元数据，供索引/模板/验收复用。
  void extractOfficeContentRef(path).catch(() => {});
  if (kind === 'spreadsheet') {
    const data = await readSpreadsheet(path, {
      maxRows: SPREADSHEET_PREVIEW_MAX_ROWS,
    });
    return { kind: 'spreadsheet', data };
  }
  if (kind === 'word') {
    const { html } = await readWordDocumentHtml(path);
    return { kind: 'word', html };
  }
  const { slides } = await readPresentation(path);
  return { kind: 'presentation', slides };
};
