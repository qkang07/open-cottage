import {
  createTsBasedOps,
  type BabelParse,
  type MagicStringCtor,
  type TraverseFn,
} from '../operations';
import { diffLines } from '../diff';
import type {
  AddImportSpec,
  AstEditAdapter,
  AstEditResult,
  AstOps,
  InsertStatementAnchor,
  RemoveImportSpec,
  ReplacePropDefaultSpec,
  RenameSelector,
} from '../types';

/**
 * Vue SFC（.vue）adapter：提取 <script> 块内容，复用 babel TS/JSX 操作，再拼回全文。
 * template / style 块不受影响。
 */
export const vueAstAdapter: AstEditAdapter = {
  id: 'vue-sfc',
  supports: (path) => /\.vue$/i.test(path),
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

    // 底层 TS+JSX ops，作用于纯 JS/TS 内容（即 script 块内容）
    const innerOps: AstOps = createTsBasedOps(parse, traverse, MagicString, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });

    // 包装：提取 script → 调用 inner op → 拼回全文
    const wrap =
      <T extends unknown[]>(
        fn: (scriptContent: string, ...args: T) => AstEditResult,
      ) =>
      (content: string, ...args: T): AstEditResult => {
        const extracted = extractScriptBlock(content);
        if (!extracted) {
          return {
            output: content,
            diff: '',
            applied: 0,
            note: '未找到 <script> 块',
          };
        }
        const { scriptContent } = extracted;
        const inner = fn(scriptContent, ...args);
        if (inner.applied === 0) return inner;
        const newFull = spliceScriptBlock(content, extracted, inner.output);
        return {
          output: newFull,
          diff: diffLines(content, newFull),
          applied: inner.applied,
          note: inner.note,
        };
      };

    return {
      renameSymbol: wrap(
        (c: string, selector: RenameSelector, newName: string) =>
          innerOps.renameSymbol(c, selector, newName),
      ),
      addImport: wrap((c: string, spec: AddImportSpec) => innerOps.addImport(c, spec)),
      removeImport: wrap((c: string, spec: RemoveImportSpec) =>
        innerOps.removeImport(c, spec),
      ),
      insertStatement: wrap(
        (c: string, anchor: InsertStatementAnchor, code: string) =>
          innerOps.insertStatement(c, anchor, code),
      ),
      replacePropDefault: wrap((c: string, spec: ReplacePropDefaultSpec) =>
        innerOps.replacePropDefault(c, spec),
      ),
    };
  },
};

interface ScriptBlock {
  /** script 标签内的代码（不含 <script...> / </script> 标签本身） */
  scriptContent: string;
  /** script 内容在全文中的起始字符偏移 */
  scriptStart: number;
  /** script 内容在全文中的结束字符偏移（不含 </script>） */
  scriptEnd: number;
}

/** 从 .vue 文件中提取 <script> 块位置与内容 */
const extractScriptBlock = (content: string): ScriptBlock | null => {
  const match = /<script\b[^>]*>([\s\S]*?)<\/script>/i.exec(content);
  if (!match || match[1] == null) return null;
  const scriptStart = match.index + match[0].indexOf(match[1]);
  const scriptEnd = scriptStart + match[1].length;
  return { scriptContent: match[1], scriptStart, scriptEnd };
};

/** 将修改后的 script 内容替换回全文 */
const spliceScriptBlock = (
  content: string,
  block: ScriptBlock,
  newScriptContent: string,
): string =>
  content.slice(0, block.scriptStart) +
  newScriptContent +
  content.slice(block.scriptEnd);
