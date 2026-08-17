/** 将 HTML 转为可读纯文本（移除 script/style，压缩空行）。 */
export const htmlToText = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
  const text = doc.body?.innerText ?? doc.documentElement?.innerText ?? '';
  return text.replace(/\n{3,}/g, '\n\n').trim();
};
