export type SymbolKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'variable'
  | 'component';

export interface SymbolDef {
  id: string;
  name: string;
  kind: SymbolKind;
  language: string;
  path: string;
  startLine: number;
  endLine: number;
  signature?: string;
}

export interface SymbolRef {
  symbolId: string;
  symbolName: string;
  path: string;
  line: number;
  column: number;
}

export interface SymbolIndexManifest {
  builtAt: number;
  symbolCount: number;
  languages: string[];
  totalFiles: number;
}

export interface SymbolFileEntry {
  hash: string;
  symbolIds: string[];
}

export interface SymbolIndexStore {
  manifest: SymbolIndexManifest;
  files: Record<string, SymbolFileEntry>;
  symbols: Record<string, SymbolDef>;
  references: Record<string, SymbolRef[]>;
}

export interface ParserResult {
  symbols: SymbolDef[];
}

export interface LanguageParserAdapter {
  id: string;
  languages: string[];
  supports(path: string): boolean;
  parse(path: string, content: string): ParserResult;
}
