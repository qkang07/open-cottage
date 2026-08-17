import { createPdfCottageTools } from '../../../agent/pdfCottageTools';
import { PDF_TOOL_NAMES } from '../../../agent/toolCatalog';
import type { BuiltinCapabilityPack } from './types';

const PDF_PROMPT = `【PDF 处理能力包已启用】

## 工具速查
- readPdf：提取 PDF 每页文本、页数与元数据。切记不要用 readFile 读 PDF（会得到乱码），一律用 readPdf。
- mergePdfs：按顺序合并多个 PDF 为一个新文件。
- splitPdf：按页码区间（1-based 含端点）拆分为一个或多个 PDF。
- createPdf：从标题 + 文本行创建简单 A4 PDF（自动换行分页）；**支持中文**（嵌入 Noto Sans SC）。
- createPdfFromHtml：将 HTML 或 URL 经 Cottage Service 无头浏览器打印为 PDF（完整 CSS/中文版式）；需本地服务在线。

## 使用纪律
- 读取优先 readPdf；大文件可用 maxPages 限制提取页数，避免上下文膨胀。
- 简单纯文本（含中文）用 createPdf；需要标题样式、表格、配色等富版式时用 createPdfFromHtml（先写好自包含 HTML）。
- createPdfFromHtml 依赖 Cottage Service；未连接时改用 createPdf 或 writeWord。
- 合并/拆分/创建均为写操作，输出路径默认带时间戳。
- 处理完成后告知用户输出文件路径，便于在文件树/预览中查看。`;

export const PDF_PACK: BuiltinCapabilityPack = {
  id: 'builtin.pdf',
  name: 'PDF 处理',
  domain: 'office',
  description:
    '读取 PDF 文本与元数据，合并 / 拆分 / 从文本或 HTML 创建 PDF（解析用 pdfjs，编辑用 pdf-lib；HTML 打印经 Cottage Service）。',
  groupId: 'pdf',
  toolNames: PDF_TOOL_NAMES,
  capabilityIds: ['office.pdf.read', 'office.pdf.write'],
  promptOverlay: PDF_PROMPT,
  riskLevel: 'write',
  intentKeywords: [
    'pdf',
    '合并',
    '拆分',
    '提取',
    'pdf转',
    '转pdf',
    '页数',
    '文档',
    'merge',
    'split',
  ],
  createTools: (ctx) =>
    createPdfCottageTools({
      onMutate: ctx?.onWorkspaceMutate,
      cottageService: ctx?.cottageService,
    }),
};
