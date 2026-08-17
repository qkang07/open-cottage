import {
  readOfficeDocument,
  readPresentation,
  readSpreadsheet,
  readWordDocument,
} from '../../agent/officeDocuments';
import { buildContentRef } from '../contentRegistry';
import { saveStructuredContent } from '../structuredStore';
import type { ContentRef } from '../types';

const spreadsheetToText = (
  sheets: Record<string, (string | number | boolean | null)[][]>,
): string =>
  Object.entries(sheets)
    .map(([name, rows]) => `[Sheet: ${name}]\n${rows.map((r) => r.join('\t')).join('\n')}`)
    .join('\n\n');

const presentationToText = (slides: { index: number; texts: string[] }[]): string =>
  slides.map((s) => `[Slide ${s.index}]\n${s.texts.join('\n')}`).join('\n\n');

export const extractOfficeContentRef = async (path: string): Promise<{
  contentRef: ContentRef;
  extractedText: string;
}> => {
  const contentRef = buildContentRef(path);
  if (contentRef.structure === 'spreadsheet') {
    const data = await readSpreadsheet(path);
    const extractedText = spreadsheetToText(data.sheets).trim();
    const persisted = await saveStructuredContent(path, data, extractedText);
    return {
      contentRef: buildContentRef(path, persisted),
      extractedText,
    };
  }
  if (contentRef.structure === 'document') {
    const data = await readWordDocument(path);
    const extractedText = data.text.trim();
    const persisted = await saveStructuredContent(path, data, extractedText);
    return {
      contentRef: buildContentRef(path, persisted),
      extractedText,
    };
  }
  if (contentRef.structure === 'slides') {
    const data = await readPresentation(path);
    const extractedText = presentationToText(data.slides).trim();
    const persisted = await saveStructuredContent(path, data, extractedText);
    return {
      contentRef: buildContentRef(path, persisted),
      extractedText,
    };
  }

  const raw = await readOfficeDocument(path);
  const extractedText = JSON.stringify(raw, null, 2);
  const persisted = await saveStructuredContent(path, raw, extractedText);
  return {
    contentRef: buildContentRef(path, persisted),
    extractedText,
  };
};
