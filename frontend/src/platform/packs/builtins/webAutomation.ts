import { createBrowserCottageTools } from '../../../agent/browserCottageTools';
import { WEB_AUTOMATION_TOOL_NAMES } from '../../../agent/toolCatalog';
import type { BuiltinCapabilityPack } from './types';

const WEB_AUTOMATION_PROMPT = `【网页自动化能力包已启用】

本包经 Cottage Service 的无头浏览器执行网页截图、结构化提取与会话式交互。未连接服务或服务不具备 browser 能力时，本包工具不会挂载；请引导用户在「设置 → Cottage Service」连接。

## 工具速查
- screenshotPage：对 URL 整页/区域截图，保存到工作区 screenshots/，返回路径（无需会话）。
- extractPage：结构化提取网页正文、标题、元数据、标题层级与链接（类 Jina Reader，支持 SPA）。
- 会话式交互（多步操作同一页面）：
  1. openBrowserPage(url) → 得到 sessionId
  2. clickElement / typeText / selectOption / browserNavigate 逐步操作（selector 用 CSS，定位不到时 click/type 可用 text 按可见文本兜底）
  3. captureBrowserPage 截图核对当前状态
  4. closeBrowserPage 关闭会话释放资源

## 使用纪律
- 只需读取内容时优先 extractPage，不要滥用交互会话。
- 交互操作（点击/输入/选择/跳转）属外部站点操作，涉及风险时先 submitExecutionPlan 说明要做什么。
- 每次 openBrowserPage 后务必在结束时 closeBrowserPage；会话空闲 5 分钟会自动关闭。
- 选择器优先用稳定的 CSS（id / name / data-* 属性），避免脆弱的层级选择器；定位失败再用 text 兜底。
- 填表/点击后若页面跳转或动态加载，可 captureBrowserPage 或 extractPage 确认结果再继续。`;

export const WEB_AUTOMATION_PACK: BuiltinCapabilityPack = {
  id: 'builtin.web-automation',
  name: '网页自动化',
  domain: 'integration',
  description:
    '网页截图、结构化提取与会话式交互（点击/输入/选择/跳转），经 Cottage Service 无头浏览器执行，适合抓取动态页面与多步自动化。',
  groupId: 'web',
  toolNames: WEB_AUTOMATION_TOOL_NAMES,
  capabilityIds: [
    'integration.web.screenshot',
    'integration.web.extract',
    'integration.web.interact',
  ],
  promptOverlay: WEB_AUTOMATION_PROMPT,
  riskLevel: 'external',
  requiresCottageServiceCapabilities: ['screenshot', 'extract', 'browser'],
  intentKeywords: [
    '截图',
    '网页截图',
    'screenshot',
    '抓取',
    '提取',
    'extract',
    '点击',
    'click',
    '填表',
    '填写',
    '输入',
    '自动化',
    '浏览器',
    'browser',
    '爬取',
    '表单',
    '登录',
  ],
  createTools: (ctx) =>
    createBrowserCottageTools({
      cottageService: ctx?.cottageService,
      cottageServiceCapabilities: ctx?.cottageServiceCapabilities,
      onMutate: ctx?.onWorkspaceMutate,
    }),
};
