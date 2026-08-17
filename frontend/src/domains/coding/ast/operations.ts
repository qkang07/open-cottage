import { diffLines } from './diff';
import type {
  AddImportSpec,
  AstEditResult,
  InsertStatementAnchor,
  RemoveImportSpec,
  ReplacePropDefaultSpec,
  RenameSelector,
} from './types';

/**
 * 共享操作工厂：基于 babel parser + magic-string 实现。
 * TS 与 JSX adapter 复用本工厂，仅 parseOptions（plugins）不同。
 *
 * 设计原则：
 * - 位置化编辑（magic-string 区间 overwrite/remove/append），保留原格式、产出最小 diff
 * - selector 用符号名定位，绝不让调用方算 offset/行号
 * - 解析失败、未命中时返回 applied=0 + note，让上层回退到 editFile
 */

export type BabelParse = (code: string, opts: unknown) => unknown;
export type BabelNode = {
  type: string;
  start?: number;
  end?: number;
  [key: string]: unknown;
};
export type BabelProgram = {
  body: BabelNode[];
  start?: number;
  end?: number;
};
export type BabelAst = { program: BabelProgram };
export type TraverseFn = (ast: unknown, visitor: Record<string, unknown>) => void;
export type MagicStringCtor = new (content: string) => {
  overwrite(start: number, end: number, content: string): unknown;
  remove(start: number, end: number): unknown;
  appendLeft(index: number, content: string): unknown;
  appendRight(index: number, content: string): unknown;
  prepend(content: string): unknown;
  append(content: string): unknown;
  toString(): string;
};

export interface TsBasedParseOptions {
  sourceType?: 'module' | 'script' | 'unambiguous';
  plugins?: string[];
}

const rangeOf = (node: BabelNode): { start: number; end: number } | null => {
  if (typeof node.start !== 'number' || typeof node.end !== 'number') return null;
  return { start: node.start, end: node.end };
};

const buildImportStatement = (spec: AddImportSpec): string => {
  if (spec.sideEffect) return `import "${spec.module}";`;
  const namedPart = spec.named?.length
    ? `{ ${spec.named.map((n) => n).join(', ')} }`
    : null;
  const defaultPart = spec.default ?? null;
  const clauses = [defaultPart, namedPart].filter(Boolean).join(', ');
  return `import ${clauses} from "${spec.module}";`;
};

/** 检查目标 import 是否已存在（按 module + specifier 精确匹配） */
const importAlreadyExists = (
  program: BabelProgram,
  spec: AddImportSpec,
): boolean => {
  for (const node of program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const source = (node as { source?: { value?: string } }).source?.value;
    if (source !== spec.module) continue;
    const specifiers = (node as { specifiers?: BabelNode[] }).specifiers ?? [];
    if (spec.sideEffect) return specifiers.length === 0;
    const hasDefault = specifiers.some((s) => s.type === 'ImportDefaultSpecifier');
    const namedSet = new Set(
      specifiers
        .filter((s) => s.type === 'ImportSpecifier')
        .map(
          (s) => ((s as { imported?: BabelNode }).imported as { name?: string })?.name ?? '',
        ),
    );
    if (spec.default && !hasDefault) continue;
    if (spec.named?.length && !spec.named.every((n) => namedSet.has(n))) continue;
    return true;
  }
  return false;
};

const lastImportEnd = (program: BabelProgram): number => {
  let end = -1;
  for (const node of program.body) {
    if (node.type === 'ImportDeclaration') {
      const r = rangeOf(node);
      if (r) end = r.end;
    }
  }
  return end;
};

const findDeclarationByName = (program: BabelProgram, name: string): BabelNode | null => {
  for (const node of program.body) {
    const declName = (node as { id?: BabelNode; declarations?: BabelNode[] })
      .id as { name?: string } | undefined;
    if (declName?.name === name) return node;
    const decls = (node as { declarations?: BabelNode[] }).declarations;
    if (decls) {
      for (const d of decls) {
        const id = (d as { id?: BabelNode }).id as { name?: string } | undefined;
        if (id?.name === name) return node;
      }
    }
  }
  return null;
};

