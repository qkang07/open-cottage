import {
  readPresentationBytes,
  readSpreadsheetBytes,
  readWordDocumentHtmlBytes,
} from '../agent/officeDocuments';
import { getPreviewKind, type FilePreview } from './previewKind';

const mimeFromKind = (kind: 'image' | 'video' | 'pdf', path: string): string => {
  if (kind === 'pdf') return 'application/pdf';
  const ext = path.split('.').pop()?.toLowerCase();
  const known: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', mov: 'video/quicktime',
  };
  return known[ext ?? ''] ?? `${kind}/*`;
};

export async function loadFileBytesForPreview(
  path: string,
  bytes: Uint8Array,
): Promise<FilePreview> {
  const kind = getPreviewKind(path);
  if (kind === 'spreadsheet') {
    return { kind, data: await readSpreadsheetBytes(bytes, path, { maxRows: 5000 }) };
  }
  if (kind === 'word') {
    return { kind, html: (await readWordDocumentHtmlBytes(bytes, path)).html };
  }
  if (kind === 'presentation') {
    const result = await readPresentationBytes(bytes, path, {
      includeElements: true,
      includeAssets: true,
    });
    return {
      kind,
      slides: result.slides,
      warnings: result.warnings,
      slideWidth: result.slideWidth,
      slideHeight: result.slideHeight,
      sourceManifest: null,
    };
  }
  if (kind === 'image' || kind === 'video' || kind === 'pdf') {
    const blob = new Blob([bytes], { type: mimeFromKind(kind, path) });
    return { kind, objectUrl: URL.createObjectURL(blob) };
  }
  const content = new TextDecoder().decode(bytes);
  return { kind, content } as FilePreview;
}
