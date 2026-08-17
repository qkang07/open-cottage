import type { LanguageParserAdapter, ParserResult, SymbolDef, SymbolKind } from '../types';
import { parseSymbolsTreeSitter } from './treeSitter';

const EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const DEF_RE =
  /\b(?:export\s+)?(?:(async)\s+)?(function|class|interface|type|const|let|var)\s+([A-Za-z_]\w*)/g;

const kindOf = (token: string, name: string, filePath: string): SymbolKind => {
  if (token === 'class') return 'class';
  if (token === 'interface') return 'interface';
  if (token === 'type') return 'type';
  if (token === 'function') return filePath.endsWith('.vue') ? 'component' : 'function';
  if (/^[A-Z]/.test(name)) return 'component';
  return 'variable';
};

const lineOfOffset = (content: string, offset: number): number =>
  content.slice(0, offset).split('\n').length;

export const parseTsSymbols = (
  path: string,
  content: string,
  lineOffset = 0,
): ParserResult => {
  // tree-sitter 就绪时用精确 AST；未就绪（未加载/禁用/异常）回退正则
  const viaTreeSitter = parseSymbolsTreeSitter(path, content, lineOffset);
  if (viaTreeSitter) return { symbols: viaTreeSitter };

  const symbols: SymbolDef[] = [];
  let match: RegExpExecArray | null;
  while ((match = DEF_RE.exec(content)) !== null) {
    const token = match[2];
    const name = match[3];
    const line = lineOfOffset(content, match.index) + lineOffset;
    symbols.push({
      id: `${path}#${name}:${line}`,
      name,
      kind: kindOf(token, name, path),
      language: 'ts',
      path,
      startLine: line,
      endLine: line,
      signature: match[0].trim(),
    });
  }
  return { symbols };
};

export const tsParserAdapter: LanguageParserAdapter = {
  id: 'typescript-like',
  languages: ['typescript', 'javascript'],
  supports: (path) => EXT_RE.test(path),
  parse: (path, content) => parseTsSymbols(path, content),
};
