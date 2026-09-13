import { bytesToBase64 } from '../../imagegen/shared';
import { workspace } from '../../workspace/FileSystemWorkspace';
import type {
  PresentationDeckSpecV3,
  PresentationElement,
  PresentationHtmlChartBinding,
  PresentationHtmlSlide,
  PresentationHtmlTableBinding,
  PresentationScene,
  PresentationSceneSlide,
  PresentationTextRun,
  PresentationWarning,
} from './presentationModel';
import { resolvePresentationTheme } from './presentationModel';
import {
  PRESENTATION_HTML_COMPONENT_CSS,
  renderPresentationHtmlModule,
} from './presentationComponentRegistry';
import { analyzePresentationStyle, type PresentationStyleProfile } from './presentationStyleProfile';

const DEFAULT_SLIDE_WIDTH = 13.333;
const DEFAULT_SLIDE_HEIGHT = 7.5;
const DESIGN_WIDTH_PX = 1280;
const MAX_HTML_CHARS_PER_SLIDE = 250_000;
const MAX_CSS_CHARS = 150_000;

const FORBIDDEN_CSS = [
  /@import\b/i,
  /url\s*\(/i,
  /expression\s*\(/i,
  /javascript:/i,
  /behavior\s*:/i,
  /-moz-binding\s*:/i,
  /::(?:before|after)\b/i,
  /<\/?(?:style|script)\b/i,
];

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
};

export type PresentationHtmlCompileResult = {
  scene: PresentationScene;
  sanitizedSlides: Array<{ id: string; html: string; css?: string }>;
  warnings: PresentationWarning[];
  degradedElements: string[];
  styleProfile?: PresentationStyleProfile;
};

const ensureCssSafe = (css: string, label: string): void => {
  if (css.length > MAX_CSS_CHARS) throw new Error(`${label} CSS 超过 ${MAX_CSS_CHARS} 字符限制`);
  const rule = FORBIDDEN_CSS.find((candidate) => candidate.test(css));
  if (rule) throw new Error(`${label} CSS 包含不支持或不安全的规则: ${rule.source}`);
};

const sanitizeHtml = async (html: string, label: string): Promise<string> => {
  if (html.length > MAX_HTML_CHARS_PER_SLIDE) throw new Error(`${label} HTML 超过 ${MAX_HTML_CHARS_PER_SLIDE} 字符限制`);
  const module = await import('dompurify');
  const purifier = module.default;
  const sanitized = purifier.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: false },
    ALLOW_DATA_ATTR: true,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'video', 'audio', 'form', 'input', 'button'],
    FORBID_ATTR: ['srcdoc'],
  });
  if (/\son[a-z]+\s*=/i.test(sanitized) || /javascript:/i.test(sanitized)) {
    throw new Error(`${label} HTML 包含不安全的事件或 URL`);
  }
  return sanitized;
};

