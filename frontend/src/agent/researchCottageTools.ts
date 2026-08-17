import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import { workspace } from '../workspace/FileSystemWorkspace';

export interface ResearchToolsOptions {
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

const slugify = (title: string): string => {
  const s = title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .trim();
  return s || 'research';
};

/**
 * 深度研究能力包工具：将带引用来源的研究报告落盘为 Markdown。
 * 研究过程本身由 prompt overlay 编排联网/PDF/图表工具完成，本工具只负责
 * 「可核对交付」——把结论与来源固化成文件。
 */
export const createResearchCottageTools = (
  options: ResearchToolsOptions = {},
): CottageTool[] => {
  return [
    cottageTool(
      async ({ title, summary, content, sources, outputPath }) => {
        const refs = sources ?? [];
        const refSection = refs.length
          ? refs
              .map((s, i) => `${i + 1}. [${s.title || s.url}](${s.url})${s.note ? ` — ${s.note}` : ''}`)
              .join('\n')
          : '_（本次研究未记录外部来源）_';

        const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const lines: string[] = [`# ${title}`, ''];
        if (summary) lines.push(`> ${summary}`, '');
        lines.push(content.trim(), '');
        lines.push('---', '', '## 参考来源', '', refSection, '');
        lines.push('---', '', `_生成时间：${now}_`, '');

        const out = outputPath ?? `reports/${slugify(title)}-${timestamp()}.md`;
        await workspace.writeFile(out, lines.join('\n'));
        await options.onMutate?.();
        return {
          outputPath: out,
          title,
          sourceCount: refs.length,
          note: '研究报告已保存到工作区，可在预览中查看。请向用户汇报关键结论与文件路径。',
        };
      },
      {
        name: 'saveResearchReport',
        description:
          '将深度研究结果落盘为带引用来源的 Markdown 报告。content 为报告正文（结论/证据/分析，可用小标题分节），sources 为参考来源列表。用于「可核对交付」。',
        schema: z.object({
          title: z.string().describe('报告标题（应为结论性陈述，而非话题词）'),
          summary: z.string().optional().describe('一句话核心结论（置于文首引用块）'),
          content: z.string().describe('报告正文 Markdown（建议含背景/发现/证据/结论/建议）'),
          sources: z
            .array(
              z.object({
                title: z.string().optional().describe('来源标题'),
                url: z.string().describe('来源链接'),
                note: z.string().optional().describe('该来源支撑了哪个论点'),
              }),
            )
            .optional()
            .describe('参考来源列表'),
          outputPath: z.string().optional().describe('输出路径，默认 reports/<标题>-<时间戳>.md'),
        }),
      },
    ),
  ];
};
