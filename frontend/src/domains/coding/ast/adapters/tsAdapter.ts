import {
  createTsBasedOps,
  type BabelParse,
  type MagicStringCtor,
  type TraverseFn,
} from '../operations';
import type { AstEditAdapter, AstOps } from '../types';

/**
 * TS/JS adapter（不含 JSX）：用 @babel/parser 的 typescript 插件解析。
 * 首次 load() 才 dynamic import babel + magic-string。
 */
export const tsAstAdapter: AstEditAdapter = {
  id: 'ts-babel',
  supports: (path) => /\.(ts|mts|cts|js|mjs|cjs)$/i.test(path),
  declaredOps: [
    'renameSymbol',
    'addImport',
    'removeImport',
    'insertStatement',
    'replacePropDefault',
  ],
  async load(): Promise<AstOps> {
    const [parserMod, traverseMod, magicMod] = await Promise.all([
      import('@babel/parser'),
      import('@babel/traverse'),
      import('magic-string'),
    ]);
    const parse = parserMod.parse as BabelParse;
    const traverse = ((traverseMod as { default?: unknown }).default ??
      traverseMod) as TraverseFn;
    const MagicString = ((magicMod as { default?: unknown }).default ??
      magicMod) as MagicStringCtor;
    return createTsBasedOps(parse, traverse, MagicString, {
      sourceType: 'module',
      plugins: ['typescript'],
    });
  },
};
