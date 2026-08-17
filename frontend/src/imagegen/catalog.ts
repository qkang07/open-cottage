/**
 * 各厂商内置生图模型清单。
 * 模型 ID 以厂商文档为准，可能随版本更迭失效；用户可在
 * 「设置 → 图片生成」用 modelOverrides 覆盖，无需改代码。
 */

import type { LlmProviderId } from '../config/llmProviders';
import type { ImageGenAdapterKind } from './types';

export interface ImageGenModelEntry {
  id: string;
  label: string;
  adapter: ImageGenAdapterKind;
  /** 是否可作为图生图/编辑模型 */
  supportsEdit: boolean;
  /** 仅用于编辑，不参与文生图默认模型选择 */
  editOnly?: boolean;
  /** 模型不接受 response_format 参数（恒返回 b64_json） */
  omitResponseFormat?: boolean;
  /** 是否支持 negative_prompt（缺省 false） */
  supportsNegativePrompt?: boolean;
  /** 是否接受 size 参数（缺省 true） */
  supportsSize?: boolean;
  /** 单次最大张数（缺省 4） */
  maxN?: number;
  /** 建议尺寸（设置下拉与提示；不做强校验） */
  sizes?: readonly string[];
  hint?: string;
}

const IMAGE_GEN_MODEL_CATALOG: Partial<
  Record<LlmProviderId, readonly ImageGenModelEntry[]>
> = {
  openai: [
    {
      id: 'gpt-image-1',
      label: 'GPT Image 1',
      adapter: 'openai-images',
      supportsEdit: true,
      omitResponseFormat: true,
      supportsNegativePrompt: false,
      maxN: 4,
      sizes: ['1024x1024', '1536x1024', '1024x1536'],
    },
    {
      id: 'dall-e-3',
      label: 'DALL·E 3',
      adapter: 'openai-images',
      supportsEdit: false,
      supportsNegativePrompt: false,
      maxN: 1,
      sizes: ['1024x1024', '1792x1024', '1024x1792'],
    },
    {
      id: 'dall-e-2',
      label: 'DALL·E 2',
      adapter: 'openai-images',
      supportsEdit: true,
      supportsNegativePrompt: false,
      maxN: 4,
      sizes: ['256x256', '512x512', '1024x1024'],
    },
  ],
  zhipu: [
    {
      id: 'cogview-4',
      label: 'CogView-4',
      adapter: 'openai-images',
      supportsEdit: false,
      supportsNegativePrompt: false,
      maxN: 4,
      sizes: ['1024x1024', '1440x720', '720x1440'],
    },
    {
      id: 'cogview-3-flash',
      label: 'CogView-3 Flash（免费）',
      adapter: 'openai-images',
      supportsEdit: false,
      supportsNegativePrompt: false,
      maxN: 1,
    },
  ],
  dashscope: [
    {
      id: 'wan2.2-t2i-flash',
      label: '通义万相 2.2 极速版',
      adapter: 'dashscope-native',
      supportsEdit: false,
      supportsNegativePrompt: true,
      maxN: 4,
      sizes: ['1024x1024', '1440x810', '810x1440'],
    },
    {
      id: 'wan2.2-t2i-plus',
      label: '通义万相 2.2 专业版',
      adapter: 'dashscope-native',
      supportsEdit: false,
      supportsNegativePrompt: true,
      maxN: 4,
    },
    {
      id: 'wanx2.1-t2i-turbo',
      label: '通义万相 2.1 极速版',
      adapter: 'dashscope-native',
      supportsEdit: false,
      supportsNegativePrompt: true,
      maxN: 4,
    },
    {
      id: 'wanx2.1-imageedit',
      label: '通义万相图像编辑',
      adapter: 'dashscope-native',
      supportsEdit: true,
      editOnly: true,
      supportsNegativePrompt: false,
      maxN: 4,
      hint: '仅用于图生图/编辑',
    },
  ],
  doubao: [
    {
      id: 'doubao-seedream-4-0-250828',
      label: 'Seedream 4.0',
      adapter: 'openai-images',
      supportsEdit: false,
      supportsNegativePrompt: false,
      maxN: 4,
      hint: '火山方舟需开通模型；ID 以方舟控制台为准',
    },
    {
      id: 'doubao-seedream-3-0-t2i-250415',
      label: 'Seedream 3.0 文生图',
      adapter: 'openai-images',
      supportsEdit: false,
      supportsNegativePrompt: false,
      maxN: 4,
      hint: '火山方舟需开通模型；ID 以方舟控制台为准',
    },
  ],
  siliconflow: [
    {
      id: 'Kwai-Kolors/Kolors',
      label: 'Kolors（快手可图）',
      adapter: 'openai-images',
      supportsEdit: false,
      supportsNegativePrompt: true,
      maxN: 4,
      sizes: ['1024x1024', '960x1280', '1280x960'],
    },
    {
      id: 'black-forest-labs/FLUX.1-schnell',
      label: 'FLUX.1 Schnell',
      adapter: 'openai-images',
      supportsEdit: false,
      supportsNegativePrompt: false,
      maxN: 4,
    },
    {
      id: 'black-forest-labs/FLUX.1-dev',
      label: 'FLUX.1 Dev',
      adapter: 'openai-images',
      supportsEdit: false,
      supportsNegativePrompt: false,
      maxN: 4,
    },
  ],
  // OpenRouter 统一 Image API（POST /images）；模型 ID 与能力以 OpenRouter
  // 模型页（output_modalities=image 过滤）为准，可用 modelOverrides 覆盖
  openrouter: [
    {
      id: 'openai/gpt-image-1',
      label: 'GPT Image 1',
      adapter: 'openrouter-images',
      supportsEdit: true,
      supportsNegativePrompt: false,
      maxN: 4,
      sizes: ['1024x1024', '1536x1024', '1024x1536'],
      hint: '经 OpenRouter 统一 Image API 调用',
    },
    {
      id: 'google/gemini-2.5-flash-image',
      label: 'Gemini 2.5 Flash Image',
      adapter: 'openrouter-images',
      supportsEdit: true,
      supportsNegativePrompt: false,
      maxN: 1,
      sizes: ['1024x1024', '1536x1024', '1024x1536'],
      hint: '经 OpenRouter 统一 Image API 调用',
    },
    {
      id: 'bytedance-seed/seedream-4.5',
      label: 'Seedream 4.5',
      adapter: 'openrouter-images',
      supportsEdit: true,
      supportsNegativePrompt: false,
      maxN: 4,
      hint: '经 OpenRouter 统一 Image API 调用',
    },
    {
      id: 'black-forest-labs/flux.2-pro',
      label: 'FLUX.2 Pro',
      adapter: 'openrouter-images',
      supportsEdit: false,
      supportsNegativePrompt: false,
      maxN: 1,
      hint: '经 OpenRouter 统一 Image API 调用；仅文生图',
    },
  ],
};

