import { renderZipTemplate } from './templateRender';
import type { TemplateVariables } from './templateTypes';

// 用于统计渲染涉及的幻灯片/备注 XML 数量
const PPTX_XML_RE = /^ppt\/(slides\/slide\d+|notesSlides\/notesSlide\d+)\.xml$/i;

export const renderPptxTemplate = async (
  templatePath: string,
  outputPath: string,
  variables: TemplateVariables,
): Promise<{ outputPath: string; replacedFiles: number }> =>
  renderZipTemplate(templatePath, outputPath, variables, PPTX_XML_RE);