export const createTsBasedOps = (
  parse: BabelParse,
  traverse: TraverseFn,
  MagicString: MagicStringCtor,
  parseOptions: TsBasedParseOptions,
) => {
  const parseSafe = (content: string): { ast: BabelAst } | { error: string } => {
    try {
      const ast = parse(content, {
        sourceType: parseOptions.sourceType ?? 'module',
        plugins: parseOptions.plugins ?? [],
      }) as BabelAst;
      return { ast };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };

  const renameSymbol = (
    content: string,
    selector: RenameSelector,
    newName: string,
  ): AstEditResult => {
    const parsed = parseSafe(content);
    if ('error' in parsed) return { output: content, diff: '', applied: 0, note: parsed.error };
    const s = new MagicString(content);
    const targets: Array<{ start: number; end: number }> = [];
    const seen = new Set<number>();
    const add = (node: BabelNode | undefined) => {
      if (!node) return;
      const r = rangeOf(node);
      if (!r) return;
      if (seen.has(r.start)) return;
      seen.add(r.start);
      targets.push(r);
    };

    let found = false;
    traverse(parsed.ast, {
      Program(path: unknown) {
        const p = path as {
          scope: {
            getBinding: (name: string) =>
              | {
                  identifier: BabelNode;
                  referencePaths: Array<{ node: BabelNode }>;
                  constantViolations: Array<{ traverse: (v: unknown) => void }>;
                }
              | undefined;
          };
        };
        const binding = p.scope.getBinding(selector.name);
        if (!binding) return;
        found = true;
        add(binding.identifier);
        for (const ref of binding.referencePaths) add(ref.node);
        for (const cv of binding.constantViolations) {
          cv.traverse({
            Identifier(ip: unknown) {
              const node = (ip as { node: BabelNode }).node;
              if ((node as { name?: string }).name === selector.name) add(node);
            },
          });
        }
      },
    });

    if (!found) {
      return {
        output: content,
        diff: '',
        applied: 0,
        note: `未在当前文件作用域找到绑定：${selector.name}`,
      };
    }
    for (const r of targets) s.overwrite(r.start, r.end, newName);
    const output = s.toString();
    return { output, diff: diffLines(content, output), applied: targets.length };
  };

  const addImport = (content: string, spec: AddImportSpec): AstEditResult => {
    const parsed = parseSafe(content);
    if ('error' in parsed) return { output: content, diff: '', applied: 0, note: parsed.error };
    if (importAlreadyExists(parsed.ast.program, spec)) {
      return { output: content, diff: '', applied: 0, note: 'import 已存在' };
    }
    const s = new MagicString(content);
    const stmt = buildImportStatement(spec);
    const end = lastImportEnd(parsed.ast.program);
    if (end >= 0) s.appendRight(end, `\n${stmt}`);
    else s.prepend(`${stmt}\n`);
    const output = s.toString();
    return { output, diff: diffLines(content, output), applied: 1 };
  };

  const removeImport = (content: string, spec: RemoveImportSpec): AstEditResult => {
    const parsed = parseSafe(content);
    if ('error' in parsed) return { output: content, diff: '', applied: 0, note: parsed.error };
    const s = new MagicString(content);
    let applied = 0;

    for (const node of parsed.ast.program.body) {
      if (node.type !== 'ImportDeclaration') continue;
      const r = rangeOf(node);
      if (!r) continue;
      const source = (node as { source?: { value?: string } }).source?.value;
      const specifiers = (node as { specifiers?: BabelNode[] }).specifiers ?? [];
      if (spec.module && source !== spec.module) continue;

      const removeNamed = new Set(spec.named ?? []);
      const wantRemoveDefault = Boolean(spec.default);
      let removedDefault = false;
      const kept = specifiers.filter((sp) => {
        if (sp.type === 'ImportDefaultSpecifier' && wantRemoveDefault) {
          removedDefault = true;
          return false;
        }
        if (sp.type === 'ImportSpecifier') {
          const imp = (sp as { imported?: BabelNode }).imported as { name?: string };
          if (removeNamed.has(imp?.name ?? '')) {
            return false;
          }
        }
        return true;
      });

      const removedCount = specifiers.length - kept.length;
      if (removedCount === 0) continue;

      if (kept.length === 0) {
        // 整条 import 删除（连同前导换行）
        const lineStart = content.lastIndexOf('\n', r.start - 1) + 1;
        s.remove(lineStart, r.end);
      } else {
        // 仅删除被移除的 specifier（重建 specifiers 文本最稳妥）
        const newClause = kept
          .map((sp) => {
            if (sp.type === 'ImportDefaultSpecifier') {
              return ((sp as { local?: BabelNode }).local as { name?: string })?.name ?? '';
            }
            const imp = (sp as { imported?: BabelNode }).imported as { name?: string };
            const local = (sp as { local?: BabelNode }).local as { name?: string };
            return imp?.name === local?.name ? imp?.name : `${imp?.name} as ${local?.name}`;
          })
          .join(', ');
        const specStart = specifiers[0]
          ? rangeOf(specifiers[0])?.start ?? r.start
          : r.start;
        const specEnd = specifiers[specifiers.length - 1]
          ? rangeOf(specifiers[specifiers.length - 1])?.end ?? r.end
          : r.end;
        s.overwrite(specStart, specEnd, newClause);
      }
      applied += removedCount;
      if (wantRemoveDefault && !removedDefault && !spec.named?.length) {
        // module 匹配但无 default specifier：跳过
      }
    }

    if (applied === 0) {
      return { output: content, diff: '', applied: 0, note: '未找到匹配的 import' };
    }
    const output = s.toString();
    return { output, diff: diffLines(content, output), applied };
  };

  const insertStatement = (
    content: string,
    anchor: InsertStatementAnchor,
    code: string,
  ): AstEditResult => {
    const parsed = parseSafe(content);
    if ('error' in parsed) return { output: content, diff: '', applied: 0, note: parsed.error };
    const s = new MagicString(content);
    const stmt = code.endsWith('\n') ? code : `${code}\n`;

    if (anchor.afterSymbol) {
      const decl = findDeclarationByName(parsed.ast.program, anchor.afterSymbol);
      if (!decl) {
        return {
          output: content,
          diff: '',
          applied: 0,
          note: `未找到符号定义：${anchor.afterSymbol}`,
        };
      }
      const r = rangeOf(decl);
      if (!r) return { output: content, diff: '', applied: 0, note: '无法定位节点区间' };
      s.appendRight(r.end, `\n${stmt}`);
    } else if (anchor.at === 'fileEnd') {
      s.append(`\n${stmt}`);
    } else {
      // fileTop：import 之后
      const end = lastImportEnd(parsed.ast.program);
      if (end >= 0) s.appendRight(end, `\n${stmt}`);
      else s.prepend(`${stmt}\n`);
    }
    const output = s.toString();
    return { output, diff: diffLines(content, output), applied: 1 };
  };

  const replacePropDefault = (
    content: string,
    spec: ReplacePropDefaultSpec,
  ): AstEditResult => {
    const parsed = parseSafe(content);
    if ('error' in parsed) return { output: content, diff: '', applied: 0, note: parsed.error };
    const s = new MagicString(content);
    let applied = 0;
    let note: string | undefined;

    traverse(parsed.ast, {
      AssignmentExpression(path: unknown) {
        const p = path as { node: BabelNode };
        const node = p.node;
        const left = node.left as BabelNode | undefined;
        const right = node.right as BabelNode | undefined;
        if (!left || !right) return;
        // 匹配 Component.defaultProps
        if (left.type !== 'MemberExpression') return;
        const obj = left.object as { name?: string } | undefined;
        const prop = left.property as { name?: string } | undefined;
        if (obj?.name !== spec.component || prop?.name !== 'defaultProps') return;
        if (right.type !== 'ObjectExpression') return;
        const props = (right as { properties?: BabelNode[] }).properties ?? [];
        for (const pr of props) {
          if (pr.type !== 'ObjectProperty' && pr.type !== 'Property') continue;
          const key = (pr as { key?: BabelNode }).key as { name?: string } | undefined;
          if (key?.name !== spec.prop) continue;
          const valueNode = (pr as { value?: BabelNode }).value;
          const vr = valueNode ? rangeOf(valueNode) : null;
          if (!vr) continue;
          s.overwrite(vr.start, vr.end, spec.value);
          applied += 1;
        }
      },
    });

    if (applied === 0) {
      note = `未找到 ${spec.component}.defaultProps.${spec.prop}`;
    }
    const output = s.toString();
    return { output, diff: diffLines(content, output), applied, note };
  };

  return {
    renameSymbol,
    addImport,
    removeImport,
    insertStatement,
    replacePropDefault,
  };
};
