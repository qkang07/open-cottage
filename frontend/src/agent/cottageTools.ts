import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import type { CottageToolConfig } from '@/agent/runtime/tool';
import { z } from 'zod';
import { workspace, type FileSystemWorkspace } from '../workspace/FileSystemWorkspace';
import { normalizePath } from '../workspace/pathUtils';
import {
  applySearchReplace,
  buildSearchMatcher,
  isLikelyTextPath,
  matchesAnyGlob,
  matchesGlob,
  searchInContent,
  type SearchLineMatch,
} from '../workspace/search';
import {
  appendTaskEvent,
  loadTaskState,
  saveTaskCanvas,
  saveTaskManifest,
  saveTaskPlan,
  saveTaskState,
} from '../task/persistence';
import type {
  TaskDeliverableCanvas,
  TaskHandoff,
  TaskManifest,
  TaskPlan,
  TaskPlanStep,
} from '../task/types';
import { applyFilePatches } from './patchFile';
import { parsePatchArgs } from './parsePatchArgs';
import { runScriptInWorker, type ScriptToolInvoker } from './runScript';
import { RUN_SCRIPT_TOOL_DESCRIPTION } from './scriptWorkerProtocol';
import type {
  SearchSource,
  ThirdPartySearchProviderId,
} from '../config/constants';
import { fetchWebPageContent } from './fetchWebPage';
import { runThirdPartySearch } from './thirdPartySearch';
import {
  type CottageServiceClient,
  type CottageServiceSearchEngine,
  type CottageServiceSearchResponse,
} from '../cottageService/client';
import type { TaskToolSignals, DispatchSubtaskFn } from './taskToolSignals';
import type { ChatAttachment } from '../chat/attachments';
import {
  dataUrlToBytes,
  isAttachmentPath,
} from '../chat/attachmentStorage';

const jsonResult = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);

/** 写入前后内容捕获上限：超过则不带回 UI（避免大文件内存膨胀） */
const DIFF_CAPTURE_MAX_BYTES = 256 * 1024;

/** hashFile 单文件上限：超过则拒绝整读计算，改用元信息或抽样对比 */
const HASH_FILE_MAX_BYTES = 128 * 1024 * 1024;

const bytesToHex = (bytes: Uint8Array): string => {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
};

const captureSnapshot = async (
  path: string,
  ws: Pick<FileSystemWorkspace, 'exists' | 'readFile'> = workspace,
): Promise<{ before: string; hasBefore: boolean } | null> => {
  try {
    if (!(await ws.exists(path))) {
      return { before: '', hasBefore: false };
    }
    const { content } = await ws.readFile(path);
    if (content.length > DIFF_CAPTURE_MAX_BYTES) return null;
    return { before: content, hasBefore: true };
  } catch {
    return null;
  }
};

const withSnapshot = (
  snapshot: { before: string; hasBefore: boolean } | null,
  after: string,
  base: Record<string, unknown>,
): Record<string, unknown> => {
  if (!snapshot) return base;
  return {
    ...base,
    before: snapshot.before,
    after,
    created: !snapshot.hasBefore,
  };
};

export interface WriteSnapshot {
  before: string;
  after: string;
  created: boolean;
}

/**
 * 从工具输出中剥离 before/after/created（仅供 UI 渲染 diff），
 * 返回给 LLM 的结果文本不再包含文件全文，避免 token 膨胀。
 */
export const stripWriteSnapshot = (
  output: unknown,
): { resultText: string; snapshot: WriteSnapshot | null } => {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    return { resultText: jsonResult(output), snapshot: null };
  }
  const record = output as Record<string, unknown>;
  const before = typeof record.before === 'string' ? record.before : undefined;
  const after = typeof record.after === 'string' ? record.after : undefined;
  if (before === undefined || after === undefined) {
    return { resultText: jsonResult(output), snapshot: null };
  }
  const rest: Record<string, unknown> = { ...record };
  const created = rest.created;
  delete rest.before;
  delete rest.after;
  delete rest.created;
  return {
    resultText: jsonResult(rest),
    snapshot: {
      before,
      after,
      created: Boolean(created),
    },
  };
};

/**
 * 从工具输出中剥离 cottageImages（工作区图片路径列表）：
 * 图片经附件通道回传模型，结果文本保持纯文本（同 stripWriteSnapshot 约定）。
 */
export const stripCottageImages = (
  output: unknown,
): { output: unknown; imagePaths: string[] } => {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    return { output, imagePaths: [] };
  }
  const record = output as Record<string, unknown>;
  if (!Array.isArray(record.cottageImages)) {
    return { output, imagePaths: [] };
  }
  const imagePaths = record.cottageImages.filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  const rest: Record<string, unknown> = { ...record };
  delete rest.cottageImages;
  return { output: rest, imagePaths };
};

/**
 * 轻量看图工具：读取工作区图片给模型看（经 cottageImages 附件通道注入对话）。
 * 仅在当前模型支持 vision 时注册（见 createCottageAgent）。
 */
export const createViewImageTool = (): CottageTool =>
  cottageTool(
    async ({ path }) => {
      const normalized = normalizePath(path);
      const kind = await workspace.getEntryKind(normalized);
      if (kind !== 'file') {
        throw new Error(`图片文件不存在: ${normalized}`);
      }
      if (!/\.(png|jpe?g|webp|gif|bmp)$/i.test(normalized)) {
        throw new Error('仅支持 png / jpg / webp / gif / bmp 图片文件');
      }
      return {
        path: normalized,
        cottageImages: [normalized],
        note: '图片已随本结果注入对话，请直接观察图片内容。',
      };
    },
    {
      name: 'viewImage',
      description:
        '查看工作区内的图片文件（png / jpg / webp / gif / bmp），图片会注入对话供你直接观察内容。适用于查看截图、用户素材、生成结果等图像。',
      schema: z.object({
        path: z.string().describe('图片文件的工作区相对路径，如 "screenshots/page-xxx.png"'),
      }),
    },
  );

