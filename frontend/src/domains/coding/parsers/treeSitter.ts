/**
 * tree-sitter 精确符号解析封装。
 *
 * 契约约束：LanguageParserAdapter.parse 是同步的，而 tree-sitter 语法加载是
 * 异步的。因此本模块拆成两段：
 *   1. ensureTreeSitterReady(config)：异步，加载运行时 + 语法包（幂等、带缓存）。
 *      由索引核心在解析循环前 await 一次。
 *   2. parseSymbolsTreeSitter(...)：同步，使用已加载的 parser；未就绪或不支持
 *      的语言返回 null，调用方回退正则。
 *
 * 语法包（tree-sitter-*.wasm）懒加载自可配置地址（默认 CDN），并用 Cache
 * Storage 缓存；运行时 tree-sitter.wasm 默认用打包内置，可被 config 覆盖。
 */

import type { Language, Parser } from 'web-tree-sitter';
// 运行时 wasm：由 Vite 以 ?url 方式产出可访问地址（默认内置，避免首屏下载）
import runtimeWasmUrl from 'web-tree-sitter/tree-sitter.wasm?url';
import {
  registerWasmModule,
  reportWasmStatus,
} from '../../../platform/debug/wasmStatus';
import type { SymbolDef, SymbolKind } from '../types';

export interface TreeSitterConfig {
  /** 是否启用 tree-sitter 精确解析 */
  enabled: boolean;
  /** 语法包基地址（末尾带 /）；默认 jsDelivr CDN */
  wasmBaseUrl: string;
  /** 运行时 tree-sitter.wasm 覆盖地址；缺省用内置 */
  runtimeWasmUrl?: string;
}

export const DEFAULT_TREE_SITTER_BASE_URL =
  'https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/';

const CACHE_NAME = 'cottage-tree-sitter-v1';

const MODULE_ID = 'tree-sitter';
let tsLoadedGrammars: string[] = [];
let tsParseCount = 0;
let tsFallbackCount = 0;
let lastMetricFlush = 0;

registerWasmModule({
  id: MODULE_ID,
  label: 'tree-sitter 解析器',
  description: '代码符号精确解析（WASM 语法包），未就绪时回退正则',
});

/** 汇总当前语法包与解析计数为展示指标 */
function buildTreeSitterMetrics(): string[] {
  const metrics: string[] = [];
  if (tsLoadedGrammars.length) {
    metrics.push(`语法包：${tsLoadedGrammars.join(', ')}`);
  }
  if (tsParseCount) metrics.push(`已解析 ${tsParseCount} 个文件`);
  if (tsFallbackCount) metrics.push(`回退正则 ${tsFallbackCount} 次`);
  return metrics;
}

/** 解析频繁，限速上报避免风暴式通知 */
function flushTreeSitterMetrics(force = false): void {
  const now = Date.now();
  if (!force && now - lastMetricFlush < 1000) return;
  lastMetricFlush = now;
  reportWasmStatus(MODULE_ID, { metrics: buildTreeSitterMetrics(), lastUsedAt: now });
}

/** 语法包文件名（相对 wasmBaseUrl） */
const GRAMMAR_FILES: Record<string, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
};

type GrammarId = keyof typeof GRAMMAR_FILES;

interface LoadedState {
  languages: Partial<Record<GrammarId, Language>>;
  parser: Parser;
}

let readyPromise: Promise<LoadedState | null> | null = null;
let readySignature = '';
let loaded: LoadedState | null = null;

const signatureOf = (config: TreeSitterConfig): string =>
  `${config.enabled}|${config.wasmBaseUrl}|${config.runtimeWasmUrl ?? ''}`;

