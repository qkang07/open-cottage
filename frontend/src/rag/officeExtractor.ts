/**
 * RAG Office 文本抽取：通过 Content Model 提取结构化文本
 */
import { extractOfficeContentRef } from '../content/extractors/office';

/** 支持的 Office 扩展名 */
const OFFICE_EXTENSIONS = /\.(docx|xlsx|xls|csv|pptx)$/i;

export function isOfficeFile(path: string): boolean {
  return OFFICE_EXTENSIONS.test(path);
}

/**
 * 从 Office 文件中提取纯文本
 * @returns 纯文本内容，如果不支持则返回 null
 */
export async function extractOfficeText(path: string): Promise<string | null> {
  try {
    const { extractedText } = await extractOfficeContentRef(path);
    return extractedText || null;
  } catch {
    return null;
  }
}
