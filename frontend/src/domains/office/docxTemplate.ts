import { renderZipTemplate } from './templateRender';
import type { TemplateVariables } from './templateTypes';

// 用于统计渲染涉及的正文/页眉/页脚 XML 数量
const DOCX_XML_RE = /^word\/(document|header\d+|footer\d+)\.xml$/i;

export const renderDocxTemplate = async (
  templatePath: string,
  outputPath: string,
  variables: TemplateVariables,
): Promise<{ outputPath: string; replacedFiles: number }> =>
  renderZipTemplate(templatePath, outputPath, variables, DOCX_XML_RE);
