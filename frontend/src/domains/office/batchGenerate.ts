import { normalizePath } from '../../workspace/pathUtils';
import { renderOfficeTemplate } from './templateEngine';
import type { BatchTemplateJob } from './templateTypes';

export const batchGenerateOfficeDocs = async (job: BatchTemplateJob): Promise<{
  generated: Array<{ outputPath: string; replacedFiles: number; kind: 'docx' | 'pptx' }>;
}> => {
  const generated: Array<{
    outputPath: string;
    replacedFiles: number;
    kind: 'docx' | 'pptx';
  }> = [];
  for (const item of job.items) {
    const outputPath = normalizePath(`${job.outputDir}/${item.filename}`);
    const one = await renderOfficeTemplate({
      templatePath: job.templatePath,
      outputPath,
      variables: item.variables,
    });
    generated.push(one);
  }
  return { generated };
};