/** OpenRouter 图片模型目录的最小响应结构。目录是公开接口，不需要暴露用户 API Key。 */
interface OpenRouterImageModelsResponse {
  data?: Array<{
    id?: string;
    name?: string;
    description?: string;
    architecture?: { input_modalities?: string[]; output_modalities?: string[] };
    supported_parameters?: Record<
      string,
      { type?: string; values?: unknown[]; max?: number }
    >;
  }>;
}

let openRouterImageModels: readonly ImageGenModelEntry[] | null = null;
let openRouterImageModelsPromise: Promise<readonly ImageGenModelEntry[]> | null = null;

/**
 * 从 OpenRouter 官方 Image Models API 获取全部当前可用的生图模型。
 * 将能力信息写入条目，避免给不支持的模型发送 size 或 input_references。
 */
export const loadOpenRouterImageModels = async (
  force = false,
): Promise<readonly ImageGenModelEntry[]> => {
  if (openRouterImageModels && !force) return openRouterImageModels;
  if (openRouterImageModelsPromise && !force) return openRouterImageModelsPromise;

  const request = fetch('https://openrouter.ai/api/v1/images/models')
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`OpenRouter 图片模型目录 HTTP ${response.status}`);
      }
      const payload = (await response.json()) as OpenRouterImageModelsResponse;
      const models = (payload.data ?? [])
        .filter(
          (model) =>
            Boolean(model.id) &&
            (model.architecture?.output_modalities?.includes('image') ?? true),
        )
        .map<ImageGenModelEntry>((model) => {
          const parameters = model.supported_parameters ?? {};
          const n = parameters.n;
          const maxN =
            n?.type === 'range' && typeof n.max === 'number'
              ? Math.max(1, Math.floor(n.max))
              : 1;
          const size = parameters.size;
          return {
            id: model.id!,
            label: model.name?.trim() || model.id!,
            adapter: 'openrouter-images',
            // input_references 是 Image API 真实接受的编辑能力；仅有 image 输入不代表能编辑。
            supportsEdit: Boolean(parameters.input_references),
            supportsNegativePrompt: Boolean(parameters.negative_prompt),
            // 只有目录明确支持 size 时才传像素尺寸，避免把 1024x1024 发给只支持 aspect_ratio 的模型。
            supportsSize: Boolean(size),
            maxN,
            hint: model.description?.trim(),
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
      if (!models.length) throw new Error('OpenRouter 图片模型目录为空');
      openRouterImageModels = models;
      return models;
    })
    .finally(() => {
      openRouterImageModelsPromise = null;
    });
  openRouterImageModelsPromise = request;
  return request;
};

/** 内置清单中有生图模型的厂商（设置「独立生图厂商」下拉用） */
export const IMAGE_GEN_PROVIDER_IDS: readonly LlmProviderId[] = [
  'openai',
  'openrouter',
  'zhipu',
  'dashscope',
  'doubao',
  'siliconflow',
];

/** 某厂商的内置生图模型清单（未收录的厂商返回空数组） */
export const imageGenModelsForProvider = (
  providerId: LlmProviderId,
): readonly ImageGenModelEntry[] =>
  providerId === 'openrouter' && openRouterImageModels
    ? openRouterImageModels
    : (IMAGE_GEN_MODEL_CATALOG[providerId] ?? []);

/** 某厂商的默认文生图模型（清单首个非仅编辑模型） */
export const defaultImageGenModel = (
  providerId: LlmProviderId,
): ImageGenModelEntry | undefined =>
  imageGenModelsForProvider(providerId).find((m) => !m.editOnly);

/** 按模型 ID 查清单条目 */
export const findImageGenModelEntry = (
  providerId: LlmProviderId,
  modelId: string,
): ImageGenModelEntry | undefined =>
  imageGenModelsForProvider(providerId).find((m) => m.id === modelId);

/** 某厂商用于图生图/编辑的默认模型 */
export const defaultImageEditModel = (
  providerId: LlmProviderId,
): ImageGenModelEntry | undefined =>
  imageGenModelsForProvider(providerId).find((m) => m.supportsEdit);

/** 清单外模型（用户覆盖）按厂商推断适配器类别 */
export const fallbackAdapterForProvider = (
  providerId: LlmProviderId,
): ImageGenAdapterKind =>
  providerId === 'dashscope'
    ? 'dashscope-native'
    : providerId === 'openrouter'
      ? 'openrouter-images'
      : 'openai-images';

/** 统一尺寸展示为 1024x1024（通义清单可能写 1024*1024） */
export const normalizeImageSizeLabel = (size: string): string =>
  size.replace(/[×*]/g, 'x');
