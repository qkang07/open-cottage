import type { LanguageParserAdapter } from '../types';
import { tsParserAdapter } from './tsParser';
import { vueParserAdapter } from './vueParser';

const adapters: LanguageParserAdapter[] = [vueParserAdapter, tsParserAdapter];

export const registerLanguageParserAdapter = (
  adapter: LanguageParserAdapter,
): void => {
  const idx = adapters.findIndex((a) => a.id === adapter.id);
  if (idx >= 0) adapters[idx] = adapter;
  else adapters.push(adapter);
};

export const getLanguageParserAdapters = (): LanguageParserAdapter[] => [...adapters];

export const resolveAdapterForPath = (
  path: string,
): LanguageParserAdapter | undefined =>
  adapters.find((adapter) => adapter.supports(path));
