export type TemplateVariables = Record<string, string | number | boolean | null>;

export interface OfficeTemplateJob {
  templatePath: string;
  outputPath: string;
  variables: TemplateVariables;
}

export interface BatchTemplateJob {
  templatePath: string;
  outputDir: string;
  items: Array<{
    filename: string;
    variables: TemplateVariables;
  }>;
}
