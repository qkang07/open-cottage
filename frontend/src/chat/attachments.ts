import { getCottageConfig } from '../config/store';

/**
 * 聊天附件（目前仅图片，后续可扩展 audio / file 等类型）
 */
export interface ChatAttachment {
  id: string;
  type: 'image';
  filename: string;
  mimeType: string;
  /** base64 data URL 或工作区相对路径 */
  data: string;
  /** 已落盘的工作区路径（hydrate 把 data 换成 data URL 后保留，供模型/工具按路径操作原图） */
  sourcePath?: string;
  width?: number;
  height?: number;
}

/** 生成唯一附件 ID */
export const newAttachmentId = (): string => crypto.randomUUID();

/**
 * 将 File 对象转换为 ChatAttachment（含降采样）
 */
export const fileToAttachment = async (file: File): Promise<ChatAttachment> => {
  const config = getCottageConfig();
  const maxDimension = config.vision?.maxDimensionPx ?? 2048;
  const maxBytes = config.vision?.maxImageBytes ?? 4_000_000;

  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);

  let finalDataUrl = dataUrl;
  // 降采样（超出尺寸或字节限制时 canvas 缩放）
  if (img.width > maxDimension || img.height > maxDimension || dataUrl.length > maxBytes) {
    finalDataUrl = resizeImage(img, maxDimension, file.type);
  }

  return {
    id: newAttachmentId(),
    type: 'image',
    filename: file.name,
    mimeType: file.type || 'image/png',
    data: finalDataUrl,
    width: img.width,
    height: img.height,
  };
};

/**
 * 从粘贴事件中提取图片文件列表
 */
export const extractImagesFromClipboard = (
  clipboardData: DataTransfer,
): File[] => {
  const files: File[] = [];
  for (let i = 0; i < clipboardData.files.length; i++) {
    const file = clipboardData.files[i];
    if (file && file.type.startsWith('image/')) {
      files.push(file);
    }
  }
  return files;
};

/**
 * 从拖拽事件中提取图片文件列表
 */
export const extractImagesFromDrop = (dataTransfer: DataTransfer): File[] => {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    if (file && file.type.startsWith('image/')) {
      files.push(file);
    }
  }
  return files;
};

/**
 * 检测当前是否应该启用图片附件功能
 */
export const isVisionEnabled = (): boolean => {
  const config = getCottageConfig();
  return config.vision?.enabled ?? true;
};

// ─── 内部工具函数 ─────────────────────────────────────────────────────────────

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });

const resizeImage = (
  img: HTMLImageElement,
  maxDimension: number,
  mimeType: string,
): string => {
  let { width, height } = img;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');
  ctx.drawImage(img, 0, 0, width, height);

  // 使用原始 MIME（降级到 PNG）
  const outputType = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const quality = outputType === 'image/jpeg' ? 0.85 : undefined;
  return canvas.toDataURL(outputType, quality);
};
