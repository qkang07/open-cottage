import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import { workspace } from '../workspace/FileSystemWorkspace';

export interface ChartToolsOptions {
  /** 写入工作区后的回调（刷新文件树等） */
  onMutate?: () => void | Promise<void>;
}

const timestamp = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
const ECHARTS_CDN = 'https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js';

const buildMermaidHtml = (code: string, theme: string): string => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Mermaid 示意图</title>
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  #diagram { display: flex; justify-content: center; padding: 32px; }
  .mermaid { font-family: 'Noto Sans SC', 'Microsoft YaHei', sans-serif; }
</style>
</head>
<body>
<div id="diagram">
  <pre class="mermaid">${escapeHtml(code)}</pre>
</div>
<script src="${MERMAID_CDN}"></script>
<script>
  mermaid.initialize({ startOnLoad: true, theme: ${JSON.stringify(theme)}, securityLevel: 'loose' });
</script>
</body>
</html>`;

const buildEchartsHtml = (
  optionJson: string,
  titleText: string | undefined,
): string => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(titleText ?? 'ECharts 图表')}</title>
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  #chart { width: 100vw; height: 100vh; }
</style>
</head>
<body>
<div id="chart"></div>
<script src="${ECHARTS_CDN}"></script>
<script>
  var chart = echarts.init(document.getElementById('chart'));
  var option = ${optionJson};
  chart.setOption(option);
  window.addEventListener('resize', function () { chart.resize(); });
</script>
</body>
</html>`;

/** 尝试用本地 mermaid 校验语法（失败不阻断，仅返回警告） */
const validateMermaid = async (code: string): Promise<string | undefined> => {
  try {
    const mermaid = (await import('mermaid')).default;
    mermaid.initialize({ startOnLoad: false });
    await mermaid.parse(code);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/**
 * 图表可视化能力包工具：Mermaid 示意图 + ECharts 数据图表。
 * 均输出自包含 HTML（经 CDN 加载运行时），写入工作区供预览。
 */
export const createChartCottageTools = (
  options: ChartToolsOptions = {},
): CottageTool[] => {
  return [
    cottageTool(
      async ({ code, theme, outputPath }) => {
        const mermaidTheme = theme ?? 'default';
        const warning = await validateMermaid(code);
        const html = buildMermaidHtml(code, mermaidTheme);
        const out = outputPath ?? `charts/mermaid-${timestamp()}.html`;
        await workspace.writeFile(out, html);
        await options.onMutate?.();
        return {
          outputPath: out,
          theme: mermaidTheme,
          warning: warning
            ? `Mermaid 语法可能存在问题：${warning}。请在预览中确认渲染结果。`
            : undefined,
          note: '已生成 Mermaid 示意图 HTML，可在预览中打开查看。',
        };
      },
      {
        name: 'renderMermaid',
        description:
          '生成 Mermaid 示意图（流程图 flowchart / 时序图 sequenceDiagram / 类图 / 状态图 / 思维导图 mindmap 等），输出自包含 HTML 并保存到工作区。code 为 Mermaid 源码。',
        schema: z.object({
          code: z.string().describe('Mermaid 源码，如 "flowchart TD\\n  A-->B"'),
          theme: z
            .enum(['default', 'dark', 'forest', 'neutral', 'base'])
            .optional()
            .describe('主题，默认 default'),
          outputPath: z.string().optional().describe('输出 HTML 路径，默认 charts/mermaid-<时间戳>.html'),
        }),
      },
    ),
    cottageTool(
      async ({ option, title, outputPath }) => {
        // option 可能是对象或 JSON 字符串，统一序列化并校验
        let optionJson: string;
        try {
          const obj = typeof option === 'string' ? JSON.parse(option) : option;
          optionJson = JSON.stringify(obj, null, 2);
        } catch (error) {
          throw new Error(
            `option 不是合法的 ECharts 配置 JSON：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        const html = buildEchartsHtml(optionJson, title);
        const out = outputPath ?? `charts/chart-${timestamp()}.html`;
        await workspace.writeFile(out, html);
        await options.onMutate?.();
        return {
          outputPath: out,
          title: title ?? '',
          note: '已生成 ECharts 数据图表 HTML，可在预览中打开查看。',
        };
      },
      {
        name: 'renderChart',
        description:
          '生成 ECharts 数据图表（柱状/折线/饼图/散点等），输出自包含 HTML 并保存到工作区。option 为完整的 ECharts 配置（含 xAxis/yAxis/series 等）。',
        schema: z.object({
          option: z
            .union([z.string(), z.record(z.unknown())])
            .describe('ECharts 配置对象或其 JSON 字符串'),
          title: z.string().optional().describe('图表标题（用于页面 title）'),
          outputPath: z.string().optional().describe('输出 HTML 路径，默认 charts/chart-<时间戳>.html'),
        }),
      },
    ),
  ];
};