/**
 * 保存聊天附件工具：把用户发送 / 工具回传的图片附件写到工作区指定路径。
 * 附件按文件名、附件 id 或已落盘路径定位（重名时取最近一条）；
 * 路径态附件读工作区文件复制，内联态（inline-base64）直接解码写入。
 */
export const createSaveChatAttachmentTool = (
  getAttachments: () => ChatAttachment[],
  onMutate?: () => void | Promise<void>,
): CottageTool =>
  cottageTool(
    async ({ attachment, targetPath }) => {
      const key = attachment.trim();
      const list = getAttachments();
      const found = [...list]
        .reverse()
        .find(
          (a) =>
            a.id === key ||
            a.filename === key ||
            a.data === key ||
            a.sourcePath === key,
        );
      if (!found) {
        const available = list.length
          ? list.map((a) => a.filename).join('、')
          : '（无）';
        throw new Error(`未找到附件 "${key}"，当前会话附件：${available}`);
      }
      const sourcePath =
        found.sourcePath ??
        (isAttachmentPath(found.data) ? found.data : undefined);
      const bytes = sourcePath
        ? await workspace.readFileBytes(sourcePath)
        : dataUrlToBytes(found.data).bytes;
      const target = normalizePath(targetPath);
      await workspace.writeFileBytes(target, bytes);
      await onMutate?.();
      return { savedTo: target, bytes: bytes.byteLength };
    },
    {
      name: 'saveChatAttachment',
      description:
        '把聊天中的图片附件（用户发送或工具回传）保存到工作区指定路径。消息中标注的 [图片附件 文件名: 路径] 可作为定位依据。',
      schema: z.object({
        attachment: z
          .string()
          .describe(
            '附件的文件名、附件 id 或其工作区路径（如 ".cottage/attachments/xxx.png"）',
          ),
        targetPath: z
          .string()
          .describe('保存目标的工作区相对路径（含文件名），如 "assets/logo.png"'),
      }),
    },
  );

const parseSteps = (value: unknown): TaskPlanStep[] => {
  if (!Array.isArray(value)) throw new Error('steps 必须是数组');
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`steps[${index}] 无效`);
    }
    const row = item as Record<string, unknown>;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!title) throw new Error(`steps[${index}].title 必填`);
    const status =
      row.status === 'pending' ||
      row.status === 'doing' ||
      row.status === 'done'
        ? row.status
        : 'pending';
    const id =
      typeof row.id === 'string' && row.id.trim()
        ? row.id.trim()
        : `step-${index + 1}`;
    return { id, title, status };
  });
};

const parseManifestPaths = (value: unknown): TaskManifest['paths'] => {
  if (!Array.isArray(value)) throw new Error('paths 必须是数组');
  return value.map((item, index) => {
    if (typeof item === 'string') {
      const path = item.trim();
      if (!path) throw new Error(`paths[${index}] 不能为空`);
      return { path };
    }
    if (typeof item === 'object' && item !== null) {
      const row = item as Record<string, unknown>;
      const path = typeof row.path === 'string' ? row.path.trim() : '';
      if (!path) throw new Error(`paths[${index}].path 必填`);
      const description =
        typeof row.description === 'string' ? row.description : undefined;
      return { path, description };
    }
    throw new Error(`paths[${index}] 无效`);
  });
};

const linePatchSchema = z.object({
  start: z.number(),
  end: z.number().optional(),
  action: z.enum(['replace', 'delete', 'insert_before', 'insert_after']),
  content: z.string().optional(),
});

const columnPatchSchema = z.object({
  line: z.number(),
  start: z.number(),
  end: z.number().optional(),
  content: z.string(),
});

const regexPatchSchema = z.object({
  pattern: z.string(),
  replacement: z.string(),
  flags: z.string().optional(),
  maxReplacements: z.number().optional(),
});

import { trackMutation } from '../history/autoCheckpoint';
import {
  READ_FILE_DEFAULT_MAX_CHARS,
  sliceTextFileContent,
} from './readFileSlice';
import type { ExplorerEntry } from '../workspace/explorerTypes';
import { applyUnifiedPatch } from './applyUnifiedPatch';
import { diffLines } from '../domains/coding/ast/diff';

const matchesExtensions = (
  path: string,
  extensions: readonly string[] | undefined,
): boolean => {
  if (!extensions?.length) return true;
  const lower = path.toLowerCase();
  return extensions.some((ext) => {
    const normalized = ext.startsWith('.')
      ? ext.toLowerCase()
      : `.${ext.toLowerCase()}`;
    return lower.endsWith(normalized);
  });
};

