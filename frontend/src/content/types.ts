export type ContentStructure =
  | 'plain'
  | 'document'
  | 'spreadsheet'
  | 'slides'
  | 'pdf'
  | 'media';

export type ContentType =
  | 'text'
  | 'code'
  | 'spreadsheet'
  | 'document'
  | 'slides'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'binary';

export interface ContentRef {
  path: string;
  mime: string;
  type: ContentType;
  structure?: ContentStructure;
  extractedTextPath?: string;
  structuredPath?: string;
}
