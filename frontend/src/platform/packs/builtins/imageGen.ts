import { createImageGenCottageTools } from '../../../agent/imageGenCottageTools';
import { IMAGE_GEN_TOOL_NAMES } from '../../../agent/toolCatalog';
import type { BuiltinCapabilityPack } from './types';

const IMAGE_GEN_PROMPT = `【图片生成能力包已启用】

## 工具速查
- generateImage：文生图。prompt 描述图片内容，生成结果保存到 images/ 并注入对话展示。
- editImage：图生图/编辑。imagePaths 传工作区内已存在的图片路径，按 prompt 修改或变体。

## 使用纪律
- prompt 要具体：写清主体、风格、构图、光线、色调；中英文皆可。
- 生图厂商默认跟随对话预设，也可在「设置 → 图片生成」独立指定（例如用 Claude 聊天、用 OpenAI 画图）。
- 按张计费由生图厂商 Key 承担；一次生成多张（n>1）会先请用户确认，勿擅自放大 n。
- 生成后告知用户保存路径；若当前对话模型不支持看图（vision），图片仍会保存，只是你看不到内容。
- 工具返回 error/hint 字段时，向用户转述提示（通常是模型或 Key 未配置），不要反复重试。
- 工具返回 warning/fallbackUrls 时，说明图片下载受限并把原始链接给用户（链接通常短期有效）；可建议用户连接 Cottage Service。
- editImage 的参考图必须是工作区内已存在的文件；不确定路径时先用 listFiles 查看。`;

export const IMAGE_GEN_PACK: BuiltinCapabilityPack = {
  id: 'builtin.imagegen',
  name: '图片生成',
  domain: 'media',
  description:
    '文生图与图生图/编辑，调用生图厂商模型（OpenAI / OpenRouter / 智谱 / 通义万相 / 硅基流动 / 豆包等），结果保存到工作区并在对话中展示。',
  groupId: 'imagegen',
  toolNames: IMAGE_GEN_TOOL_NAMES,
  capabilityIds: ['imagegen.text2image', 'imagegen.image2image'],
  promptOverlay: IMAGE_GEN_PROMPT,
  riskLevel: 'external',
  intentKeywords: [
    '画一张',
    '画个',
    '生成图片',
    '生成一张',
    '文生图',
    '图生图',
    '生图',
    '插画',
    '海报',
    'logo',
    '壁纸',
    '配图',
    '头像',
    'draw an image',
    'generate image',
    'text-to-image',
  ],
  createTools: (ctx) =>
    createImageGenCottageTools({
      onMutate: ctx?.onWorkspaceMutate,
    }),
};
