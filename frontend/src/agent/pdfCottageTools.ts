import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import { workspace } from '../workspace/FileSystemWorkspace';
import type { CottageServiceClient } from '../cottageService/client';
import { embedPdfTextFont } from './pdfFonts';

export interface PdfToolsOptions {
  /** 写入工作区后的回调（刷新文件树等） */
  onMutate?: () => void | Promise<void>;
  /** 已连接的 Cottage Service（createPdfFromHtml 需要） */
  cottageService?: CottageServiceClient;
}

/** pdfjs worker 地址（Vite 以 ?url 输出独立资源，避免主线程阻塞） */
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let pdfjsReady = false;

/** 懒加载 pdfjs-dist 并配置 worker */
const loadPdfJs = async () => {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjsReady) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    pdfjsReady = true;
  }
  return pdfjs;
};

/** 懒加载 pdf-lib */
const loadPdfLib = () => import('pdf-lib');

const ensurePdfPath = (path: string): string => {
  if (!/\.pdf$/i.test(path)) throw new Error(`需要 PDF 文件，但收到：${path}`);
  return path;
};

const readPdfBytes = async (path: string): Promise<Uint8Array> => {
  ensurePdfPath(path);
  const bytes = await workspace.readFileBytes(path);
  if (!bytes || bytes.length === 0) {
    throw new Error(`无法读取 PDF 文件（不存在或为空）：${path}`);
  }
  return bytes;
};

const timestamp = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

const MAX_EXTRACT_CHARS = 100_000;

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const HTML_PDF_NOT_CONNECTED =
  'createPdfFromHtml 需要 Cottage Service 的无头浏览器 PDF 能力。请在「设置 → Cottage Service」连接本地服务（需具备 pdf 能力）后重试；简单中文文本可用 createPdf（无需本地服务）。';

/**
 * PDF 处理能力包工具：读取 / 合并 / 拆分 / 创建。
 * 解析用 pdfjs-dist，编辑用 pdf-lib，均按需懒加载。
 */
