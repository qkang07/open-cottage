import {
  createTsBasedOps,
  type BabelParse,
  type MagicStringCtor,
  type TraverseFn,
} from '../operations';
import type { AstEditAdapter, AstOps } from '../types';

/**
 * React JSX/TSX adapter：在 ts-babel 基础上启用 jsx 插件。
 * 与 tsAstAdapter 路径分区（.tsx/.jsx 归本 adapter，.ts/.js 归 ts-babel），
 * 避免同一文件被两个 adapter 同时匹配。
 */
export const jsxAstAdapter: AstEditAdapter = {
  id: 'jsx-babel',
  supports: (path) => /\.(tsx|jsx)$/i.test(path),
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
      plugins: ['typescript', 'jsx'],
    });
  },
};
