import type { ContentRef, ContentStructure, ContentType } from './types';

const ext = (path: string): string =>
  path.split('.').pop()?.toLowerCase() ?? '';

const mimeAndType = (
  extension: string,
): { mime: string; type: ContentType; structure?: ContentStructure } => {
  switch (extension) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'vue':
    case 'json':
      return { mime: 'text/plain', type: 'code', structure: 'plain' };
    case 'md':
    case 'txt':
    case 'yml':
    case 'yaml':
      return { mime: 'text/plain', type: 'text', structure: 'plain' };
    case 'xlsx':
    case 'xls':
    case 'csv':
      return {
        mime:
          extension === 'csv'
            ? 'text/csv'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        type: 'spreadsheet',
        structure: 'spreadsheet',
      };
    case 'docx':
      return {
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        type: 'document',
        structure: 'document',
      };
    case 'pptx':
      return {
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        type: 'slides',
        structure: 'slides',
      };
    case 'pdf':
      return { mime: 'application/pdf', type: 'pdf', structure: 'pdf' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
      return { mime: 'image/*', type: 'image', structure: 'media' };
    case 'mp3':
    case 'wav':
      return { mime: 'audio/*', type: 'audio', structure: 'media' };
    case 'mp4':
    case 'webm':
      return { mime: 'video/*', type: 'video', structure: 'media' };
    default:
      return { mime: 'application/octet-stream', type: 'binary' };
  }
};

export const contentCacheKey = (path: string): string =>
  encodeURIComponent(path).replace(/%/g, '_');

export const buildContentRef = (
  path: string,
  patch?: Partial<ContentRef>,
): ContentRef => {
  const base = mimeAndType(ext(path));
  return {
    path,
    ...base,
    ...patch,
  };
};
