/**
 * RAG Agent 工具：searchWorkspaceSemantic
 * 语义检索工作区内容，与 searchFiles（词法）互补
 */

import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import { searchSemantic } from './retrieve';
import { workspace } from '../workspace/FileSystemWorkspace';
import {
  buildSearchMatcher,
  isLikelyTextPath,
  matchesAnyGlob,
  searchInContent,
} from '../workspace/search';
import { getCottageConfig } from '../config/store';

/**
 * 创建 RAG Cottage 工具
 */
export function createRagCottageTools(): CottageTool[] {
  return [
    cottageTool(
      async ({ query, topK }) => {
        const config = getCottageConfig();
        const fallbackToLexical = config.rag?.retrieval?.fallbackToLexical !== false;

        try {
          const results = await searchSemantic(query, { topK });

          if (results.length === 0) {
            if (fallbackToLexical) {
              return await lexicalFallback(query);
            }
            return {
              query,
              results: [],
              note: '语义检索无结果。建议缩小查询范围或使用 searchFiles 进行精确文本搜索。',
            };
          }

          // For results with good scores, read full text snippets
          const enriched = await Promise.all(
            results.map(async (r) => {
              try {
                const { content } = await workspace.readFile(r.path);
                if (!content) return r;
                const lines = content.split('\n');
                const snippet = lines
                  .slice(r.startLine - 1, r.endLine)
                  .join('\n');
                return { ...r, text: snippet };
              } catch {
                return r;
              }
            }),
          );

          return {
            query,
            resultCount: enriched.length,
            results: enriched.map((r) => ({
              path: r.path,
              lines: `${r.startLine}-${r.endLine}`,
              score: Math.round(r.score * 1000) / 1000,
              text: r.text.length > 500 ? r.text.slice(0, 500) + '...' : r.text,
            })),
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);

          // Fallback to lexical if index not found
          if (
            fallbackToLexical &&
            (errMsg === 'INDEX_NOT_FOUND' ||
              errMsg === 'INDEX_CORRUPTED' ||
              errMsg === 'INDEX_MODEL_MISMATCH')
          ) {
            return await lexicalFallback(query);
          }

          if (errMsg === 'INDEX_MODEL_MISMATCH') {
            return {
              query,
              error: errMsg,
              note: '当前嵌入模型与已建索引的维度不一致，请在设置中重新建库后再检索。',
            };
          }

          return {
            query,
            error: errMsg,
            note: '语义检索失败。请使用 searchFiles 进行文本搜索。',
          };
        }
      },
      {
        name: 'searchWorkspaceSemantic',
        description:
          '语义检索工作区代码和文档——找到与查询在意思上相关的文件片段（即使用词不同）。适合理解"X 在哪里实现"、"Y 是怎么工作的"类问题。索引不存在时自动降级为文本搜索。与 searchFiles（精确文本匹配）互补使用。',
        schema: z.object({
          query: z
            .string()
            .describe('自然语言查询，描述你想找的内容'),
          topK: z
            .number()
            .optional()
            .describe('返回的最大结果数（默认 5）'),
        }),
      },
    ),
  ];
}

/**
 * 词法降级：当语义索引不可用时，用 searchFiles 逻辑做简单文本搜索
 */
async function lexicalFallback(query: string) {
  const config = getCottageConfig();
  const ignoreGlobs = config.rag?.indexing?.ignoreGlobs ?? [];

  // Extract keywords from query (simple split)
  const keywords = query
    .split(/[\s,;]+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);

  if (keywords.length === 0) {
    return {
      query,
      results: [],
      note: '无语义索引且无法提取关键词。请使用 searchFiles。',
      fallback: true,
    };
  }

  const searchQuery = keywords.join('|');
  const matcher = buildSearchMatcher(searchQuery, { isRegex: true });

  const allFiles = await workspace.listFiles();
  const candidates = allFiles.filter((p) => {
    if (!isLikelyTextPath(p)) return false;
    if (matchesAnyGlob(p, ignoreGlobs)) return false;
    return true;
  });

  const results: { path: string; line: number; text: string }[] = [];
  const maxResults = 10;

  for (const path of candidates) {
    if (results.length >= maxResults) break;
    const { content } = await workspace.readFile(path);
    if (!content) continue;
    const matches = searchInContent(content, matcher, {
      contextLines: 1,
      maxMatches: 3,
    });
    for (const m of matches) {
      if (results.length >= maxResults) break;
      results.push({ path, line: m.line, text: m.text });
    }
  }

  return {
    query,
    resultCount: results.length,
    results,
    note: '语义索引不可用，已降级为关键词搜索。建议构建索引以获得更好的结果。',
    fallback: true,
  };
}
