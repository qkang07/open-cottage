import type { ImageGenAdapter, ImageGenAdapterKind } from './types';
import { openAiImagesAdapter } from './openAiImagesAdapter';
import { dashscopeImageAdapter } from './dashscopeImageAdapter';
import { openRouterImagesAdapter } from './openRouterImagesAdapter';

export * from './types';
export * from './catalog';
export {
  resolveImageGenContext,
  resolveImageGenDefaultSize,
  resolveImageGenProviderId,
  type ImageGenPurpose,
} from './resolveImageGen';
export { clampImageCount } from './shared';

export const getImageGenAdapter = (kind: ImageGenAdapterKind): ImageGenAdapter => {
  if (kind === 'dashscope-native') return dashscopeImageAdapter;
  if (kind === 'openrouter-images') return openRouterImagesAdapter;
  return openAiImagesAdapter;
};
