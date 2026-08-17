import type { LanguageParserAdapter } from '../types';
import { parseTsSymbols } from './tsParser';

const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/i;

const lineOfOffset = (content: string, offset: number): number =>
  content.slice(0, offset).split('\n').length;

export const vueParserAdapter: LanguageParserAdapter = {
  id: 'vue-sfc',
  languages: ['vue'],
  supports: (path) => path.toLowerCase().endsWith('.vue'),
  parse: (path, content) => {
    const match = SCRIPT_RE.exec(content);
    if (!match || !match[1]) return { symbols: [] };
    const scriptOffset = lineOfOffset(content, match.index);
    return parseTsSymbols(path, match[1], scriptOffset);
  },
};
