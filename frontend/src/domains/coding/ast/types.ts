/** AST 编辑子系统：按语言注册 adapter，懒加载解析器，产出最小 diff。 */

export type AstOpKind =
  | 'renameSymbol'
  | 'addImport'
  | 'removeImport'
  | 'insertStatement'
  | 'replacePropDefault';

export interface AstEditResult {
  /** 改后全文（magic-string 区间编辑产出，保留原格式） */
  output: string;
  /** unified diff，未改动时为空字符串 */
  diff: string;
  /** 实际生效的操作数 */
  applied: number;
  /** 未命中时的说明（如：符号不存在、import 已存在） */
  note?: string;
}

export interface RenameSelector {
  name: string;
}

export interface AddImportSpec {
  module: string;
  named?: string[];
  default?: string;
  sideEffect?: boolean;
}

export interface RemoveImportSpec {
  module?: string;
  named?: string[];
  default?: string;
}

export interface InsertStatementAnchor {
  /** 在某符号定义之后插入 */
  afterSymbol?: string;
  /** 文件顶部（import 之后）或文件末尾 */
  at?: 'fileTop' | 'fileEnd';
}

export interface ReplacePropDefaultSpec {
  component: string;
  prop: string;
  /** 新默认值的源码文本，如 "'small'" / "true" / "42" */
  value: string;
}

export type AstOperation =
  | { kind: 'renameSymbol'; selector: RenameSelector; newName: string }
  | { kind: 'addImport'; spec: AddImportSpec }
  | { kind: 'removeImport'; spec: RemoveImportSpec }
  | {
      kind: 'insertStatement';
      anchor: InsertStatementAnchor;
      code: string;
    }
  | { kind: 'replacePropDefault'; spec: ReplacePropDefaultSpec };

/**
 * 每个语言 adapter 加载后返回的操作集。
 * 每个 op 接收原文与参数，返回区间编辑结果（不落盘）。
 */
export interface AstOps {
  renameSymbol(content: string, selector: RenameSelector, newName: string): AstEditResult;
  addImport(content: string, spec: AddImportSpec): AstEditResult;
  removeImport(content: string, spec: RemoveImportSpec): AstEditResult;
  insertStatement(
    content: string,
    anchor: InsertStatementAnchor,
    code: string,
  ): AstEditResult;
  replacePropDefault(content: string, spec: ReplacePropDefaultSpec): AstEditResult;
}

export interface AstCapabilitiesInfo {
  adapterId: string;
  ops: readonly AstOpKind[];
  /** 解析器是否已加载（首次调用 astEdit 后才为 true） */
  loaded: boolean;
}

/**
 * AST 编辑适配器：按语言注册，懒加载解析器。
 * 注册时只声明 supports 与 declaredOps（零依赖），
 * 首次对该语言调用 astEdit 时才 load() 真实解析器。
 */
export interface AstEditAdapter {
  id: string;
  /** 该 adapter 支持的文件路径 */
  supports(path: string): boolean;
  /** 该 adapter 声明支持的操作（供 astCapabilities 读取，无需加载） */
  declaredOps: readonly AstOpKind[];
  /** 懒加载：首次调用才 dynamic import 真实解析器与操作实现 */
  load(): Promise<AstOps>;
}