export const createPdfCottageTools = (
  options: PdfToolsOptions = {},
): CottageTool[] => {
  const tools: CottageTool[] = [
    cottageTool(
      async ({ path, maxPages }) => {
        const bytes = await readPdfBytes(path);
        const pdfjs = await loadPdfJs();
        const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
        try {
          const meta = await doc.getMetadata().catch(() => null);
          const info = (meta?.info ?? {}) as Record<string, unknown>;
          const pageCount = doc.numPages;
          const limit = Math.min(maxPages ?? pageCount, pageCount);
          const pages: { page: number; text: string }[] = [];
          let totalChars = 0;
          let truncated = false;
          for (let i = 1; i <= limit; i++) {
            const page = await doc.getPage(i);
            const content = await page.getTextContent();
            const text = content.items
              .map((it) => ('str' in it ? (it as { str: string }).str : ''))
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim();
            pages.push({ page: i, text });
            totalChars += text.length;
            if (totalChars >= MAX_EXTRACT_CHARS) {
              truncated = true;
              break;
            }
          }
          return {
            path,
            pageCount,
            extractedPages: pages.length,
            metadata: {
              title: info.Title ?? '',
              author: info.Author ?? '',
              subject: info.Subject ?? '',
              creator: info.Creator ?? '',
              producer: info.Producer ?? '',
            },
            truncated: truncated || pageCount > pages.length,
            pages,
          };
        } finally {
          await doc.destroy().catch(() => {});
        }
      },
      {
        name: 'readPdf',
        description:
          '读取 PDF 文件，提取每页文本、页数与元数据（标题/作者等）。不要用 readFile 读 PDF（会得到乱码）。',
        schema: z.object({
          path: z.string().describe('工作区内的 PDF 文件路径'),
          maxPages: z.number().optional().describe('最多提取多少页，默认全部'),
        }),
      },
    ),
    cottageTool(
      async ({ paths, outputPath }) => {
        if (paths.length < 2) throw new Error('合并至少需要 2 个 PDF 文件');
        const { PDFDocument } = await loadPdfLib();
        const merged = await PDFDocument.create();
        for (const p of paths) {
          const bytes = await readPdfBytes(p);
          const src = await PDFDocument.load(bytes);
          const copied = await merged.copyPages(src, src.getPageIndices());
          for (const page of copied) merged.addPage(page);
        }
        const out = outputPath ?? `merged-${timestamp()}.pdf`;
        ensurePdfPath(out);
        const outBytes = await merged.save();
        await workspace.writeFileBytes(out, outBytes);
        await options.onMutate?.();
        return {
          outputPath: out,
          pageCount: merged.getPageCount(),
          mergedFrom: paths,
          note: '已合并并保存到工作区。',
        };
      },
      {
        name: 'mergePdfs',
        description: '按顺序合并多个 PDF 为一个新文件，保存到工作区。',
        schema: z.object({
          paths: z.array(z.string()).min(2).describe('要合并的 PDF 路径列表（按顺序）'),
          outputPath: z.string().optional().describe('输出路径，默认 merged-<时间戳>.pdf'),
        }),
      },
    ),
    cottageTool(
      async ({ path, ranges, outputPrefix }) => {
        const bytes = await readPdfBytes(path);
        const { PDFDocument } = await loadPdfLib();
        const src = await PDFDocument.load(bytes);
        const total = src.getPageCount();
        const prefix = outputPrefix ?? path.replace(/\.pdf$/i, '');

        // 解析页码区间（1-based，含端点）；缺省为整篇
        const parsed: { from: number; to: number }[] = (
          ranges?.length ? ranges : [{ from: 1, to: total }]
        ).map((r) => {
          const from = Math.max(1, r.from ?? 1);
          const to = Math.min(total, r.to ?? r.from ?? total);
          if (from > to) throw new Error(`无效页码区间：${from}-${to}（共 ${total} 页）`);
          return { from, to };
        });

        const outputs: { outputPath: string; pages: string; pageCount: number }[] = [];
        for (let i = 0; i < parsed.length; i++) {
          const { from, to } = parsed[i];
          const indices: number[] = [];
          for (let p = from; p <= to; p++) indices.push(p - 1);
          const doc = await PDFDocument.create();
          const copied = await doc.copyPages(src, indices);
          for (const page of copied) doc.addPage(page);
          const outPath =
            parsed.length === 1
              ? `${prefix}-${from}-${to}.pdf`
              : `${prefix}-part${i + 1}-${from}-${to}.pdf`;
          const outBytes = await doc.save();
          await workspace.writeFileBytes(outPath, outBytes);
          outputs.push({ outputPath: outPath, pages: `${from}-${to}`, pageCount: indices.length });
        }
        await options.onMutate?.();
        return {
          source: path,
          sourcePageCount: total,
          outputs,
          note: '已按区间拆分并保存到工作区。',
        };
      },
      {
        name: 'splitPdf',
        description:
          '按页码区间拆分 PDF 为一个或多个新文件。ranges 缺省时输出整篇副本；多个区间各输出一个文件。',
        schema: z.object({
          path: z.string().describe('要拆分的 PDF 路径'),
          ranges: z
            .array(z.object({ from: z.number(), to: z.number().optional() }))
            .optional()
            .describe('页码区间列表（1-based，含端点），如 [{from:1,to:3},{from:4,to:6}]'),
          outputPrefix: z.string().optional().describe('输出文件名前缀，默认取源文件名'),
        }),
      },
    ),
    cottageTool(
      async ({ title, lines, outputPath, fontSize }) => {
        const { PDFDocument, rgb } = await loadPdfLib();
        const doc = await PDFDocument.create();
        const samples = [title ?? '', ...(lines ?? [])];
        const { font, usedCjk } = await embedPdfTextFont(doc, samples);
        const size = fontSize ?? 12;
        const titleSize = size + 6;
        const margin = 50;
        const leading = size * 1.5;
        const pageWidth = 595.28; // A4
        const pageHeight = 841.89;
        const maxWidth = pageWidth - margin * 2;

        const wrap = (text: string, fs: number): string[] => {
          const result: string[] = [];
          let cur = '';
          for (const ch of text) {
            const test = cur + ch;
            if (font.widthOfTextAtSize(test, fs) > maxWidth && cur) {
              result.push(cur);
              cur = ch;
            } else {
              cur = test;
            }
          }
          if (cur) result.push(cur);
          return result.length ? result : [''];
        };

        let page = doc.addPage([pageWidth, pageHeight]);
        let y = pageHeight - margin;

        const ensureSpace = (needed: number) => {
          if (y - needed < margin) {
            page = doc.addPage([pageWidth, pageHeight]);
            y = pageHeight - margin;
          }
        };

        if (title) {
          for (const line of wrap(title, titleSize)) {
            ensureSpace(titleSize * 1.5);
            page.drawText(line, { x: margin, y, size: titleSize, font, color: rgb(0.1, 0.1, 0.1) });
            y -= titleSize * 1.5;
          }
          y -= size; // 标题与正文间距
        }

        for (const raw of lines ?? []) {
          for (const line of wrap(raw, size)) {
            ensureSpace(leading);
            page.drawText(line, { x: margin, y, size, font, color: rgb(0.15, 0.15, 0.15) });
            y -= leading;
          }
        }

        const out = outputPath ?? `document-${timestamp()}.pdf`;
        ensurePdfPath(out);
        const outBytes = await doc.save();
        await workspace.writeFileBytes(out, outBytes);
        await options.onMutate?.();
        return {
          outputPath: out,
          pageCount: doc.getPageCount(),
          font: usedCjk ? 'NotoSansSC' : 'Helvetica',
          note: '已从文本创建 PDF 并保存到工作区。',
        };
      },
      {
        name: 'createPdf',
        description:
          '从标题与文本行创建简单 PDF（A4，自动换行分页）。支持中文（嵌入 Noto Sans SC）。富版式/复杂 CSS 请用 createPdfFromHtml。',
        schema: z.object({
          title: z.string().optional().describe('文档标题'),
          lines: z.array(z.string()).describe('正文文本行'),
          outputPath: z.string().optional().describe('输出路径，默认 document-<时间戳>.pdf'),
          fontSize: z.number().optional().describe('正文字号，默认 12'),
        }),
      },
    ),
  ];

  tools.push(
    cottageTool(
      async ({ html, url, outputPath, landscape }) => {
        const client = options.cottageService;
        if (!client) throw new Error(HTML_PDF_NOT_CONNECTED);
        if (!html?.trim() && !url?.trim()) {
          throw new Error('须提供 html 或 url 之一');
        }
        const res = await client.printPdf({
          html: html?.trim() || undefined,
          url: url?.trim() || undefined,
          landscape: landscape ?? false,
        });
        const out = outputPath ?? `document-${timestamp()}.pdf`;
        ensurePdfPath(out);
        await workspace.writeFileBytes(out, base64ToBytes(res.pdf));
        await options.onMutate?.();
        return {
          outputPath: out,
          title: res.title,
          sourceUrl: res.url,
          size: res.size,
          note: '已通过 Cottage Service 将 HTML/URL 打印为 PDF。',
        };
      },
      {
        name: 'createPdfFromHtml',
        description:
          '将 HTML 字符串或网页 URL 经 Cottage Service 无头浏览器打印为 PDF（支持中文与 CSS 版式）。需本地服务在线。简单纯文本请用 createPdf。',
        schema: z.object({
          html: z.string().optional().describe('完整 HTML 文档（含 style 更佳）'),
          url: z.string().optional().describe('要打印的网页 URL（与 html 二选一）'),
          outputPath: z.string().optional().describe('输出路径，默认 document-<时间戳>.pdf'),
          landscape: z.boolean().optional().describe('横向纸张，默认 false'),
        }),
      },
    ),
  );

  return tools;
};