export const createFileCottageTools = (
  onMutate?: () => void | Promise<void>,
  stagingWorkspace?: Pick<
    FileSystemWorkspace,
    | 'readFile'
    | 'exists'
    | 'writeFile'
    | 'createFile'
    | 'deleteFile'
    | 'listFiles'
    | 'getEntryKind'
    | 'statFile'
    | 'readFileBytes'
    | 'listDirectoryContents'
    | 'appendFile'
  >,
  /** cottage.* SDK 的工具执行桥（runScript 脚本内调用 agent 工具） */
  scriptToolInvoker?: ScriptToolInvoker,
): CottageTool[] => {
  // 暂存感知 workspace：写入先落内存暂存区，读取叠加暂存；缺省回退真实 workspace。
  const ws = stagingWorkspace ?? workspace;
  const notify = async (paths?: string[]) => {
    if (paths?.length) trackMutation(paths);
    await onMutate?.();
  };

  return [
    cottageTool(
      async ({ prefix, limit }) => {
        const paths = await ws.listFiles(normalizePath(prefix ?? ''));
        const max = Math.max(1, Math.min(limit ?? 80, 500));
        return {
          paths: paths.slice(0, max),
          count: paths.length,
          truncated: paths.length > max,
        };
      },
      {
        name: 'listFiles',
        description:
          '递归列出工作空间内文件路径（相对路径）。优先用 listDirectory（单层）或 findFiles/searchFiles；仅在确实需要递归清单时使用。默认最多 80 条；仅在需要更小结果集或缩小范围时再传 limit / prefix。',
        schema: z.object({
          prefix: z
            .string()
            .optional()
            .describe('目录前缀，如 "src"；根目录省略，勿传 "."'),
          limit: z
            .number()
            .optional()
            .describe('最多返回条数，默认 80；仅需更小时再传，勿机械填 50'),
        }),
      },
    ),
    cottageTool(
      async ({ path, limit }) => {
        const dir = normalizePath(path ?? '');
        const entries = await ws.listDirectoryContents(dir, {
          includeFileMetadata: true,
        });
        const max = Math.max(1, Math.min(limit ?? 100, 500));
        return {
          path: dir,
          entries: entries.slice(0, max).map((e: ExplorerEntry) => ({
            name: e.name,
            path: e.path,
            kind: e.kind,
            size: e.size,
          })),
          count: entries.length,
          truncated: entries.length > max,
        };
      },
      {
        name: 'listDirectory',
        description:
          '列出单个目录的直接子项（文件与子目录，非递归）。比 listFiles 更省上下文；查看某一层结构时优先用本工具。列出根目录时省略 path（勿传 "." 或 "/"）；limit 有默认值，无需机械填写。',
        schema: z.object({
          path: z
            .string()
            .optional()
            .describe(
              '目录相对路径，如 "src/components"；列出根目录时省略本字段，勿传 "." 或 "/"',
            ),
          limit: z
            .number()
            .optional()
            .describe('最多返回条数，默认 100；仅需更小结果集时再传，勿机械填 50'),
        }),
      },
    ),
    cottageTool(
      async ({ path }) => {
        const normalized = normalizePath(path);
        const kind = await ws.getEntryKind(normalized);
        return {
          path: normalized,
          exists: kind != null,
          kind: kind ?? undefined,
        };
      },
      {
        name: 'exists',
        description: '检查路径是否存在，并返回 kind（file / directory）。',
        schema: z.object({ path: z.string() }),
      },
    ),
    cottageTool(
      async ({ path }) => {
        const normalized = normalizePath(path);
        const kind = await ws.getEntryKind(normalized);
        if (kind == null) {
          return { path: normalized, exists: false };
        }
        if (kind === 'directory') {
          return { path: normalized, exists: true, kind: 'directory' };
        }
        const stat = await ws.statFile(normalized);
        return {
          path: normalized,
          exists: true,
          kind: 'file' as const,
          size: stat?.size ?? null,
          modified: stat?.modified ?? null,
        };
      },
      {
        name: 'statFile',
        description:
          '获取文件/目录元信息：是否存在、kind、文件 size（字节）与 modified。读大文件前可先看 size，再决定 readFile 的 offset/limit。',
        schema: z.object({ path: z.string() }),
      },
    ),
    cottageTool(
      async ({ path }) => {
        const normalized = normalizePath(path);
        const kind = await ws.getEntryKind(normalized);
        if (kind == null) {
          throw new Error(`文件不存在：${normalized}`);
        }
        if (kind === 'directory') {
          throw new Error(`无法对目录计算 hash：${normalized}`);
        }
        const stat = await ws.statFile(normalized);
        if (stat && stat.size > HASH_FILE_MAX_BYTES) {
          throw new Error(
            `文件过大（${stat.size} 字节），超过 hash 计算上限 ${HASH_FILE_MAX_BYTES} 字节；请改用 size/modified 或抽样内容对比`,
          );
        }
        const bytes = await ws.readFileBytes(normalized);
        const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
        return {
          path: normalized,
          algorithm: 'sha256',
          hash: bytesToHex(new Uint8Array(digest)),
          size: bytes.length,
        };
      },
      {
        name: 'hashFile',
        description:
          '计算文件内容的 SHA-256 hash，用于判断两个文件是否完全相同（同名 ≠ 同文件）。返回 hash 与 size；超过上限的大文件会拒绝，改用 statFile 元信息或抽样对比。',
        schema: z.object({ path: z.string() }),
      },
    ),
    cottageTool(
      async ({ path, offset, limit, maxChars }) => {
        const { content } = await ws.readFile(path);
        const sliced = sliceTextFileContent(content, {
          offset,
          limit,
          maxChars: maxChars ?? READ_FILE_DEFAULT_MAX_CHARS,
        });
        return {
          path: normalizePath(path),
          content: sliced.content,
          totalLines: sliced.totalLines,
          startLine: sliced.startLine,
          endLine: sliced.endLine,
          truncated: sliced.truncatedByLines || sliced.truncatedByChars,
          truncatedByLines: sliced.truncatedByLines,
          truncatedByChars: sliced.truncatedByChars,
        };
      },
      {
        name: 'readFile',
        description:
          '读取纯文本文件内容（如 .ts/.md/.json/.txt）。可用 offset（1-based 行号）与 limit（行数）分段读取；maxChars 限制返回字符数（默认约 100000）。xlsx/csv 用 readSpreadsheet，docx 用 readWord，pptx 用 readPresentation。',
        schema: z.object({
          path: z.string(),
          offset: z.number().optional().describe('起始行号（1-based）'),
          limit: z.number().optional().describe('最多返回的行数'),
          maxChars: z.number().optional().describe('返回内容最大字符数'),
        }),
      },
    ),
    cottageTool(
      async ({ paths, maxCharsPerFile, maxTotalChars }) => {
        const unique = [...new Set(paths.map((p) => normalizePath(p)).filter(Boolean))];
        if (!unique.length) throw new Error('paths 不能为空');
        if (unique.length > 20) throw new Error('一次最多读取 20 个文件');
        const perFile = Math.max(
          1,
          Math.min(maxCharsPerFile ?? 40_000, READ_FILE_DEFAULT_MAX_CHARS),
        );
        const totalBudget = Math.max(
          perFile,
          Math.min(maxTotalChars ?? 120_000, 300_000),
        );
        const files: Array<Record<string, unknown>> = [];
        let used = 0;
        let truncated = false;
        for (const path of unique) {
          if (used >= totalBudget) {
            truncated = true;
            break;
          }
          if (!(await ws.exists(path))) {
            files.push({ path, missing: true });
            continue;
          }
          const { content } = await ws.readFile(path);
          const remain = totalBudget - used;
          const sliced = sliceTextFileContent(content, {
            maxChars: Math.min(perFile, remain),
          });
          used += sliced.content.length;
          files.push({
            path,
            content: sliced.content,
            totalLines: sliced.totalLines,
            truncated: sliced.truncatedByChars || sliced.truncatedByLines,
          });
          if (sliced.truncatedByChars) truncated = true;
        }
        return { count: files.length, truncated, files };
      },
      {
        name: 'readMany',
        description:
          '批量读取多个纯文本小文件（最多 20 个）。适合一次取若干已知路径；大文件请用 readFile 分段。可用 maxCharsPerFile / maxTotalChars 控制体积。',
        schema: z.object({
          paths: z.array(z.string()).min(1),
          maxCharsPerFile: z.number().optional(),
          maxTotalChars: z.number().optional(),
        }),
      },
    ),
    cottageTool(
      async ({ glob, limit }) => {
        const all = await ws.listFiles();
        const matched = all.filter((p) => matchesGlob(p, glob));
        const max = Math.max(1, Math.min(limit ?? 50, 500));
        return {
          glob,
          count: matched.length,
          paths: matched.slice(0, max),
          truncated: matched.length > max,
        };
      },
      {
        name: 'findFiles',
        description:
          '按 glob 模式查找文件路径。支持 ** 跨目录、* 单层、? 单字符、{a,b} 分支。示例：src/**/*.ts、**/*.{json,md}。默认最多 50 条；仅需不同上限时再传 limit。',
        schema: z.object({
          glob: z.string(),
          limit: z
            .number()
            .optional()
            .describe('最多返回条数，默认 50；与默认相同则省略'),
        }),
      },
    ),
    cottageTool(
      async ({
        query,
        isRegex,
        caseSensitive,
        path: dirPath,
        include,
        exclude,
        extensions,
        contextLines,
        maxResults,
      }) => {
        const matcher = buildSearchMatcher(query, { isRegex, caseSensitive });
        const includeGlobs = include?.length ? include : undefined;
        const excludeGlobs = exclude?.length ? exclude : undefined;
        const ctx = Math.max(0, Math.min(contextLines ?? 1, 10));
        const totalCap = Math.max(1, Math.min(maxResults ?? 20, 200));
        const perFileCap = 10;
        const base = normalizePath(dirPath ?? '');

        const candidates = (await ws.listFiles(base)).filter((p) => {
          if (!isLikelyTextPath(p)) return false;
          if (!matchesExtensions(p, extensions)) return false;
          if (includeGlobs && !matchesAnyGlob(p, includeGlobs)) return false;
          if (excludeGlobs && matchesAnyGlob(p, excludeGlobs)) return false;
          return true;
        });

        const results: { path: string; matches: SearchLineMatch[] }[] = [];
        let matchCount = 0;
        let truncated = false;

        for (const path of candidates) {
          if (matchCount >= totalCap) {
            truncated = true;
            break;
          }
          const { content } = await ws.readFile(path);
          if (!content) continue;
          const remaining = Math.min(perFileCap, totalCap - matchCount);
          const matches = searchInContent(content, matcher, {
            contextLines: ctx,
            maxMatches: remaining,
          });
          if (matches.length) {
            results.push({ path, matches });
            matchCount += matches.length;
          }
        }

        return {
          query,
          path: base || undefined,
          fileCount: results.length,
          matchCount,
          truncated,
          results,
        };
      },
      {
        name: 'searchFiles',
        description:
          '在工作空间纯文本文件内按内容搜索（类似 grep），返回命中文件、行号与上下文。默认子串、忽略大小写；isRegex=true 时按正则。可用 path（目录前缀）、extensions（如 [".ts",".vue"]）、include/exclude（glob）限定范围。contextLines 默认 1、最大 10。默认 maxResults=20。',
        schema: z.object({
          query: z.string(),
          isRegex: z.boolean().optional(),
          caseSensitive: z.boolean().optional(),
          path: z
            .string()
            .optional()
            .describe('仅搜索该目录前缀下的文件，如 "src"；全库搜索时省略，勿传 "."'),
          include: z.array(z.string()).optional(),
          exclude: z.array(z.string()).optional(),
          extensions: z
            .array(z.string())
            .optional()
            .describe('扩展名过滤，如 [".ts", ".vue"]'),
          contextLines: z.number().optional(),
          maxResults: z.number().optional(),
        }),
      },
    ),
    cottageTool(
      async ({ left, right, maxChars }) => {
        const leftPath = normalizePath(left);
        const rightPath = normalizePath(right);
        const leftContent = (await ws.readFile(leftPath)).content;
        const rightContent = (await ws.readFile(rightPath)).content;
        let diff = diffLines(leftContent, rightContent);
        const cap = Math.max(1, Math.min(maxChars ?? 50_000, 200_000));
        const truncated = diff.length > cap;
        if (truncated) diff = diff.slice(0, cap);
        return {
          left: leftPath,
          right: rightPath,
          identical: leftContent === rightContent,
          diff,
          truncated,
        };
      },
      {
        name: 'diffFiles',
        description:
          '对比两个纯文本文件，返回 unified diff。文件相同则 identical=true 且 diff 为空。',
        schema: z.object({
          left: z.string(),
          right: z.string(),
          maxChars: z.number().optional(),
        }),
      },
    ),
    cottageTool(
      async (args) => {
        const { path, patches } = parsePatchArgs(args);
        const snapshot = await captureSnapshot(path, ws);
        const { content } = await ws.readFile(path);
        const patched = applyFilePatches(content, patches);
        const result = await ws.writeFile(path, patched.content);
        await notify([path]);
        return withSnapshot(snapshot, patched.content, {
          ...result,
          lineEdits: patched.lineEdits,
          columnEdits: patched.columnEdits,
          regexReplacements: patched.regexReplacements,
        });
      },
      {
        name: 'patchFile',
        description:
          '局部修改文件。支持 lines / columns / regex，按 lines → columns → regex 顺序应用。多文件大块改动优先用 applyPatch（unified diff）。',
        schema: z.object({
          path: z.string(),
          lines: z.array(linePatchSchema).optional(),
          columns: z.array(columnPatchSchema).optional(),
          regex: z.array(regexPatchSchema).optional(),
        }),
      },
    ),
    cottageTool(
      async ({ path, edits }) => {
        if (!(await ws.exists(path))) {
          throw new Error(`文件不存在：${normalizePath(path)}`);
        }
        const snapshot = await captureSnapshot(path, ws);
        const { content } = await ws.readFile(path);
        const patched = applySearchReplace(content, edits);
        const result = await ws.writeFile(path, patched.content);
        await notify([path]);
        return withSnapshot(snapshot, patched.content, {
          ...result,
          replacements: patched.replacements,
        });
      },
      {
        name: 'editFile',
        description:
          '通过“精确查找-替换”编辑已存在的文件，比 patchFile 行号更可靠，推荐优先使用。每个 edit 的 search 必须与文件中片段逐字符匹配（含缩进与换行）；默认要求唯一匹配，命中多处需设 replaceAll=true。多文件大块改动可用 applyPatch。',
        schema: z.object({
          path: z.string(),
          edits: z
            .array(
              z.object({
                search: z.string(),
                replace: z.string(),
                replaceAll: z.boolean().optional(),
              }),
            )
            .min(1),
        }),
      },
    ),
    cottageTool(
      async ({ patch, path }) => {
        const results = await applyUnifiedPatch(patch, {
          defaultPath: path,
          readFile: async (p) => {
            if (!(await ws.exists(p))) return null;
            const { content } = await ws.readFile(p);
            return content;
          },
        });
        const applied: Array<Record<string, unknown>> = [];
        const mutated: string[] = [];
        for (const item of results) {
          if (item.deleted) {
            await ws.deleteFile(item.path);
            mutated.push(item.path);
            applied.push({ path: item.path, deleted: true });
            continue;
          }
          await ws.writeFile(item.path, item.after);
          mutated.push(item.path);
          applied.push({
            path: item.path,
            written: true,
            created: item.created,
          });
        }
        await notify(mutated);
        return { count: applied.length, files: applied };
      },
      {
        name: 'applyPatch',
        description:
          '应用 unified diff（可含多文件）。支持 --- a/path / +++ b/path，新建用 --- /dev/null，删除用 +++ /dev/null。也可只传 @@ hunks 并另给 path。上下文须与文件逐行匹配。',
        schema: z.object({
          patch: z.string().describe('unified diff 文本'),
          path: z
            .string()
            .optional()
            .describe('裸 hunk（无 ---/+++）时的目标文件路径'),
        }),
      },
    ),
    cottageTool(
      async ({ path, content }) => {
        const snapshot = await captureSnapshot(path, ws);
        const result = await ws.writeFile(path, content);
        await notify([path]);
        return withSnapshot(snapshot, content, result);
      },
      {
        name: 'writeFile',
        description: '写入或覆盖工作空间中的文件。',
        schema: z.object({ path: z.string(), content: z.string() }),
      },
    ),
    cottageTool(
      async ({ path, content }) => {
        const snapshot = await captureSnapshot(path, ws);
        const result = await ws.createFile(path, content ?? '');
        await notify([path]);
        return withSnapshot(snapshot, content ?? '', result);
      },
      {
        name: 'createFile',
        description: '在工作空间中新建文件。',
        schema: z.object({
          path: z.string(),
          content: z.string().optional(),
        }),
      },
    ),
    cottageTool(
      async ({ path, content }) => {
        const snapshot = await captureSnapshot(path, ws);
        const before = snapshot?.before ?? '';
        const result = await ws.appendFile(path, content);
        const after =
          before.length === 0
            ? content
            : before.endsWith('\n') || content.startsWith('\n')
              ? before + content
              : `${before}\n${content}`;
        await notify([path]);
        return withSnapshot(snapshot, after, {
          ...result,
          path: normalizePath(path),
          appended: true,
          created: before.length === 0 || snapshot?.hasBefore === false,
        });
      },
      {
        name: 'appendFile',
        description:
          '在纯文本文件末尾追加内容；文件不存在则创建。适合日志、逐行导出，避免整文件 writeFile。',
        schema: z.object({
          path: z.string(),
          content: z.string(),
        }),
      },
    ),
    cottageTool(
      async ({ path }) => {
        const normalized = normalizePath(path);
        if (await ws.exists(normalized)) {
          return { path: normalized, touched: true, created: false };
        }
        await ws.createFile(normalized, '');
        await notify([normalized]);
        return { path: normalized, touched: true, created: true };
      },
      {
        name: 'touch',
        description: '确保路径存在：若不存在则创建空文件；已存在则不做修改。',
        schema: z.object({ path: z.string() }),
      },
    ),
    cottageTool(
      async ({ paths }) => {
        const list = Array.isArray(paths)
          ? paths
          : typeof paths === 'string' && paths.trim()
            ? [paths]
            : [];
        if (!list.length) {
          return { deletedFiles: [], deletedDirs: [], note: '未提供有效路径' };
        }
        const result = await workspace.deletePaths(list);
        await notify([...result.deletedFiles, ...result.deletedDirs]);
        return result;
      },
      {
        name: 'deleteFiles',
        description:
          '删除文件或文件夹（文件夹递归删除，支持任意深度路径）；paths 可传单个路径或路径数组。多个目标务必一次传入批量删除，避免逐个调用反复触发审批。',
        schema: z.object({
          paths: z.union([z.string(), z.array(z.string()).min(1)]),
        }),
      },
    ),
    cottageTool(
      async ({ path }) => {
        const result = await workspace.mkdir(path);
        await notify();
        return result;
      },
      {
        name: 'mkdir',
        description: '创建目录（支持嵌套路径）。',
        schema: z.object({ path: z.string() }),
      },
    ),
    cottageTool(
      async ({ from, to }) => {
        const result = await workspace.rename(from, to);
        await notify([from, to]);
        return result;
      },
      {
        name: 'rename',
        description: '重命名或移动文件/文件夹（与 move 等价）。',
        schema: z.object({ from: z.string(), to: z.string() }),
      },
    ),
    cottageTool(
      async ({ from, to }) => {
        const result = await workspace.move(from, to);
        await notify([from, to]);
        return result;
      },
      {
        name: 'move',
        description: '移动或重命名文件/文件夹（与 rename 等价，语义更清晰）。',
        schema: z.object({ from: z.string(), to: z.string() }),
      },
    ),
    cottageTool(
      async ({ from, to }) => {
        const result = await workspace.copy(from, to);
        await notify([to]);
        return result;
      },
      {
        name: 'copy',
        description:
          '复制文件或目录树到目标路径（不删除源）。目标路径必须尚不存在。目录会递归复制其下文件。',
        schema: z.object({ from: z.string(), to: z.string() }),
      },
    ),
    cottageTool(
      async ({ items }) => {
        const result = await workspace.copyPaths(items);
        await notify(items.map((i) => i.to));
        return result;
      },
      {
        name: 'copyPaths',
        description: '批量复制：items 为 { from, to } 数组，每项规则同 copy。',
        schema: z.object({
          items: z
            .array(z.object({ from: z.string(), to: z.string() }))
            .min(1),
        }),
      },
    ),
    cottageTool(
      async ({ path }) => {
        const result = await workspace.getDirectorySize(path ?? '');
        if (!result) {
          return {
            path: normalizePath(path ?? ''),
            exists: false,
          };
        }
        return {
          path: normalizePath(path ?? ''),
          exists: true,
          totalBytes: result.totalBytes,
          fileCount: result.fileCount,
          directoryCount: result.directoryCount,
        };
      },
      {
        name: 'getDirectorySize',
        description:
          '统计目录（递归）下文件总字节数、文件数与子目录数。用于评估大目录体积；默认跳过常见依赖目录策略与 listFiles 一致。',
        schema: z.object({
          path: z
            .string()
            .optional()
            .describe(
              '目录相对路径，如 "dist"；统计根目录时省略，勿传 "." 或 "/"',
            ),
        }),
      },
    ),
    cottageTool(
      async ({ paths, outputPath }) => {
        const result = await workspace.compress(paths, outputPath);
        await notify([outputPath]);
        return result;
      },
      {
        name: 'compress',
        description: '将多个路径压缩为 zip（paths 至少包含 1 项）。',
        schema: z.object({
          paths: z.array(z.string()),
          outputPath: z.string(),
        }),
      },
    ),
    cottageTool(
      async ({ archivePath, targetDir }) => {
        const result = await workspace.extract(archivePath, targetDir ?? '');
        await notify();
        return result;
      },
      {
        name: 'extract',
        description: '解压工作空间内的 zip。',
        schema: z.object({
          archivePath: z.string(),
          targetDir: z.string().optional(),
        }),
      },
    ),
    cottageTool(
      async ({ code }, config?: CottageToolConfig) => {
        const { result, logs } = await runScriptInWorker(
          code,
          config?.signal,
          scriptToolInvoker,
        );
        await notify();
        return { result, logs };
      },
      {
        name: 'runScript',
        description: RUN_SCRIPT_TOOL_DESCRIPTION,
        schema: z.object({ code: z.string() }),
      },
    ),
  ];
};

