import { createChartCottageTools } from '../../../agent/chartCottageTools';
import { CHART_TOOL_NAMES } from '../../../agent/toolCatalog';
import type { BuiltinCapabilityPack } from './types';

const CHART_PROMPT = `【图表可视化能力包已启用】

## 工具速查
- renderMermaid：生成 Mermaid 示意图（流程图 / 时序图 / 类图 / 状态图 / 思维导图等），输出自包含 HTML 到 charts/。code 为 Mermaid 源码。
- renderChart：生成 ECharts 数据图表（柱状 / 折线 / 饼图 / 散点等），option 为完整 ECharts 配置（xAxis/yAxis/series 等），输出自包含 HTML。

## 选型建议
- 表达结构 / 流程 / 关系 / 时序 → 用 renderMermaid。
- 表达数值对比 / 趋势 / 占比 → 用 renderChart（数据来自表格或用户给定）。

## 使用纪律
- Mermaid 源码要语法正确：节点 ID 不含空格与特殊符号，文本用引号包裹；生成前可先在心里走一遍语法。
- ECharts option 必须是合法 JSON：series 至少一项，类目轴需配 data；饼图用 name/value 数据。
- 输出为自包含 HTML（经 CDN 加载 mermaid/echarts 运行时），生成后告知用户路径并在预览中打开；离线环境可能无法加载 CDN。
- 配色克制、信息清晰：一张图表达一个核心结论，避免堆砌过多系列。`;

export const CHART_PACK: BuiltinCapabilityPack = {
  id: 'builtin.chart',
  name: '图表可视化',
  domain: 'chart',
  description:
    '生成 Mermaid 示意图（流程图/架构图/时序图/思维导图）与 ECharts 数据图表，输出可预览的自包含 HTML。',
  groupId: 'chart',
  toolNames: CHART_TOOL_NAMES,
  capabilityIds: ['chart.diagram', 'chart.datachart'],
  promptOverlay: CHART_PROMPT,
  riskLevel: 'write',
  intentKeywords: [
    '图表',
    '流程图',
    '架构图',
    '时序图',
    '思维导图',
    'mermaid',
    'echarts',
    '可视化',
    '柱状图',
    '折线图',
    '饼图',
    '关系图',
    '示意图',
    'chart',
    'diagram',
  ],
  createTools: (ctx) =>
    createChartCottageTools({
      onMutate: ctx?.onWorkspaceMutate,
    }),
};
