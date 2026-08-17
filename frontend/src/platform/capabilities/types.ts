export type CapabilityDomain =
  | 'core'
  | 'coding'
  | 'office'
  | 'media'
  | 'chart'
  | 'integration';

export type CapabilityRiskLevel =
  | 'read'
  | 'write'
  | 'external'
  | 'destructive';

export type ContentType =
  | 'text'
  | 'code'
  | 'spreadsheet'
  | 'document'
  | 'slides'
  | 'image'
  | 'audio'
  | 'video'
  | 'json'
  | 'binary';

export interface Capability {
  id: string;
  domain: CapabilityDomain;
  tools: string[];
  inputTypes: ContentType[];
  outputTypes: ContentType[];
  riskLevel: CapabilityRiskLevel;
  requiresApproval?: boolean;
  plannerHints?: string;
}
