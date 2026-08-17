import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import { workspace } from '../workspace/FileSystemWorkspace';
import type { CottageServiceClient } from '../cottageService/client';

export interface BrowserToolsOptions {
  /** 已连接的 Cottage Service 客户端 */
  cottageService?: CottageServiceClient;
  /** 启用的路由能力（需包含 browser / screenshot / extract） */
  cottageServiceCapabilities?: string[];
  /** 写入工作区后的回调（刷新文件树等） */
  onMutate?: () => void | Promise<void>;
}

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const timestamp = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

const NOT_CONNECTED =
  '网页自动化需要 Cottage Service 提供无头浏览器能力。请在「设置 → Cottage Service」连接本地服务并确认其具备 browser 能力后重试。';

/**
 * 网页自动化能力包工具：截图 / 结构化提取 / 会话式交互。
 * 全部经 Cottage Service 的无头浏览器执行；未连接时返回友好提示而非崩溃。
 */
export const createBrowserCottageTools = (
  options: BrowserToolsOptions = {},
): CottageTool[] => {
  const client = options.cottageService;
  const requireClient = (): CottageServiceClient => {
    if (!client) throw new Error(NOT_CONNECTED);
    return client;
  };

  return [
    cottageTool(
      async ({ url, fullPage, format }) => {
        const c = requireClient();
        const res = await c.screenshot(url, {
          fullPage: fullPage ?? true,
          format: format ?? 'png',
        });
        const path = `screenshots/page-${timestamp()}.${res.format}`;
        await workspace.writeFileBytes(path, base64ToBytes(res.image));
        await options.onMutate?.();
        return {
          savedTo: path,
          cottageImages: [path],
          url: res.url,
          title: res.title,
          format: res.format,
          note: '截图已保存到工作区，可在文件树/预览中查看。',
        };
      },
      {
        name: 'screenshotPage',
        description:
          '对指定 URL 网页截图并保存到工作区 screenshots/ 目录，返回文件路径。经 Cottage Service 无头浏览器渲染（支持 SPA）。',
        schema: z.object({
          url: z.string().describe('要截图的网页 URL'),
          fullPage: z.boolean().optional().describe('是否整页截图，默认 true'),
          format: z.enum(['png', 'jpeg', 'webp']).optional().describe('图片格式，默认 png'),
        }),
      },
    ),
    cottageTool(
      async ({ url }) => {
        const c = requireClient();
        const res = await c.extract(url);
        return {
          url: res.url,
          title: res.title,
          description: res.description ?? '',
          publishDate: res.publishDate ?? '',
          wordCount: res.wordCount ?? 0,
          headings: res.headings ?? [],
          links: (res.links ?? []).slice(0, 30),
          content: res.content,
        };
      },
      {
        name: 'extractPage',
        description:
          '结构化提取网页正文、标题、元数据、标题层级与链接（类似 Jina Reader）。经 Cottage Service 无头浏览器渲染后提取，适合 SPA / 动态页面。',
        schema: z.object({
          url: z.string().describe('要提取的网页 URL'),
        }),
      },
    ),
    cottageTool(
      async ({ url, viewportWidth, viewportHeight }) => {
        const c = requireClient();
        const session = await c.browserOpen(url, { viewportWidth, viewportHeight });
        return {
          sessionId: session.sessionId,
          url: session.url,
          title: session.title,
          note: '会话已打开。后续用 clickElement / typeText / selectOption / browserNavigate 操作同一页面，完成后用 closeBrowserPage 关闭。会话空闲 5 分钟自动关闭。',
        };
      },
      {
        name: 'openBrowserPage',
        description:
          '打开一个交互式浏览器会话并导航到 URL，返回 sessionId。用于需要多步操作（点击/填表/跳转）的自动化场景。',
        schema: z.object({
          url: z.string().describe('要打开的网页 URL'),
          viewportWidth: z.number().optional().describe('视口宽度，默认 1280'),
          viewportHeight: z.number().optional().describe('视口高度，默认 800'),
        }),
      },
    ),
    cottageTool(
      async ({ sessionId, selector, text }) => {
        const c = requireClient();
        return c.browserClick(sessionId, selector ?? '', text);
      },
      {
        name: 'clickElement',
        description:
          '在浏览器会话内点击元素。优先用 CSS 选择器 selector；定位不到时可用 text 按可见文本兜底。',
        schema: z.object({
          sessionId: z.string().describe('openBrowserPage 返回的会话 id'),
          selector: z.string().optional().describe('CSS 选择器，如 "#login-btn"'),
          text: z.string().optional().describe('按按钮/链接的可见文本兜底定位'),
        }),
      },
    ),
    cottageTool(
      async ({ sessionId, selector, value, text }) => {
        const c = requireClient();
        return c.browserType(sessionId, selector ?? '', value, text);
      },
      {
        name: 'typeText',
        description: '在浏览器会话内向输入框填写文本（先清空再输入）。selector 用 CSS 选择器，text 可兜底。',
        schema: z.object({
          sessionId: z.string().describe('会话 id'),
          selector: z.string().optional().describe('输入框 CSS 选择器，如 "input[name=q]"'),
          value: z.string().describe('要输入的文本'),
          text: z.string().optional().describe('按标签文本兜底定位'),
        }),
      },
    ),
    cottageTool(
      async ({ sessionId, selector, value }) => {
        const c = requireClient();
        return c.browserSelect(sessionId, selector, value);
      },
      {
        name: 'selectOption',
        description: '在浏览器会话内选择下拉框选项（按 value 或可见文本）。',
        schema: z.object({
          sessionId: z.string().describe('会话 id'),
          selector: z.string().describe('select 元素的 CSS 选择器'),
          value: z.string().describe('选项的 value 或可见文本'),
        }),
      },
    ),
    cottageTool(
      async ({ sessionId, url }) => {
        const c = requireClient();
        return c.browserNavigate(sessionId, url);
      },
      {
        name: 'browserNavigate',
        description: '在已有浏览器会话内跳转到新 URL。',
        schema: z.object({
          sessionId: z.string().describe('会话 id'),
          url: z.string().describe('目标 URL'),
        }),
      },
    ),
    cottageTool(
      async ({ sessionId, fullPage, format }) => {
        const c = requireClient();
        const res = await c.browserScreenshot(sessionId, {
          fullPage: fullPage ?? false,
          format: format ?? 'png',
        });
        const path = `screenshots/session-${timestamp()}.${res.format}`;
        await workspace.writeFileBytes(path, base64ToBytes(res.image));
        await options.onMutate?.();
        return {
          savedTo: path,
          cottageImages: [path],
          url: res.url,
          title: res.title,
          format: res.format,
          note: '当前会话页面截图已保存到工作区。',
        };
      },
      {
        name: 'captureBrowserPage',
        description: '对当前浏览器会话页面截图并保存到工作区，返回文件路径。用于操作后核对页面状态。',
        schema: z.object({
          sessionId: z.string().describe('会话 id'),
          fullPage: z.boolean().optional().describe('是否整页截图，默认仅当前视口'),
          format: z.enum(['png', 'jpeg', 'webp']).optional().describe('图片格式，默认 png'),
        }),
      },
    ),
    cottageTool(
      async ({ sessionId }) => {
        const c = requireClient();
        await c.browserClose(sessionId);
        return { ok: true, note: `会话 ${sessionId} 已关闭。` };
      },
      {
        name: 'closeBrowserPage',
        description: '关闭浏览器会话，释放资源。完成多步操作后应调用。',
        schema: z.object({
          sessionId: z.string().describe('要关闭的会话 id'),
        }),
      },
    ),
  ];
};
