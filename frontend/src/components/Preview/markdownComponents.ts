import hljs from 'highlight.js';

/**
 * 单行代码高亮，供 CodeHighlight.vue 的按行高亮预览使用。
 * Markdown 渲染已迁移至 md-editor-v3（见 MarkdownPreview.vue）。
 */
export const highlightCode = (code: string, language: string): string => {
  const lang = language.toLowerCase();
  if (lang && hljs.getLanguage(lang)) {
    return hljs.highlight(code, { language: lang }).value;
  }
  return hljs.highlightAuto(code).value;
};