const hexColor = (value: string, fallback?: string): string | undefined => {
  const source = value.trim();
  const short = source.match(/^#([0-9a-f]{3})$/i)?.[1];
  if (short) return short.split('').map((item) => `${item}${item}`).join('').toUpperCase();
  const full = source.match(/^#([0-9a-f]{6})/i)?.[1];
  if (full) return full.toUpperCase();
  const rgb = source.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
  if (rgb) return rgb.slice(1, 4).map((item) => Math.max(0, Math.min(255, Math.round(Number(item))))
    .toString(16).padStart(2, '0')).join('').toUpperCase();
  return fallback;
};

const alphaTransparency = (value: string): number | undefined => {
  const alpha = value.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i)?.[1];
  return alpha == null ? undefined : Math.round((1 - Math.max(0, Math.min(1, Number(alpha)))) * 100);
};

const numericPx = (value: string): number => Number.parseFloat(value) || 0;
const finite = (value: string | undefined): number | undefined => {
  if (value == null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const waitFrame = (view: Window): Promise<void> => new Promise((resolve) => view.requestAnimationFrame(() => resolve()));

const slideHtml = (html: string, slideId: string): string =>
  /data-ppt-slide\s*=/.test(html)
    ? html
    : `<section data-ppt-slide="${slideId}">${html}</section>`;

const workspaceImageData = async (path: string): Promise<string> => {
  if (/^(?:https?:|data:|blob:|file:)/i.test(path)) throw new Error(`PPT HTML 图片只能引用工作区相对路径: ${path}`);
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_BY_EXTENSION[ext];
  if (!mime) throw new Error(`PPT HTML 图片格式不支持: ${path}`);
  const bytes = await workspace.readFileBytes(path);
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
};

const bindWorkspaceImages = async (doc: Document): Promise<void> => {
  const images = [...doc.querySelectorAll<HTMLElement>('[data-ppt-type="image"]')];
  await Promise.all(images.map(async (node) => {
    const path = node.dataset.pptSrc?.trim();
    if (!path) throw new Error(`图片元素 ${node.dataset.pptElement ?? ''} 缺少 data-ppt-src`);
    const data = await workspaceImageData(path);
    if (node.tagName.toLowerCase() === 'img') (node as HTMLImageElement).src = data;
    else node.style.backgroundImage = `url("${data}")`;
  }));
  await Promise.all([...doc.images].map((image) => image.decode().catch(() => {
    throw new Error(`图片无法解码: ${image.dataset.pptSrc ?? image.alt ?? ''}`);
  })));
};

const ALLOWED_PPT_DATA_ATTRIBUTES = new Set([
  'data-ppt-slide', 'data-ppt-element', 'data-ppt-type', 'data-ppt-name',
  'data-ppt-decorative', 'data-ppt-fallback', 'data-ppt-src', 'data-ppt-binding',
  'data-ppt-text-layout', 'data-ppt-shape', 'data-ppt-shape-text', 'data-ppt-dash',
  'data-ppt-begin-arrow', 'data-ppt-end-arrow', 'data-ppt-line-width',
]);

const validatePptDataAttributes = (doc: Document): void => {
  for (const node of [...doc.querySelectorAll<HTMLElement>('*')]) {
    for (const attribute of [...node.attributes]) {
      if (attribute.name.toLowerCase().startsWith('data-ppt-')
        && !ALLOWED_PPT_DATA_ATTRIBUTES.has(attribute.name.toLowerCase())) {
        throw new Error(`HTML 包含未支持的 ${attribute.name} 属性`);
      }
    }
  }
};

const chartOption = (binding: PresentationHtmlChartBinding): Record<string, unknown> => {
  const colors = binding.series.map((item) => item.color ? `#${item.color.replace(/^#/, '')}` : undefined).filter(Boolean);
  if (binding.chartType === 'pie' || binding.chartType === 'doughnut') {
    const first = binding.series[0];
    return {
      animation: false,
      color: colors.length ? colors : undefined,
      tooltip: { show: false },
      legend: { show: binding.showLegend ?? true },
      series: [{
        type: 'pie',
        radius: binding.chartType === 'doughnut' ? ['48%', '72%'] : '72%',
        data: (binding.categories ?? []).map((name, index) => ({ name, value: first?.values[index] ?? 0 })),
        label: { show: binding.showValue ?? false },
      }],
    };
  }
  if (binding.chartType === 'radar') {
    const maxima = (binding.categories ?? []).map((_, index) => Math.max(1, ...binding.series.map((item) => Math.abs(item.values[index] ?? 0))));
    return {
      animation: false,
      color: colors.length ? colors : undefined,
      legend: { show: binding.showLegend ?? binding.series.length > 1 },
      radar: { indicator: (binding.categories ?? []).map((name, index) => ({ name, max: maxima[index] })) },
      series: [{ type: 'radar', data: binding.series.map((item) => ({ name: item.name, value: item.values })) }],
    };
  }
  const type = binding.chartType === 'scatter' || binding.chartType === 'bubble'
    ? 'scatter'
    : binding.chartType === 'area' ? 'line' : binding.chartType;
  return {
    animation: false,
    color: colors.length ? colors : undefined,
    tooltip: { show: false },
    legend: { show: binding.showLegend ?? binding.series.length > 1 },
    grid: { left: 48, right: 20, top: 30, bottom: 42 },
    xAxis: { type: 'category', data: binding.categories ?? [] },
    yAxis: { type: 'value' },
    series: binding.series.map((item) => ({
      name: item.name,
      type,
      data: item.values,
      areaStyle: binding.chartType === 'area' ? {} : undefined,
      symbolSize: binding.chartType === 'bubble' ? 14 : undefined,
      label: { show: binding.showValue ?? false },
    })),
  };
};

const renderBoundCharts = async (
  doc: Document,
  bindings: Map<string, PresentationHtmlChartBinding>,
): Promise<Array<{ dispose: () => void }>> => {
  const nodes = [...doc.querySelectorAll<HTMLElement>('[data-ppt-type="chart"]')];
  if (!nodes.length) return [];
  const echarts = await import('echarts');
  return nodes.map((node) => {
    const id = node.dataset.pptBinding?.trim();
    const binding = id ? bindings.get(id) : undefined;
    if (!binding) throw new Error(`图表元素 ${node.dataset.pptElement ?? ''} 缺少有效 data-ppt-binding`);
    const chart = echarts.init(node, undefined, { renderer: 'svg' });
    chart.setOption(chartOption(binding), true);
    return chart;
  });
};

const textRuns = (node: HTMLElement, base: CSSStyleDeclaration): PresentationTextRun[] | undefined => {
  const spans = [...node.querySelectorAll<HTMLElement>('span')].filter((item) => !item.closest('[data-ppt-element]') || item.closest('[data-ppt-element]') === node);
  if (!spans.length) return undefined;
  const runs = spans.map((span) => {
    const style = span.ownerDocument.defaultView!.getComputedStyle(span);
    return {
      text: span.textContent ?? '',
      bold: Number.parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === 'bold',
      italic: style.fontStyle === 'italic',
      fontSize: numericPx(style.fontSize) * 72 / 96,
      color: hexColor(style.color),
      hyperlink: span.closest('a')?.getAttribute('href') ?? undefined,
    } satisfies PresentationTextRun;
  }).filter((run) => run.text.length > 0);
  if (!runs.length) return undefined;
  const covered = runs.reduce((sum, item) => sum + item.text.length, 0);
  return covered >= (node.textContent ?? '').trim().length || base.display === 'contents' ? runs : undefined;
};

const frozenText = (node: HTMLElement): string => {
  const doc = node.ownerDocument;
  const walker = doc.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const lines: Array<{ top: number; chars: string[] }> = [];
  let textNode = walker.nextNode() as Text | null;
  while (textNode) {
    for (let index = 0; index < textNode.data.length; index += 1) {
      const range = doc.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + 1);
      const rect = range.getBoundingClientRect();
      const value = textNode.data[index];
      if (rect.width || value.trim()) {
        const line = lines.find((candidate) => Math.abs(candidate.top - rect.top) < 2);
        if (line) line.chars.push(value);
        else lines.push({ top: rect.top, chars: [value] });
      }
    }
    textNode = walker.nextNode() as Text | null;
  }
  return lines.sort((a, b) => a.top - b.top).map((line) => line.chars.join('').trimEnd()).join('\n').trim();
};

const pureRotation = (transform: string): number | undefined => {
  if (!transform || transform === 'none') return undefined;
  const match = transform.match(/^matrix\(([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+)\)$/i);
  if (!match) return Number.NaN;
  const [a, b, c, d, tx, ty] = match.slice(1).map(Number);
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  if (Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01 || Math.abs(tx) > 0.1 || Math.abs(ty) > 0.1) return Number.NaN;
  return Math.atan2(b, a) * 180 / Math.PI;
};

type ExtendedCssStyle = CSSStyleDeclaration & {
  backdropFilter?: string;
  maskImage?: string;
  mixBlendMode?: string;
};

const elementNeedsFallback = (style: CSSStyleDeclaration): string | undefined => {
  const extended = style as ExtendedCssStyle;
  if (style.filter && style.filter !== 'none') return 'filter';
  if (extended.backdropFilter && extended.backdropFilter !== 'none') return 'backdrop-filter';
  if (extended.mixBlendMode && extended.mixBlendMode !== 'normal') return 'mix-blend-mode';
  if (style.clipPath && style.clipPath !== 'none') return 'clip-path';
  if (extended.maskImage && extended.maskImage !== 'none') return 'mask-image';
  const rotation = pureRotation(style.transform);
  if (Number.isNaN(rotation)) return 'transform';
  return undefined;
};

const svgDataForElement = (node: HTMLElement, css: string, width: number, height: number): string => {
  const content = new XMLSerializer().serializeToString(node.cloneNode(true));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${content}</div></foreignObject></svg>`;
  return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(svg))}`;
};

const tableRows = (node: HTMLElement): string[][] | undefined => {
  if (node.tagName.toLowerCase() !== 'table') return undefined;
  const table = node as HTMLTableElement;
  return [...table.rows].map((row) => [...row.cells].map((cell) => cell.textContent?.trim() ?? ''));
};

const elementFromNode = (
  node: HTMLElement,
  rootRect: DOMRect,
  slideWidth: number,
  slideHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  chartBindings: Map<string, PresentationHtmlChartBinding>,
  tableBindings: Map<string, PresentationHtmlTableBinding>,
  css: string,
  slideIndex: number,
  warnings: PresentationWarning[],
  degradedElements: string[],
): PresentationSceneSlide['elements'][number] => {
  const id = node.dataset.pptElement?.trim();
  const type = node.dataset.pptType?.trim() as PresentationElement['type'] | undefined;
  if (!id || !type || !['text', 'shape', 'line', 'image', 'table', 'chart'].includes(type)) {
    throw new Error(`第 ${slideIndex} 页包含无效的 data-ppt-element/data-ppt-type`);
  }
  const rect = node.getBoundingClientRect();
  const style = node.ownerDocument.defaultView!.getComputedStyle(node);
  const unsupported = elementNeedsFallback(style);
  const decorative = node.dataset.pptDecorative === 'true';
  const fallback = node.dataset.pptFallback === 'rasterize' ? 'rasterize' : 'none';
  const x = (rect.left - rootRect.left) / canvasWidth * slideWidth;
  const y = (rect.top - rootRect.top) / canvasHeight * slideHeight;
  const w = rect.width / canvasWidth * slideWidth;
  const h = rect.height / canvasHeight * slideHeight;
  if (unsupported) {
    if (!decorative || fallback !== 'rasterize') {
      throw new Error(`第 ${slideIndex} 页元素 ${id} 使用不支持的 ${unsupported}；只有显式标记的装饰元素可局部降级`);
    }
    degradedElements.push(`${slideIndex}:${id}`);
    warnings.push({ code: 'flattened_element', slideIndex, elementId: id, message: `元素 ${id} 因 ${unsupported} 已局部转换为 SVG` });
    return {
      id, name: id, sourceHtmlId: id, type: 'image', x, y, w, h, decorative: true,
      data: svgDataForElement(node, css, Math.max(1, Math.round(rect.width)), Math.max(1, Math.round(rect.height))),
      fit: 'stretch', fallback: 'rasterize',
    };
  }

  const rotation = pureRotation(style.transform);
  const common: PresentationSceneSlide['elements'][number] = {
    id,
    name: node.dataset.pptName?.trim() || id,
    sourceHtmlId: id,
    type,
    x, y, w, h,
    zIndex: finite(style.zIndex) ?? [...node.parentElement?.children ?? []].indexOf(node),
    decorative,
    rotate: rotation,
    transparency: alphaTransparency(style.backgroundColor) ?? Math.round((1 - Number(style.opacity || 1)) * 100),
    hyperlink: node.closest('a')?.getAttribute('href') ?? undefined,
  };

  if (type === 'text') {
    const layout = node.dataset.pptTextLayout === 'frozen-lines' ? 'frozen-lines' : 'flow';
    const text = layout === 'frozen-lines' ? frozenText(node) : (node.textContent ?? '').trim();
    const fontFace = style.fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
    if (fontFace && !node.ownerDocument.fonts.check(`${style.fontSize} ${JSON.stringify(fontFace)}`)) warnings.push({
      code: 'font_unavailable', slideIndex, elementId: id, message: `元素 ${id} 使用的字体不可用: ${fontFace}`,
    });
    if (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1) warnings.push({
      code: 'estimated_text_overflow', slideIndex, elementId: id, message: `元素 ${id} 的浏览器文字布局发生溢出`,
    });
    return {
      ...common,
      text,
      runs: layout === 'flow' ? textRuns(node, style) : undefined,
      textLayout: layout,
      fontFace,
      fontSize: numericPx(style.fontSize) * 72 / 96,
      bold: Number.parseInt(style.fontWeight, 10) >= 600 || style.fontWeight === 'bold',
      italic: style.fontStyle === 'italic',
      color: hexColor(style.color),
      align: ['left', 'center', 'right', 'justify'].includes(style.textAlign)
        ? style.textAlign as PresentationElement['align'] : 'left',
      valign: style.display === 'flex' && style.alignItems === 'center' ? 'middle' : undefined,
      margin: numericPx(style.paddingLeft) / canvasWidth * slideWidth,
    };
  }
  if (type === 'image') {
    return {
      ...common,
      path: node.dataset.pptSrc?.trim(),
      alt: node.getAttribute('alt') ?? undefined,
      fit: style.objectFit === 'contain' ? 'contain' : style.objectFit === 'fill' ? 'stretch' : 'cover',
      shadow: style.boxShadow !== 'none',
    };
  }
  if (type === 'table') {
    const binding = node.dataset.pptBinding ? tableBindings.get(node.dataset.pptBinding) : undefined;
    return {
      ...common,
      rows: binding?.rows ?? tableRows(node),
      columnWidths: binding?.columnWidths,
      fill: hexColor(style.backgroundColor),
      color: hexColor(style.color),
      borderColor: hexColor(style.borderColor),
      fontFace: style.fontFamily.split(',')[0]?.trim().replace(/^['"]|['"]$/g, ''),
      fontSize: numericPx(style.fontSize) * 72 / 96,
    };
  }
  if (type === 'chart') {
    const bindingId = node.dataset.pptBinding?.trim();
    const binding = bindingId ? chartBindings.get(bindingId) : undefined;
    if (!binding) throw new Error(`第 ${slideIndex} 页图表 ${id} 缺少有效 binding`);
    return { ...common, ...binding, id, type: 'chart' };
  }
  return {
    ...common,
    shapeType: type === 'line' ? 'line' : node.dataset.pptShape?.trim() || (numericPx(style.borderRadius) > 0 ? 'roundRect' : 'rect'),
    fill: type === 'line' ? undefined : hexColor(style.backgroundColor),
    lineColor: hexColor(style.borderColor) ?? hexColor(style.color),
    lineWidth: numericPx(style.borderWidth) * 72 / 96 || finite(node.dataset.pptLineWidth),
    dash: node.dataset.pptDash === 'dash' || node.dataset.pptDash === 'dot' ? node.dataset.pptDash : 'solid',
    beginArrowType: node.dataset.pptBeginArrow,
    endArrowType: node.dataset.pptEndArrow,
    radius: Math.min(1, numericPx(style.borderRadius) / Math.max(1, canvasWidth) * slideWidth),
    shadow: style.boxShadow !== 'none',
    text: node.dataset.pptShapeText ?? undefined,
  };
};

const layoutStable = (before: DOMRect[], after: DOMRect[]): boolean => before.length === after.length && before.every((rect, index) => {
  const next = after[index];
  return next && Math.max(
    Math.abs(rect.x - next.x), Math.abs(rect.y - next.y),
    Math.abs(rect.width - next.width), Math.abs(rect.height - next.height),
  ) < 0.25;
});

const compileSlide = async (
  slide: PresentationHtmlSlide,
  index: number,
  sharedCss: string,
  slideWidth: number,
  slideHeight: number,
  warnings: PresentationWarning[],
  degradedElements: string[],
): Promise<{ slide: PresentationSceneSlide; sanitized: { id: string; html: string; css?: string } }> => {
  if (typeof document === 'undefined') throw new Error('PPT HTML 编译需要浏览器 DOM 环境');
  const id = slide.id?.trim() || `slide-${index}`;
  const sanitized = await sanitizeHtml(renderPresentationHtmlModule(slide, index), `第 ${index} 页`);
  const css = `${sharedCss}\n${slide.css ?? ''}`;
  ensureCssSafe(css, `第 ${index} 页`);
  const inlineStyleProbe = document.createElement('template');
  inlineStyleProbe.innerHTML = sanitized;
  for (const node of [...inlineStyleProbe.content.querySelectorAll<HTMLElement>('[style]')]) {
    ensureCssSafe(node.getAttribute('style') ?? '', `第 ${index} 页内联`);
  }
  const canvasWidth = DESIGN_WIDTH_PX;
  const canvasHeight = Math.max(1, Math.round(canvasWidth * slideHeight / slideWidth));
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.setAttribute('aria-hidden', 'true');
  Object.assign(iframe.style, {
    position: 'fixed', left: '-100000px', top: '0', width: `${canvasWidth}px`, height: `${canvasHeight}px`,
    border: '0', visibility: 'hidden', pointerEvents: 'none',
  });
  const baseCss = `html,body{margin:0;width:${canvasWidth}px;height:${canvasHeight}px;overflow:hidden}*,*::before,*::after{box-sizing:border-box}body{font-family:Arial,sans-serif}section[data-ppt-slide]{position:relative;width:${canvasWidth}px;height:${canvasHeight}px;overflow:hidden}`;
  iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data: blob:"><style>${baseCss}\n${css}</style></head><body>${slideHtml(sanitized, id)}</body></html>`;
  document.body.appendChild(iframe);
  const charts: Array<{ dispose: () => void }> = [];
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error(`第 ${index} 页 HTML 加载超时`)), 10_000);
      iframe.addEventListener('load', () => { window.clearTimeout(timer); resolve(); }, { once: true });
    });
    const doc = iframe.contentDocument;
    const view = iframe.contentWindow;
    if (!doc || !view) throw new Error(`第 ${index} 页 HTML 沙箱不可访问`);
    const root = doc.querySelector<HTMLElement>('[data-ppt-slide]');
    if (!root) throw new Error(`第 ${index} 页缺少 data-ppt-slide 根节点`);
    validatePptDataAttributes(doc);
    await bindWorkspaceImages(doc);
    const chartBindings = new Map((slide.chartBindings ?? []).map((item) => [item.id, item]));
    const tableBindings = new Map((slide.tableBindings ?? []).map((item) => [item.id, item]));
    charts.push(...await renderBoundCharts(doc, chartBindings));
    await doc.fonts?.ready;
    await waitFrame(view);
    const nodes = [...root.querySelectorAll<HTMLElement>('[data-ppt-element]')];
    if (!nodes.length) throw new Error(`第 ${index} 页没有可导出的 data-ppt-element`);
    const ids = new Set<string>();
    for (const node of nodes) {
      const elementId = node.dataset.pptElement?.trim();
      if (!elementId) throw new Error(`第 ${index} 页存在空的 data-ppt-element`);
      if (ids.has(elementId)) throw new Error(`第 ${index} 页存在重复元素 ID: ${elementId}`);
      ids.add(elementId);
    }
    const first = nodes.map((node) => node.getBoundingClientRect());
    await waitFrame(view);
    const second = nodes.map((node) => node.getBoundingClientRect());
    if (!layoutStable(first, second)) warnings.push({
      code: 'layout_unstable', slideIndex: index, message: `第 ${index} 页连续两帧布局不稳定`,
    });
    const rootRect = root.getBoundingClientRect();
    const elements = nodes.map((node) => elementFromNode(
      node, rootRect, slideWidth, slideHeight, canvasWidth, canvasHeight,
      chartBindings, tableBindings, css, index, warnings, degradedElements,
    )).sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
    const background = hexColor(view.getComputedStyle(root).backgroundColor, 'FFFFFF') ?? 'FFFFFF';
    return {
      slide: { id, index, notes: slide.notes, background, elements },
      // 使用绑定图片、ECharts SVG 和浏览器已清洗的 DOM 作为设计稿预览源，
      // 避免预览再次读取工作区资源或出现“图表空白”。
      sanitized: { id, html: root.outerHTML, css },
    };
  } finally {
    charts.forEach((chart) => chart.dispose());
    iframe.remove();
  }
};

