import type {
  PresentationHtmlModuleName,
  PresentationHtmlSlide,
  PresentationSemanticItem,
} from './presentationModel';

export const PRESENTATION_HTML_MODULES: readonly PresentationHtmlModuleName[] = [
  'cover', 'section', 'title-body', 'comparison', 'metrics', 'timeline', 'process',
  'matrix', 'funnel', 'roadmap', 'hierarchy', 'image-story', 'image-gallery',
  'quote', 'chart-insight', 'table', 'closing',
] as const;

export const PRESENTATION_HTML_COMPONENT_CSS = `
:root{--ppt-bg:#fff;--ppt-surface:#f8fafc;--ppt-text:#0f172a;--ppt-muted:#475569;--ppt-accent:#2563eb;--ppt-accent2:#0ea5e9;--ppt-font:Arial,sans-serif;--ppt-heading:Arial,sans-serif}
[data-ppt-slide]{background:var(--ppt-bg);color:var(--ppt-text);font-family:var(--ppt-font);padding:64px 72px}
.ppt-title{margin:0;font-family:var(--ppt-heading);font-size:42px;line-height:1.12;font-weight:700;color:var(--ppt-text)}
.ppt-subtitle{margin:14px 0 0;font-size:20px;line-height:1.4;color:var(--ppt-muted)}
.ppt-body{margin-top:42px;font-size:22px;line-height:1.5;color:var(--ppt-text)}
.ppt-row{display:flex;gap:28px;align-items:stretch}.ppt-column{display:flex;min-width:0;flex:1;flex-direction:column;gap:18px}
.ppt-card{display:flex;min-width:0;flex:1;flex-direction:column;justify-content:center;padding:26px 30px;border:1px solid #dbe3ee;border-radius:18px;background:var(--ppt-surface)}
.ppt-card h3{margin:0 0 10px;font-size:24px}.ppt-card p{margin:0;font-size:17px;line-height:1.4;color:var(--ppt-muted)}
.ppt-value{font-size:46px;font-weight:700;color:var(--ppt-accent)}
.ppt-module-body{display:flex;height:510px;flex-direction:column;justify-content:center}
.ppt-steps{display:flex;gap:22px;align-items:center}.ppt-step{display:flex;min-width:0;flex:1;align-items:center;justify-content:center;text-align:center}
.ppt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}
.ppt-gallery{display:grid;height:430px;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.ppt-gallery img{width:100%;height:100%;object-fit:cover;border-radius:16px}
.ppt-quote{max-width:980px;font-family:var(--ppt-heading);font-size:42px;line-height:1.3}.ppt-attribution{margin-top:28px;font-size:18px;color:var(--ppt-muted)}
`;

const escape = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const itemText = (item: PresentationSemanticItem): string => item.text ?? item.subtitle ?? item.label ?? '';
const shape = (id: string, text: string, className = 'ppt-card'): string =>
  `<div class="${className}" data-ppt-element="${escape(id)}" data-ppt-type="shape" data-ppt-shape="roundRect" data-ppt-shape-text="${escape(text)}">${escape(text)}</div>`;
const heading = (slide: PresentationHtmlSlide): string => `
  ${slide.title ? `<h1 class="ppt-title" data-ppt-element="title" data-ppt-type="text" data-ppt-text-layout="frozen-lines">${escape(slide.title)}</h1>` : ''}
  ${slide.subtitle ? `<p class="ppt-subtitle" data-ppt-element="subtitle" data-ppt-type="text">${escape(slide.subtitle)}</p>` : ''}`;

const cards = (items: PresentationSemanticItem[]): string => items.map((item, index) => {
  const value = item.value ? `<div class="ppt-value">${escape(item.value)}</div>` : '';
  const title = item.title ?? item.label ?? '';
  return `<div class="ppt-card" data-ppt-element="card-${index + 1}" data-ppt-type="shape" data-ppt-shape="roundRect">
    ${value}<h3 data-ppt-element="card-${index + 1}-title" data-ppt-type="text">${escape(title)}</h3>
    <p data-ppt-element="card-${index + 1}-body" data-ppt-type="text">${escape(itemText(item))}</p>
  </div>`;
}).join('');

