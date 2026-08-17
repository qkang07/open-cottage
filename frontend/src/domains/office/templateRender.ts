import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { workspace } from '../../workspace/FileSystemWorkspace';
import type { TemplateVariables } from './templateTypes';

// 与旧实现保持一致的 {{变量}} 定界符（docxtemplater 默认为单花括号）
const DELIMITERS = { start: '{{', end: '}}' };

// 对齐旧行为：{{ name }} 允许两侧空格；键按字面量整体查找（含 a.b 这类带点的键）
// 键名限定为字母数字与 _.-，不合法的 {{...}} 原样保留为文档字面内容
const VAR_KEY_RE = /^[a-zA-Z0-9_.-]+$/;

const parser = (tag: string) => {
  const key = tag.trim();
  if (!VAR_KEY_RE.test(key)) {
    return { get: () => `{{${tag}}}` };
  }
  return {
    get: (scope: unknown) =>
      key === '.' ? scope : (scope as TemplateVariables | undefined)?.[key],
  };
};

interface RenderSubError extends Error {
  properties?: { explanation?: string };
}

interface RenderError extends Error {
  properties?: { explanation?: string; errors?: RenderSubError[] };
}

const describeRenderError = (error: unknown): Error => {
  const err = error as RenderError;
  const subs = err?.properties?.errors;
  const details = (subs?.length ? subs : [err])
    .map((e) => e?.properties?.explanation ?? e?.message)
    .filter(Boolean);
  return new Error(`模板渲染失败：${details.join('；') || String(error)}`);
};

export const renderZipTemplate = async (
  templatePath: string,
  outputPath: string,
  variables: TemplateVariables,
  countRe: RegExp,
): Promise<{ outputPath: string; replacedFiles: number }> => {
  const bytes = await workspace.readFileBytes(templatePath);
  let doc: Docxtemplater;
  try {
    // docxtemplater 会自动合并被 Word 拆散的占位符 run，并做 XML 转义
    doc = new Docxtemplater(new PizZip(bytes), {
      delimiters: DELIMITERS,
      paragraphLoop: true,
      linebreaks: true,
      parser,
      // 缺失变量渲染为空串（docxtemplater 默认输出 "undefined"）
      nullGetter: () => '',
    });
    doc.render(variables);
  } catch (error) {
    throw describeRenderError(error);
  }

  const out = doc
    .getZip()
    .generate({ type: 'uint8array', compression: 'DEFLATE' }) as Uint8Array;
  await workspace.writeFileBytes(outputPath, out);

  const replacedFiles = Object.keys(doc.getZip().files).filter((name) =>
    countRe.test(name),
  ).length;
  return { outputPath, replacedFiles };
};