/** 通过 Cache Storage 获取语法包字节；无 caches 时退化为直接 fetch */
async function fetchGrammarBytes(url: string): Promise<Uint8Array> {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(CACHE_NAME);
      let res = await cache.match(url);
      if (!res) {
        const fresh = await fetch(url);
        if (!fresh.ok) throw new Error(`HTTP ${fresh.status} @ ${url}`);
        await cache.put(url, fresh.clone());
        res = fresh;
      }
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      // 缓存失败则直连
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function doLoad(config: TreeSitterConfig): Promise<LoadedState | null> {
  if (!config.enabled) {
    tsLoadedGrammars = [];
    reportWasmStatus(MODULE_ID, {
      state: 'disabled',
      detail: '已在设置中关闭，使用正则解析',
      metrics: buildTreeSitterMetrics(),
    });
    return null;
  }
  reportWasmStatus(MODULE_ID, {
    state: 'loading',
    detail: '初始化运行时并加载语法包…',
  });
  try {
    // 动态引入：避免 web-tree-sitter (~150KB glue) 被静态打进初始包，
    // 仅在首次建索引时拉取。
    const TS = await import('web-tree-sitter');
    await TS.Parser.init({
      locateFile: () => config.runtimeWasmUrl || runtimeWasmUrl,
    });

    const base = config.wasmBaseUrl.endsWith('/')
      ? config.wasmBaseUrl
      : `${config.wasmBaseUrl}/`;

    const languages: Partial<Record<GrammarId, Language>> = {};
    const failed: GrammarId[] = [];
    for (const id of Object.keys(GRAMMAR_FILES) as GrammarId[]) {
      try {
        const bytes = await fetchGrammarBytes(`${base}${GRAMMAR_FILES[id]}`);
        languages[id] = await TS.Language.load(bytes);
      } catch (err) {
        failed.push(id);
        console.warn(`[tree-sitter] 语法包加载失败: ${id}`, err);
      }
    }

    tsLoadedGrammars = Object.keys(languages);
    if (tsLoadedGrammars.length === 0) {
      reportWasmStatus(MODULE_ID, {
        state: 'error',
        detail: '所有语法包加载失败，回退正则',
        lastError: `失败：${failed.join(', ')}`,
        metrics: buildTreeSitterMetrics(),
      });
      return null;
    }
    reportWasmStatus(MODULE_ID, {
      state: 'ready',
      detail: failed.length
        ? `部分就绪（失败：${failed.join(', ')}）`
        : '语法包已就绪',
      metrics: buildTreeSitterMetrics(),
    });
    const parser = new TS.Parser();
    return { languages, parser };
  } catch (err) {
    tsLoadedGrammars = [];
    reportWasmStatus(MODULE_ID, {
      state: 'error',
      detail: '运行时初始化失败，回退正则',
      lastError: err instanceof Error ? err.message : String(err),
      metrics: buildTreeSitterMetrics(),
    });
    console.warn('[tree-sitter] 运行时初始化失败，回退正则解析', err);
    return null;
  }
}

/**
 * 幂等地初始化 tree-sitter。config 变化时重新加载。
 * @returns 是否就绪（false 时调用方用正则）
 */
export async function ensureTreeSitterReady(
  config: TreeSitterConfig,
): Promise<boolean> {
  const sig = signatureOf(config);
  if (!readyPromise || sig !== readySignature) {
    readySignature = sig;
    readyPromise = doLoad(config);
    loaded = await readyPromise;
    return loaded !== null;
  }
  loaded = await readyPromise;
  return loaded !== null;
}

/** 释放（工作区切换等场景） */
export function disposeTreeSitter(): void {
  readyPromise = null;
  readySignature = '';
  loaded = null;
}

const grammarForPath = (path: string): GrammarId | null => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx')) return 'tsx';
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts'))
    return 'typescript';
  if (lower.endsWith('.vue')) return 'typescript'; // Vue 的 <script> 片段
  if (/\.(jsx|js|mjs|cjs)$/.test(lower)) return 'javascript';
  return null;
};

const isUpper = (name: string): boolean => /^[A-Z]/.test(name);

