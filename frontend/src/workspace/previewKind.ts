import type { SpreadsheetContent } from '../agent/officeDocuments';
import type { PresentationWarning } from '../domains/office/presentationModel';
import type { PresentationSourceManifest } from '../domains/office/presentationSourceManifest';
import { detectOfficeKind } from '../agent/officeDocuments';

export type PreviewKind =
  | 'markdown'
  | 'text'
  | 'image'
  | 'video'
  | 'pdf'
  | 'html'
  | 'spreadsheet'
  | 'word'
  | 'presentation';

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const VIDEO_EXT = /\.(mp4|webm|ogg|mov|m4v|avi|mkv)$/i;
const PDF_EXT = /\.pdf$/i;
const HTML_EXT = /\.(html?|htm)$/i;
const MARKDOWN_EXT = /\.(md|mdx|markdown)$/i;

export const getPreviewKind = (path: string): PreviewKind => {
  const office = detectOfficeKind(path);
  if (office === 'spreadsheet') return 'spreadsheet';
  if (office === 'word') return 'word';
  if (office === 'presentation') return 'presentation';
  if (IMAGE_EXT.test(path)) return 'image';
  if (VIDEO_EXT.test(path)) return 'video';
  if (PDF_EXT.test(path)) return 'pdf';
  if (HTML_EXT.test(path)) return 'html';
  if (MARKDOWN_EXT.test(path)) return 'markdown';
  return 'text';
};

/** Markdown / HTML 适合渲染预览；纯文本与代码文件直接编辑即可 */
export const supportsRenderPreview = (kind: PreviewKind): boolean =>
  kind === 'markdown' || kind === 'html';

export type PresentationElementPreview = {
  id: string;
  shapeId: string;
  name: string;
  type: 'text' | 'shape' | 'line' | 'image' | 'table' | 'chart' | 'group' | 'unsupported';
  editable: boolean;
  decorative?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  texts: string[];
  fill?: string;
  lineColor?: string;
  textColor?: string;
  shapeType?: string;
  rows?: string[][];
  chart?: {
    categories: string[];
    series: Array<{ name: string; values: number[] }>;
  };
  missingAsset?: boolean;
  imageDataUrl?: string;
  hyperlinks?: string[];
};

export type PresentationSlidePreview = {
  index: number;
  id: string;
  texts: string[];
  background: string;
  elements: PresentationElementPreview[];
};

export type FilePreview =
  | { kind: 'markdown' | 'text' | 'html'; content: string }
  | { kind: 'image' | 'video' | 'pdf'; objectUrl: string }
  | { kind: 'spreadsheet'; data: SpreadsheetContent }
  | { kind: 'word'; html: string }
  | {
      kind: 'presentation';
      slides: PresentationSlidePreview[];
      warnings: PresentationWarning[];
      slideWidth: number;
      slideHeight: number;
      sourceManifest?: PresentationSourceManifest | null;
    };