const themeFromProfile = (profile: PresentationStyleProfile | undefined, input: PresentationDeckSpecV3) => {
  if (!profile || input.referenceMode === 'content-only') return resolvePresentationTheme(input.theme);
  return resolvePresentationTheme({
    ...input.theme,
    fontFace: input.theme?.fontFace ?? profile.themeFonts[0],
    headingFontFace: input.theme?.headingFontFace ?? profile.themeFonts[0],
    background: input.theme?.background ?? profile.themeColors[0],
    text: input.theme?.text ?? profile.themeColors[1],
    accent: input.theme?.accent ?? profile.themeColors[2],
    accent2: input.theme?.accent2 ?? profile.themeColors[3],
    chartColors: input.theme?.chartColors ?? profile.chartColors,
  });
};

const cssFontValue = (value: string): string => value
  .replace(/[<>]/g, '')
  .replace(/[\\']/g, '\\$&');

const addSceneWarnings = (scene: PresentationScene, warnings: PresentationWarning[]): void => {
  for (const slide of scene.slides) {
    for (const element of slide.elements) {
      if (element.x < 0 || element.y < 0 || element.x + element.w > scene.width || element.y + element.h > scene.height) {
        warnings.push({ code: 'out_of_bounds', slideIndex: slide.index, elementId: element.id, message: `元素 ${element.id} 超出页面边界` });
      }
    }
    const text = slide.elements.filter((element) => element.type === 'text' && !element.decorative);
    for (let leftIndex = 0; leftIndex < text.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < text.length; rightIndex += 1) {
        const left = text[leftIndex];
        const right = text[rightIndex];
        const overlap = Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
          * Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y));
        if (overlap > Math.min(left.w * left.h, right.w * right.h) * 0.25) warnings.push({
          code: 'overlap', slideIndex: slide.index, elementId: right.id,
          message: `文本元素 ${left.id} 与 ${right.id} 大面积重叠`,
        });
      }
    }
  }
};