export const renderPresentationHtmlModule = (slide: PresentationHtmlSlide, slideIndex: number): string => {
  const module = slide.module;
  if (!module) return slide.html ?? '';
  const items = slide.items ?? [];
  const id = slide.id?.trim() || `slide-${slideIndex}`;
  if (module === 'cover' || module === 'section' || module === 'closing') {
    return `<section data-ppt-slide="${escape(id)}" style="display:flex;flex-direction:column;justify-content:center">${heading(slide)}</section>`;
  }
  if (module === 'quote') {
    return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<div class="ppt-module-body"><div class="ppt-quote" data-ppt-element="quote" data-ppt-type="text" data-ppt-text-layout="frozen-lines">${escape(items[0]?.text ?? '')}</div><div class="ppt-attribution" data-ppt-element="attribution" data-ppt-type="text">${escape(items[0]?.label ?? '')}</div></div></section>`;
  }
  if (module === 'image-story') {
    const item = items[0];
    return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<div class="ppt-row ppt-module-body"><div class="ppt-column"><p class="ppt-body" data-ppt-element="body" data-ppt-type="text">${escape(itemText(item ?? {}))}</p></div><img data-ppt-element="hero-image" data-ppt-type="image" data-ppt-src="${escape(item?.path ?? '')}" style="width:52%;height:430px;object-fit:cover;border-radius:18px" alt="${escape(item?.title ?? '')}"></div></section>`;
  }
  if (module === 'image-gallery') {
    return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<div class="ppt-gallery" style="margin-top:34px">${items.slice(0, 6).map((item, index) => `<img data-ppt-element="image-${index + 1}" data-ppt-type="image" data-ppt-src="${escape(item.path ?? '')}" alt="${escape(item.title ?? '')}">`).join('')}</div></section>`;
  }
  if (module === 'timeline' || module === 'process' || module === 'roadmap') {
    return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<div class="ppt-steps ppt-module-body">${items.slice(0, 7).map((item, index) => shape(`step-${index + 1}`, `${item.value ? `${item.value} ` : ''}${item.title ?? item.label ?? ''}\n${itemText(item)}`, 'ppt-card ppt-step')).join('')}</div></section>`;
  }
  if (module === 'funnel') {
    return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<div class="ppt-module-body" style="align-items:center;gap:12px">${items.slice(0, 6).map((item, index) => `<div class="ppt-card" data-ppt-element="funnel-${index + 1}" data-ppt-type="shape" data-ppt-shape="roundRect" data-ppt-shape-text="${escape(item.title ?? item.label ?? '')}" style="flex:none;width:${88 - index * 9}%;height:62px;text-align:center">${escape(item.title ?? item.label ?? '')}</div>`).join('')}</div></section>`;
  }
  if (module === 'hierarchy') {
    const [root, ...children] = items;
    return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<div class="ppt-module-body" style="gap:34px;align-items:center">${shape('hierarchy-root', root?.title ?? root?.label ?? '', 'ppt-card')}<div class="ppt-row" style="width:100%">${children.slice(0, 5).map((item, index) => shape(`hierarchy-${index + 1}`, item.title ?? item.label ?? '')).join('')}</div></div></section>`;
  }
  if (module === 'matrix') {
    return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<div class="ppt-grid" style="margin-top:34px;height:430px">${cards(items.slice(0, 4))}</div></section>`;
  }
  if (module === 'comparison') {
    return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<div class="ppt-row ppt-module-body">${cards(items.slice(0, 2))}</div></section>`;
  }
  if (module === 'metrics') {
    return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<div class="ppt-row ppt-module-body">${cards(items.slice(0, 4))}</div></section>`;
  }
  if (module === 'chart-insight') {
    return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<div class="ppt-row ppt-module-body"><div data-ppt-element="chart" data-ppt-type="chart" data-ppt-binding="${escape(slide.chartBindings?.[0]?.id ?? '')}" style="width:68%;height:430px"></div><p class="ppt-body" data-ppt-element="insight" data-ppt-type="text" style="width:30%">${escape(itemText(items[0] ?? {}))}</p></div></section>`;
  }
  if (module === 'table') {
    return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<table data-ppt-element="table" data-ppt-type="table" data-ppt-binding="${escape(slide.tableBindings?.[0]?.id ?? '')}" style="margin-top:34px;width:100%;height:430px;border-collapse:collapse"></table></section>`;
  }
  return `<section data-ppt-slide="${escape(id)}">${heading(slide)}<div class="ppt-body" data-ppt-element="body" data-ppt-type="text">${escape(items.map(itemText).filter(Boolean).join('\n'))}</div></section>`;
};