const firstLine = (text: string): string => {
  const line = text.split('\n', 1)[0]!.trim();
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
};

interface TSNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  namedChildren: (TSNode | null)[];
  childForFieldName(name: string): TSNode | null;
}

/**
 * 同步用已加载的 tree-sitter 解析顶层符号。
 * @returns SymbolDef[]；未就绪或不支持语言时返回 null。
 */
export function parseSymbolsTreeSitter(
  path: string,
  content: string,
  lineOffset = 0,
): SymbolDef[] | null {
  if (!loaded) return null;
  const grammarId = grammarForPath(path);
  if (!grammarId) return null;
  const language = loaded.languages[grammarId] ?? loaded.languages.typescript;
  if (!language) return null;

  try {
    loaded.parser.setLanguage(language);
    const tree = loaded.parser.parse(content);
    if (!tree) return null;
    const symbols: SymbolDef[] = [];
    for (const child of tree.rootNode.namedChildren as unknown as TSNode[]) {
      if (child) collectSymbols(child, path, lineOffset, symbols);
    }
    tsParseCount++;
    flushTreeSitterMetrics();
    return symbols;
  } catch (err) {
    tsFallbackCount++;
    flushTreeSitterMetrics();
    console.warn('[tree-sitter] 解析异常，回退正则', err);
    return null;
  }
}

const pushSymbol = (
  nameNode: TSNode | null,
  declNode: TSNode,
  kind: SymbolKind,
  path: string,
  lineOffset: number,
  out: SymbolDef[],
): void => {
  if (!nameNode) return;
  const name = nameNode.text;
  if (!name) return;
  const startLine = declNode.startPosition.row + 1 + lineOffset;
  const endLine = declNode.endPosition.row + 1 + lineOffset;
  out.push({
    id: `${path}#${name}:${startLine}`,
    name,
    kind,
    language: 'ts',
    path,
    startLine,
    endLine,
    signature: firstLine(declNode.text),
  });
};

/** 从顶层声明（含 export_statement 包裹）提取符号 */
function collectSymbols(
  node: TSNode,
  path: string,
  lineOffset: number,
  out: SymbolDef[],
): void {
  switch (node.type) {
    case 'export_statement': {
      const decl = node.childForFieldName('declaration');
      if (decl) {
        collectSymbols(decl, path, lineOffset, out);
      } else {
        for (const child of node.namedChildren) {
          if (child) collectSymbols(child, path, lineOffset, out);
        }
      }
      return;
    }
    case 'function_declaration':
    case 'generator_function_declaration': {
      const kind: SymbolKind = path.endsWith('.vue') ? 'component' : 'function';
      pushSymbol(node.childForFieldName('name'), node, kind, path, lineOffset, out);
      return;
    }
    case 'class_declaration':
    case 'abstract_class_declaration':
      pushSymbol(node.childForFieldName('name'), node, 'class', path, lineOffset, out);
      return;
    case 'interface_declaration':
      pushSymbol(node.childForFieldName('name'), node, 'interface', path, lineOffset, out);
      return;
    case 'type_alias_declaration':
    case 'enum_declaration':
      pushSymbol(node.childForFieldName('name'), node, 'type', path, lineOffset, out);
      return;
    case 'lexical_declaration':
    case 'variable_declaration': {
      for (const declarator of node.namedChildren) {
        if (!declarator || declarator.type !== 'variable_declarator') continue;
        const nameNode = declarator.childForFieldName('name');
        if (!nameNode) continue;
        const value = declarator.childForFieldName('value');
        const isFn =
          value?.type === 'arrow_function' || value?.type === 'function_expression';
        let kind: SymbolKind;
        if (isUpper(nameNode.text)) {
          kind = 'component';
        } else {
          kind = isFn ? 'function' : 'variable';
        }
        pushSymbol(nameNode, declarator, kind, path, lineOffset, out);
      }
      return;
    }
    default:
      return;
  }
}
