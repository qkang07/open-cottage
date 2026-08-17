import { createResearchCottageTools } from '../../../agent/researchCottageTools';
import { DEEP_RESEARCH_TOOL_NAMES } from '../../../agent/toolCatalog';
import type { BuiltinCapabilityPack } from './types';

const DEEP_RESEARCH_PROMPT = `【深度研究能力包已启用】

你正在执行一项需要多轮检索、取证与交叉验证的研究任务。目标不是「快速给个答案」，而是产出一份**可核对、带来源**的结构化报告。

## 研究方法论（默认遵循）
1. 拆解问题：把用户的研究目标拆成 3–6 个可独立检索的子问题，先列出来再逐个攻克。
2. 多轮检索：对每个子问题用 webSearch 检索，挑选权威/一手来源用 fetchWebPage（或 extractPage）读取正文取证；不要只看搜索摘要就下结论。
3. 交叉验证：关键事实至少有两个独立来源相互印证；发现矛盾时明确指出并说明取舍依据。
4. 取证留痕：记录每条结论对应的来源 URL，最终全部列入报告「参考来源」。
5. 结构化产出：报告含 背景 / 核心发现 / 证据与分析 / 结论与建议；标题写成结论句而非话题词。
6. 落盘交付：用 saveResearchReport 把报告（正文 + 来源列表）保存为 Markdown，再向用户汇报关键结论与文件路径。

## 工具协同（按已启用能力自适应）
- 联网：webSearch 搜索、fetchWebPage 抓取正文（基础能力，始终可用）。
- 若启用网页自动化：extractPage 提取动态页面正文，screenshotPage 留存页面证据。
- 若启用 PDF 处理：readPdf 读取报告/论文/白皮书类 PDF 来源。
- 若启用图表可视化：用 renderMermaid 画关系/流程图，renderChart 画数据对比图，嵌入或附在报告旁。
- 涉及大量数据计算时可用数据分析（Python）能力。

## 使用纪律
- 区分「事实」与「推断」：推断要标注，并说明依据。
- 来源不足或相互矛盾时，如实说明不确定性，不要编造来源或数据。
- 大改/多步外部检索前可先 submitExecutionPlan 列出子问题与预算。
- 报告必须落盘（saveResearchReport），不能只在对话里口述结论。`;

export const DEEP_RESEARCH_PACK: BuiltinCapabilityPack = {
  id: 'builtin.deep-research',
  name: '深度研究',
  domain: 'integration',
  description:
    '多轮检索取证、交叉验证，产出带引用来源的结构化研究报告并落盘；复用联网/PDF/图表/数据分析能力。',
  groupId: 'research',
  toolNames: DEEP_RESEARCH_TOOL_NAMES,
  capabilityIds: ['integration.deep.research'],
  promptOverlay: DEEP_RESEARCH_PROMPT,
  riskLevel: 'write',
  intentKeywords: [
    '调研',
    '研究',
    '报告',
    '综述',
    '深度研究',
    'deep research',
    '竞品分析',
    '行业分析',
    '市场调查',
    '背景调查',
    '文献',
    'research',
  ],
  createTools: (ctx) =>
    createResearchCottageTools({
      onMutate: ctx?.onWorkspaceMutate,
    }),
};