export const createWebCottageTools = (options: {
  /** 当前会话生效的搜索来源 */
  searchSource: SearchSource;
  /** 第二层选中的第三方 provider */
  thirdPartyProvider?: ThirdPartySearchProviderId;
  /** 第二层 provider 对应的 API Key */
  thirdPartyApiKey?: string;
  /** 第三层 Cottage Service 首选搜索引擎 */
  cottageServiceEngine?: CottageServiceSearchEngine;
  /** 已连接的 Cottage Service 客户端 */
  cottageService?: CottageServiceClient;
  /** 启用的路由能力（search / fetch） */
  cottageServiceCapabilities?: string[];
}): CottageTool[] => {
  const { searchSource, thirdPartyProvider, thirdPartyApiKey } = options;
  const cottageService = options.cottageService;
  const cottageServiceEngine = options.cottageServiceEngine;
  const serviceCaps = options.cottageServiceCapabilities;
  const useLocalFetch =
    !!cottageService && (!serviceCaps || serviceCaps.includes('fetch'));

  const tools: CottageTool[] = [];

  // 第一层「原生搜索」由模型自行联网，不注册 webSearch 工具。
  if (searchSource === 'thirdParty') {
    tools.push(
      cottageTool(
        async ({ query }) => {
          if (!thirdPartyProvider) {
            throw new Error('未选择第三方搜索来源，请在设置中配置');
          }
          const content = await runThirdPartySearch(
            thirdPartyProvider,
            query,
            thirdPartyApiKey ?? '',
          );
          return {
            query: query.trim(),
            content,
            via: `thirdParty:${thirdPartyProvider}`,
          };
        },
        {
          name: 'webSearch',
          description:
            '在互联网上搜索信息，返回摘要与链接。经预置的第三方搜索 API 执行。',
          schema: z.object({ query: z.string() }),
        },
      ),
    );
  } else if (searchSource === 'cottageService') {
    tools.push(
      cottageTool(
        async ({ query }) => {
          if (!cottageService) {
            throw new Error('Cottage Service 未连接');
          }
          const res = await cottageService.search(query, {
            engine: cottageServiceEngine,
          });
          const content = formatCottageServiceSearch(res);
          return {
            query: query.trim(),
            content,
            via: `cottage-service:${res.engine || cottageServiceEngine || 'auto'}`,
          };
        },
        {
          name: 'webSearch',
          description:
            '在互联网上搜索信息，返回摘要与链接。经本地 Cottage Service 模拟浏览器抓取搜索引擎（更稳定、可跨域）。',
          schema: z.object({ query: z.string() }),
        },
      ),
    );
  }

  tools.push(
    cottageTool(
      async ({ url }) => {
        if (useLocalFetch) {
          try {
            const res = await cottageService!.fetchPage(url);
            return {
              url: res.url,
              content: res.content,
              via: 'cottage-service',
              status: res.status,
            };
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            // 回退到浏览器内抓取
            try {
              const fallback = await fetchWebPageContent(url);
              return { ...fallback, via: 'fallback', warning: detail };
            } catch (e) {
              throw new Error(
                `Cottage Service 抓取失败（${detail}），浏览器回退也失败：${
                  e instanceof Error ? e.message : String(e)
                }`,
              );
            }
          }
        }
        const fallback = await fetchWebPageContent(url);
        return { ...fallback, via: 'browser' };
      },
      {
        name: 'fetchWebPage',
        description:
          '抓取并解析指定 URL 的网页正文。若已连接并勾选本地 agent 的 fetch 能力，则经其模拟浏览器跨域抓取（无跨域限制）；否则在浏览器内 fetch。',
        schema: z.object({ url: z.string() }),
      },
    ),
  );

  return tools;
};

