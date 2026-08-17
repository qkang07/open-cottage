import type { PDFDocument, PDFFont } from 'pdf-lib';

const CJK_FONT_PATH = 'fonts/NotoSansSC-Regular.otf';

let cjkFontBytes: Uint8Array | null = null;
let cjkFontLoadError: Error | null = null;

const hasNonLatin = (text: string): boolean => /[^\u0000-\u00ff]/.test(text);

/** 解析 Vite base，得到 public 下字体 URL */
const resolveFontUrl = (): string => {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
  return `${base}${CJK_FONT_PATH}`;
};

/** 加载并缓存 CJK 字体字节；失败时抛出可读错误 */
export const loadCjkFontBytes = async (): Promise<Uint8Array> => {
  if (cjkFontBytes) return cjkFontBytes;
  if (cjkFontLoadError) throw cjkFontLoadError;
  try {
    const res = await fetch(resolveFontUrl());
    if (!res.ok) {
      throw new Error(
        `无法加载中文字体（HTTP ${res.status}）：${CJK_FONT_PATH}。请运行 pnpm fonts:pdf 下载字体到 frontend/public/fonts/。`,
      );
    }
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) {
      throw new Error(
        `中文字体文件为空：${CJK_FONT_PATH}。请运行 pnpm fonts:pdf 重新下载。`,
      );
    }
    cjkFontBytes = new Uint8Array(buf);
    return cjkFontBytes;
  } catch (err) {
    const e =
      err instanceof Error
        ? err
        : new Error(`加载中文字体失败：${String(err)}`);
    if (!e.message.includes('fonts:pdf')) {
      cjkFontLoadError = new Error(
        `${e.message}。若本地缺失字体，请运行：pnpm fonts:pdf`,
      );
    } else {
      cjkFontLoadError = e;
    }
    throw cjkFontLoadError;
  }
};

/**
 * 为 PDFDocument 选择并嵌入正文字体。
 * 含非 Latin（如中文）时嵌入 Noto Sans SC；否则用 Helvetica。
 */
export const embedPdfTextFont = async (
  doc: PDFDocument,
  textSamples: string[],
): Promise<{ font: PDFFont; usedCjk: boolean }> => {
  const { StandardFonts } = await import('pdf-lib');
  const needCjk = textSamples.some((t) => t && hasNonLatin(t));
  if (!needCjk) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    return { font, usedCjk: false };
  }
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  doc.registerFontkit(fontkit);
  const bytes = await loadCjkFontBytes();
  const font = await doc.embedFont(bytes, { subset: true });
  return { font, usedCjk: true };
};

export { hasNonLatin };
