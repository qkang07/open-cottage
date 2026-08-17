import MarkdownIt from 'markdown-it';
import multimdTable from 'markdown-it-multimd-table';
import hljs from 'highlight.js';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
});

md.use(multimdTable);

md.renderer.rules.code_inline = (tokens, idx) => {
  const token = tokens[idx];
  const content = md.utils.escapeHtml(token.content);
  return `<code class="md-inline-code">${content}</code>`;
};

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx];
  const code = token.content;
  const lang = (token.info || '').trim().split(/\s+/)[0] || 'text';
  const highlighted =
    md.options.highlight?.(code, lang, '') ?? md.utils.escapeHtml(code);
  const encoded = encodeURIComponent(code);
  const escapedLang = md.utils.escapeHtml(lang);
  return `<div class="md-code-block-wrap" data-lang="${escapedLang}">
<div class="md-code-block-header"><span class="md-code-block-lang">${escapedLang}</span><button type="button" class="md-copy-btn" data-md-copy="${encoded}" aria-label="复制">复制</button></div>
<pre><code class="hljs language-${escapedLang}">${highlighted}</code></pre>
</div>`;
};

export function renderMarkdown(text: string): string {
  return md.render(text);
}

export type StreamMarkdownBlock = {
  key: string;
  text: string;
  html: string;
  tail: boolean;
};

/**
 * 按空行切段：已完成段 key 稳定，仅尾段随流更新。
 * 避免流式时整段 v-html 替换导致选区丢失。
 */
export function splitStreamingMarkdownBlocks(text: string): StreamMarkdownBlock[] {
  if (!text) return [];
  const parts = text.split(/\n\n/);
  if (parts.length === 1) {
    return [
      {
        key: 'tail-0',
        text,
        html: renderMarkdown(text),
        tail: true,
      },
    ];
  }
  const blocks: StreamMarkdownBlock[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const body = parts[i];
    const segment = `${body}\n\n`;
    blocks.push({
      key: `b-${i}-${simpleHash(body)}`,
      text: segment,
      html: renderMarkdown(segment),
      tail: false,
    });
  }
  const tail = parts[parts.length - 1];
  if (tail.length > 0) {
    blocks.push({
      key: `tail-${parts.length - 1}`,
      text: tail,
      html: renderMarkdown(tail),
      tail: true,
    });
  }
  return blocks;
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function bindMarkdownCopyButtons(root: HTMLElement) {
  const onClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('.md-copy-btn');
    if (!button || !root.contains(button)) return;
    const encoded = button.getAttribute('data-md-copy');
    if (!encoded) return;
    const text = decodeURIComponent(encoded);
    void navigator.clipboard.writeText(text).then(() => {
      const original = button.textContent;
      button.textContent = '已复制';
      button.style.color = 'var(--cottage-success)';
      window.setTimeout(() => {
        button.textContent = original;
        button.style.color = '';
      }, 2000);
    });
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}