const formatCottageServiceSearch = (
  res: CottageServiceSearchResponse,
): string => {
  const parts: string[] = [];
  if (res.mode === 'headless') {
    parts.push('（经 Cottage Service 无头浏览器抓取）');
  } else if (res.mode === 'http') {
    parts.push('（经 Cottage Service HTTP 模拟抓取）');
  }
  if (res.note?.trim()) parts.push(res.note.trim());
  for (const item of res.results) {
    parts.push(
      `- ${item.title ?? '(无标题)'}\n  ${item.url ?? ''}\n  ${item.snippet ?? ''}`,
    );
  }
  return parts.join('\n\n') || '未找到结果';
};

const taskCanvasPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('table'),
    title: z.string().optional(),
    columns: z.array(z.string()).min(1),
    rows: z.array(z.array(z.string())),
  }),
  z.object({
    kind: z.literal('todo-list'),
    title: z.string().optional(),
    items: z
      .array(
        z.object({
          id: z.string().optional(),
          text: z.string(),
          done: z.boolean().optional(),
        }),
      )
      .min(1),
  }),
  z.object({
    kind: z.literal('markdown'),
    title: z.string().optional(),
    content: z.string(),
  }),
]);

export const createTaskCottageTools = (
  taskId: string,
  signals?: TaskToolSignals,
  options?: {
    child?: boolean;
    onDispatchSubtask?: DispatchSubtaskFn;
  },
): CottageTool[] => {
  if (options?.child) {
    return [
      cottageTool(
        async ({ summary }) => {
          const text = summary?.trim() || '子任务已完成';
          signals?.onSubtaskComplete?.(text);
          return { ok: true, summary: text };
        },
        {
          name: 'subtaskComplete',
          description: '声明子任务完成并提交摘要（子任务专用）。',
          schema: z.object({ summary: z.string() }),
        },
      ),
      cottageTool(
        async ({ reason }) => {
          const text = reason?.trim() || '未知原因';
          await appendTaskEvent(taskId, {
            type: 'failed',
            at: Date.now(),
            detail: { reason: text, source: 'subtaskFail' },
          });
          signals?.onFail?.(text);
          return { ok: true, reason: text };
        },
        {
          name: 'taskFail',
          description: '声明子任务无法完成。',
          schema: z.object({ reason: z.string() }),
        },
      ),
    ];
  }

  const tools: CottageTool[] = [
  cottageTool(
    async ({ steps }) => {
      const parsed = parseSteps(steps);
      const plan: TaskPlan = { steps: parsed, updatedAt: Date.now() };
      await saveTaskPlan(taskId, plan);
      await appendTaskEvent(taskId, {
        type: 'plan',
        at: plan.updatedAt,
        detail: {
          stepCount: parsed.length,
          steps: parsed.map((step) => ({
            title: step.title,
            status: step.status,
          })),
        },
      });
      return { ok: true, stepCount: parsed.length };
    },
    {
      name: 'taskSetPlan',
      description: '更新任务执行计划。',
      schema: z.object({
        steps: z.array(
          z.object({
            id: z.string().optional(),
            title: z.string(),
            status: z.enum(['pending', 'doing', 'done']).optional(),
          }),
        ),
      }),
    },
  ),
  cottageTool(
    async ({ paths, summary }) => {
      const manifest: TaskManifest = {
        paths: parseManifestPaths(paths),
        summary,
        updatedAt: Date.now(),
      };
      await saveTaskManifest(taskId, manifest);
      await appendTaskEvent(taskId, {
        type: 'complete_signal',
        at: manifest.updatedAt,
        detail: {
          pathCount: manifest.paths.length,
          summary,
        },
      });
      signals?.onComplete?.();
      return { ok: true, pathCount: manifest.paths.length };
    },
    {
      name: 'taskComplete',
      description: '声明任务完成并提交交付清单。',
      schema: z.object({
        paths: z.array(
          z.union([
            z.string(),
            z.object({
              path: z.string(),
              description: z.string().optional(),
            }),
          ]),
        ),
        summary: z.string().optional(),
      }),
    },
  ),
  cottageTool(
    async ({ summary, canvas }) => {
      const deliverable: TaskDeliverableCanvas = {
        summary: summary?.trim() || undefined,
        canvas,
        updatedAt: Date.now(),
      };
      await saveTaskCanvas(taskId, deliverable);
      await appendTaskEvent(taskId, {
        type: 'deliverable_canvas',
        at: deliverable.updatedAt,
        detail: {
          kind: canvas.kind,
          title: 'title' in canvas ? canvas.title : undefined,
          summary: deliverable.summary,
        },
      });
      return { ok: true, kind: canvas.kind };
    },
    {
      name: 'submitDeliverableCanvas',
      description:
        '提交结构化 canvas 交付物（表格 / 待办清单 / Markdown 摘要）。不替代 taskComplete；可与文件清单一并使用。',
      schema: z.object({
        summary: z.string().optional(),
        canvas: taskCanvasPayloadSchema,
      }),
    },
  ),
  cottageTool(
    async ({ reason }) => {
      const text = reason?.trim() || '未知原因';
      await appendTaskEvent(taskId, {
        type: 'failed',
        at: Date.now(),
        detail: { reason: text, source: 'taskFail' },
      });
      signals?.onFail?.(text);
      return { ok: true, reason: text };
    },
    {
      name: 'taskFail',
      description: '声明任务无法完成。',
      schema: z.object({ reason: z.string() }),
    },
  ),
  cottageTool(
    async ({ summary, remaining, nextSteps }) => {
      const handoff: TaskHandoff = {
        summary: summary.trim(),
        remaining: remaining.map((item) => item.trim()).filter(Boolean),
        nextSteps: nextSteps.map((item) => item.trim()).filter(Boolean),
        at: Date.now(),
      };
      if (!handoff.summary) {
        throw new Error('summary 必填');
      }

      const state = await loadTaskState(taskId);
      if (!state) throw new Error('任务不存在');
      await saveTaskState(taskId, {
        ...state,
        handoff,
        updatedAt: handoff.at,
      });
      await appendTaskEvent(taskId, {
        type: 'handoff',
        at: handoff.at,
        detail: {
          summary: handoff.summary,
          remainingCount: handoff.remaining.length,
          nextStepCount: handoff.nextSteps.length,
        },
      });
      signals?.onHandoff?.(handoff);
      return {
        ok: true,
        remainingCount: handoff.remaining.length,
        nextStepCount: handoff.nextSteps.length,
      };
    },
    {
      name: 'taskHandoff',
      description:
        '提交结构化任务交接（达到最大轮次时使用）。与 taskComplete/taskFail 互斥。',
      schema: z.object({
        summary: z.string(),
        remaining: z.array(z.string()),
        nextSteps: z.array(z.string()),
      }),
    },
  ),
  ];

  if (options?.onDispatchSubtask) {
    const dispatch = options.onDispatchSubtask;
    tools.push(
      cottageTool(
        async ({ goal, background, subtaskId }) => {
          return dispatch(goal, { background, subtaskId });
        },
        {
          name: 'dispatchSubtask',
          description:
            '派生子任务执行独立子目标。background=false 前台等待；background=true 后台执行并自动回投主会话。子任务不能嵌套。',
          schema: z.object({
            goal: z.string(),
            background: z.boolean().optional(),
            subtaskId: z.string().optional(),
          }),
        },
      ),
    );
  }

  return tools;
};

export { jsonResult };