export const compilePresentationHtml = async (input: PresentationDeckSpecV3): Promise<PresentationHtmlCompileResult> => {
  if (input.version !== 3 || input.pipeline !== 'html-layout') {
    throw new Error('PPT V3 必须同时指定 version=3 与 pipeline=html-layout');
  }
  if (!input.slides?.length) throw new Error('PPT V3 至少需要一页 HTML 幻灯片');
  if (input.slides.length > 100) throw new Error('PPT 页数不能超过 100');
  ensureCssSafe(input.sharedCss ?? '', '共享');
  const styleProfile = input.referencePath ? await analyzePresentationStyle(input.referencePath) : undefined;
  const slideWidth = input.slideWidth ?? styleProfile?.slideWidth ?? DEFAULT_SLIDE_WIDTH;
  const slideHeight = input.slideHeight ?? styleProfile?.slideHeight ?? DEFAULT_SLIDE_HEIGHT;
  if (![slideWidth, slideHeight].every((value) => Number.isFinite(value) && value > 0 && value <= 100)) {
    throw new Error('PPT V3 页面尺寸无效');
  }
  if (input.referenceMode === 'native-template' && !input.referencePath) {
    throw new Error('native-template 模式必须提供 referencePath');
  }
  const theme = themeFromProfile(styleProfile, input);
  const themeCss = `:root{--ppt-bg:#${theme.background};--ppt-surface:#${theme.surface};--ppt-text:#${theme.text};--ppt-muted:#${theme.muted};--ppt-accent:#${theme.accent};--ppt-accent2:#${theme.accent2};--ppt-font:'${cssFontValue(theme.fontFace)}',Arial,sans-serif;--ppt-heading:'${cssFontValue(theme.headingFontFace)}',Arial,sans-serif}`;
  const sharedCss = `${PRESENTATION_HTML_COMPONENT_CSS}\n${themeCss}\n${input.sharedCss ?? ''}`;
  const warnings: PresentationWarning[] = [];
  const degradedElements: string[] = [];
  const compiled = [];
  const slideIds = new Set<string>();
  for (let index = 0; index < input.slides.length; index += 1) {
    const slideId = input.slides[index].id?.trim() || `slide-${index + 1}`;
    if (slideIds.has(slideId)) throw new Error(`PPT V3 存在重复幻灯片 ID: ${slideId}`);
    slideIds.add(slideId);
    compiled.push(await compileSlide(
      input.slides[index], index + 1, sharedCss, slideWidth, slideHeight, warnings, degradedElements,
    ));
  }
  const scene: PresentationScene = {
    width: slideWidth,
    height: slideHeight,
    sourceKind: 'html-v3',
    template: input.referencePath ? {
      path: input.referencePath,
      mode: input.referenceMode ?? 'inspiration',
      sourceSlideIndices: input.referenceSlideIndices,
    } : undefined,
    theme,
    metadata: {
      title: input.title,
      subject: input.subject,
      author: input.author,
      company: input.company,
      language: input.language,
    },
    slides: compiled.map((item) => item.slide),
    warnings,
  };
  addSceneWarnings(scene, warnings);
  return { scene, sanitizedSlides: compiled.map((item) => item.sanitized), warnings, degradedElements, styleProfile };
};
