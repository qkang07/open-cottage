import { getCottageConfig } from '../../config/store';
import { renderDocxTemplate } from './docxTemplate';
import { renderPptxTemplate } from './pptxTemplate';
import type { OfficeTemplateJob } from './templateTypes';

const extOf = (path: string): string => path.split('.').pop()?.toLowerCase() ?? '';

const countPlaceholders = (variables: Record<string, unknown>): number =>
  Object.keys(variables).length;

export const renderOfficeTemplate = async (
  job: OfficeTemplateJob,
): Promise<{ outputPath: string; replacedFiles: number; kind: 'docx' | 'pptx' }> => {
  const config = getCottageConfig();
  const max = config.office?.template?.maxReplacements ?? 10000;
  if (countPlaceholders(job.variables) > max) {
    throw new Error(`模板变量数量超过限制：${max}`);
  }

  const ext = extOf(job.templatePath);
  if (ext === 'docx') {
    const result = await renderDocxTemplate(
      job.templatePath,
      job.outputPath,
      job.variables,
    );
    return { ...result, kind: 'docx' };
  }
  if (ext === 'pptx') {
    const result = await renderPptxTemplate(
      job.templatePath,
      job.outputPath,
      job.variables,
    );
    return { ...result, kind: 'pptx' };
  }
  throw new Error('模板渲染仅支持 docx/pptx');
};
