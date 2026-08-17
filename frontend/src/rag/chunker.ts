/**
 * 文本分块器：将文件内容按配置拆分为 TextChunk
 * 支持按字符数 + 行边界切分，带重叠；coding 文件可选 AST/符号边界切块
 */

import { resolveAstAdapter } from '../domains/coding/ast/adapterRegistry';
import { resolveAdapterForPath } from '../domains/coding/parsers/adapterRegistry';
import type { TextChunk } from './types';

export interface ChunkOptions {
  /** 每块目标字符数（默认 1000） */
  chunkSize?: number;
  /** 重叠比例 0~0.5（默认 0.15） */
  chunkOverlap?: number;
  /** 分块策略 */
  strategy?: 'char' | 'ast';
}

/**
 * 对单个文件文本进行分块
 * @param path 文件相对路径
 * @param content 文件文本内容
 * @param options 分块参数
 */
export function chunkText(
  path: string,
  content: string,
  options: ChunkOptions = {},
): TextChunk[] {
  const chunkSize = options.chunkSize ?? 1000;
  const overlapRatio = Math.min(Math.max(options.chunkOverlap ?? 0.15, 0), 0.5);
  const overlapChars = Math.floor(chunkSize * overlapRatio);

  const lines = content.split('\n');
  if (lines.length === 0 || content.trim().length === 0) return [];

  const chunks: TextChunk[] = [];
  let currentChars = 0;
  let chunkStartLine = 0; // 0-based index into lines[]
  let chunkLines: string[] = [];

  const flushChunk = (endLineIdx: number) => {
    if (chunkLines.length === 0) return;
    const text = chunkLines.join('\n');
    if (text.trim().length === 0) {
      chunkLines = [];
      currentChars = 0;
      chunkStartLine = endLineIdx + 1;
      return;
    }
    const id = `${path}:${chunkStartLine + 1}`;
    chunks.push({
      id,
      path,
      startLine: chunkStartLine + 1, // 1-based
      endLine: endLineIdx + 1, // 1-based
      text,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineLen = line.length + 1; // +1 for \n

    if (currentChars + lineLen > chunkSize && chunkLines.length > 0) {
      // flush current chunk
      flushChunk(i - 1);

      // calculate overlap: walk back from end of chunk
      const overlapLines: string[] = [];
      let overlapTotal = 0;
      for (let j = chunkLines.length - 1; j >= 0; j--) {
        const l = chunkLines[j];
        if (overlapTotal + l.length + 1 > overlapChars) break;
        overlapLines.unshift(l);
        overlapTotal += l.length + 1;
      }

      // start new chunk with overlap
      chunkLines = [...overlapLines, line];
      currentChars = overlapTotal + lineLen;
      chunkStartLine = i - overlapLines.length;
    } else {
      chunkLines.push(line);
      currentChars += lineLen;
    }
  }

  // flush remaining
  if (chunkLines.length > 0) {
    flushChunk(lines.length - 1);
  }

  return chunks;
}

/**
 * 按顶层符号边界切块（TS/JS/Vue）；符号过大时再按字符二级切分。
 */
export function chunkByAst(
  path: string,
  content: string,
  options: ChunkOptions = {},
): TextChunk[] {
  const parser = resolveAdapterForPath(path);
  if (!parser) return chunkText(path, content, options);

  const chunkSize = options.chunkSize ?? 1000;
  const { symbols } = parser.parse(path, content);
  if (symbols.length === 0) return chunkText(path, content, options);

  const lines = content.split('\n');
  const sorted = [...symbols].sort((a, b) => a.startLine - b.startLine);
  const chunks: TextChunk[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const sym = sorted[i];
    const startLine = sym.startLine;
    const endLine =
      i + 1 < sorted.length ? sorted[i + 1].startLine - 1 : lines.length;
    const text = lines.slice(startLine - 1, endLine).join('\n');
    if (!text.trim()) continue;

    if (text.length > chunkSize) {
      const subChunks = chunkText(path, text, options);
      const lineOffset = startLine - 1;
      for (const sub of subChunks) {
        chunks.push({
          ...sub,
          id: `${path}:${lineOffset + sub.startLine}`,
          startLine: lineOffset + sub.startLine,
          endLine: lineOffset + sub.endLine,
        });
      }
    } else {
      chunks.push({
        id: `${path}:${startLine}`,
        path,
        startLine,
        endLine,
        text,
      });
    }
  }

  return chunks.length > 0 ? chunks : chunkText(path, content, options);
}

/** 按配置选择 char 或 ast 切块 */
export function chunkFile(
  path: string,
  content: string,
  options: ChunkOptions = {},
): TextChunk[] {
  const strategy = options.strategy ?? 'char';
  if (strategy === 'ast' && resolveAstAdapter(path)) {
    return chunkByAst(path, content, options);
  }
  return chunkText(path, content, options);
}

/**
 * 简单哈希：用于增量索引检测文件是否变更
 * 使用 Web Crypto API 的 SHA-256
 */
export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
