import { cottageTool, type CottageTool } from '@/agent/runtime/tool';
import type { CottageToolConfig } from '@/agent/runtime/tool';
import { z } from 'zod';
import { workspace } from '../workspace/FileSystemWorkspace';
import { normalizePath } from '../workspace/pathUtils';
import { mimeFromPath } from '../chat/attachmentStorage';
import {
  getImageGenAdapter,
  resolveImageGenContext,
  resolveImageGenDefaultSize,
  type ImageGenPurpose,
  type ImageGenProgressFn,
  type ImageGenResult,
  type ResolvedImageGenContext,
} from '../imagegen';
import { clampImageCount } from '../imagegen/shared';

export interface ImageGenToolsOptions {
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

const extFromMime = (mime: string): string => {
  const ext = mime.split('/')[1]?.toLowerCase();
  return ext === 'jpeg' ? 'jpg' : (ext ?? 'png');
};

const CONFIG_HINT =
  '可在「设置 → 图片生成」中选择独立生图厂商、模型与默认尺寸；API Key 复用对应厂商配置。';

/** 配置类失败不抛错：返回结构化提示，模型据此转告用户而非重试 */
const softFail = (error: unknown): { error: string; hint: string } => ({
  error: error instanceof Error ? error.message : String(error),
  hint: CONFIG_HINT,
});

const resolveContextOrNull = async (
  purpose: ImageGenPurpose,
): Promise<ResolvedImageGenContext | { error: string; hint: string }> => {
  try {
    return await resolveImageGenContext(purpose);
  } catch (error) {
    return softFail(error);
  }
};

const isSoftFail = (
  value: ResolvedImageGenContext | { error: string; hint: string },
): value is { error: string; hint: string } => 'error' in value;

interface SavedResult {
  savedTo: string[];
  cottageImages: string[];
  provider: string;
  model: string;
  revisedPrompt?: string;
  warning?: string;
  fallbackUrls?: string[];
  note: string;
}

async function persistResult(
  ctx: ResolvedImageGenContext,
  result: ImageGenResult,
  outputDir: string | undefined,
  filePrefix: string,
  onMutate?: () => void | Promise<void>,
): Promise<SavedResult> {
  const dir = normalizePath(outputDir?.trim() || 'images');
  const stamp = timestamp();
  const savedTo: string[] = [];
  for (let i = 0; i < result.images.length; i++) {
    const image = result.images[i];
    const path = `${dir}/${filePrefix}-${stamp}-${i + 1}.${extFromMime(image.mime)}`;
    await workspace.writeFileBytes(path, image.bytes);
    savedTo.push(path);
  }
  if (savedTo.length) {
    await onMutate?.();
  }
  const warnings = result.warnings ?? [];
  return {
    savedTo,
    cottageImages: savedTo,
    provider: ctx.providerId,
    model: ctx.model,
    ...(result.revisedPrompt ? { revisedPrompt: result.revisedPrompt } : {}),
    ...(warnings.length ? { warning: warnings.join('\n') } : {}),
    ...(result.fallbackUrls?.length ? { fallbackUrls: result.fallbackUrls } : {}),
    note: savedTo.length
      ? `图片已保存到工作区（${savedTo.join('、')}），可在文件树/预览中查看。`
      : '未获得可保存的图片，请查看 warning 与 fallbackUrls。',
  };
}

const progressFromConfig = (config?: CottageToolConfig): ImageGenProgressFn | undefined => {
  const fn = config?.configurable?.onImageGenProgress;
  return typeof fn === 'function' ? (fn as ImageGenProgressFn) : undefined;
};

/** 图片生成能力包工具：文生图 + 图生图/编辑 */
export const createImageGenCottageTools = (
  options: ImageGenToolsOptions = {},
): CottageTool[] => [
  cottageTool(
    async ({ prompt, size, n, negativePrompt, outputDir }, config) => {
      const ctx = await resolveContextOrNull('generate');
      if (isSoftFail(ctx)) return ctx;
      const effectiveN = clampImageCount(n, ctx.maxN);
      const effectiveSize =
        ctx.supportsSize
          ? size?.trim() || resolveImageGenDefaultSize()
          : undefined;
      const result = await getImageGenAdapter(ctx.adapter).generate(
        ctx,
        {
          prompt,
          n: effectiveN,
          size: effectiveSize,
          negativePrompt: ctx.supportsNegativePrompt
            ? negativePrompt
            : undefined,
        },
        config?.signal,
        progressFromConfig(config),
      );
      return persistResult(ctx, result, outputDir, 'gen', options.onMutate);
    },
    {
      name: 'generateImage',
      description:
        '根据文字描述生成图片（文生图），保存到工作区并注入对话展示。使用设置中的生图厂商（默认同对话预设）的生图模型与 API Key。生成多张（n>1）会先请用户确认（按张计费）。',
      schema: z.object({
        prompt: z
          .string()
          .describe('图片描述，尽量具体：主体、风格、构图、光线、色调等'),
        size: z
          .string()
          .optional()
          .describe('尺寸如 "1024x1024"，缺省用设置中的默认尺寸'),
        n: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .describe('生成张数 1-4，默认 1；大于 1 时需用户确认'),
        negativePrompt: z
          .string()
          .optional()
          .describe('反向提示词（不希望出现的内容，仅部分厂商/模型支持）'),
        outputDir: z
          .string()
          .optional()
          .describe('输出目录，默认 images/'),
      }),
    },
  ),
  cottageTool(
    async (
      { prompt, imagePaths, maskPath, size, n, outputDir },
      config,
    ) => {
      const ctx = await resolveContextOrNull('edit');
      if (isSoftFail(ctx)) return ctx;
      if (!ctx.supportsEdit) {
        return softFail(
          new Error(`模型「${ctx.model}」不支持图生图/编辑`),
        );
      }

      const referenceImages: Uint8Array[] = [];
      const referenceMimes: string[] = [];
      const missing: string[] = [];
      for (const raw of imagePaths) {
        const path = normalizePath(raw);
        if ((await workspace.getEntryKind(path)) !== 'file') {
          missing.push(path);
          continue;
        }
        referenceImages.push(await workspace.readFileBytes(path));
        referenceMimes.push(mimeFromPath(path));
      }
      if (missing.length) {
        return {
          error: `以下参考图在工作区中不存在：${missing.join('、')}`,
          hint: '请传入工作区内已存在的图片路径（可先用 listFiles 确认）。',
        };
      }

      let mask: Uint8Array | undefined;
      let maskMime: string | undefined;
      if (maskPath?.trim()) {
        const path = normalizePath(maskPath);
        if ((await workspace.getEntryKind(path)) !== 'file') {
          return {
            error: `蒙版文件不存在：${path}`,
            hint: '请传入工作区内已存在的蒙版图片路径。',
          };
        }
        mask = await workspace.readFileBytes(path);
        maskMime = mimeFromPath(path);
      }

      const effectiveN = clampImageCount(n, ctx.maxN);
      const extraWarnings: string[] = [];
      if (ctx.adapter === 'dashscope-native' && referenceImages.length > 1) {
        extraWarnings.push(
          '通义万相编辑当前仅使用首张参考图，其余参考图已忽略。',
        );
      }

      const result = await getImageGenAdapter(ctx.adapter).edit(
        ctx,
        {
          prompt,
          n: effectiveN,
          size: ctx.supportsSize ? size?.trim() || undefined : undefined,
          referenceImages,
          referenceMimes,
          mask,
          maskMime,
        },
        config?.signal,
        progressFromConfig(config),
      );
      if (extraWarnings.length) {
        result.warnings = [...(result.warnings ?? []), ...extraWarnings];
      }
      return persistResult(ctx, result, outputDir, 'edit', options.onMutate);
    },
    {
      name: 'editImage',
      description:
        '基于工作区已有图片做图生图/编辑（风格转换、内容修改、扩展等），结果保存到工作区并注入对话展示。参考图必须是工作区内已存在的文件。生成多张（n>1）会先请用户确认。',
      schema: z.object({
        prompt: z.string().describe('编辑/生成指令，描述期望的修改效果'),
        imagePaths: z
          .array(z.string())
          .min(1)
          .describe('参考图/待编辑图的工作区相对路径列表'),
        maskPath: z
          .string()
          .optional()
          .describe('蒙版图路径，白色区域为待编辑区（仅部分厂商支持）'),
        size: z.string().optional().describe('输出尺寸如 "1024x1024"'),
        n: z
          .number()
          .int()
          .min(1)
          .max(4)
          .optional()
          .describe('生成张数 1-4，默认 1；大于 1 时需用户确认'),
        outputDir: z
          .string()
          .optional()
          .describe('输出目录，默认 images/'),
      }),
    },
  ),
];
