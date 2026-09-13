import { bytesToBase64 } from '../../imagegen/shared';
import { workspace } from '../../workspace/FileSystemWorkspace';
import type {
  PresentationDeckSpec,
  PresentationDeckSpecV2,
  PresentationElement,
  PresentationScene,
  PresentationSceneSlide,
  PresentationTableCell,
} from './presentationModel';
import { buildPresentationScene, presentationElementObjectName } from './presentationModel';
import { validatePresentationPackage } from './presentationOoxml';

let pptxgenModule: typeof import('pptxgenjs').default | null = null;
const getPptxgen = async () => pptxgenModule ??= (await import('pptxgenjs')).default;

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp',
};

const normalizeColor = (value: string | undefined, fallback: string): string => {
  const normalized = value?.trim().replace(/^#/, '').toUpperCase();
  return normalized && /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
};

const opacity = (value: number | undefined): number | undefined => {
  if (value == null) return undefined;
  return Math.max(0, Math.min(100, value));
};

const imageData = async (path: string): Promise<string> => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mime = IMAGE_MIME[ext];
  if (!mime) throw new Error(`PPT 图片格式不支持: ${path}`);
  const bytes = await workspace.readFileBytes(path);
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
};

const shadow = (enabled: boolean | undefined) => enabled
  ? { type: 'outer', color: '000000', opacity: 0.16, blur: 2, angle: 45, distance: 1 }
  : undefined;

const addText = (slide: any, el: PresentationElement, scene: PresentationScene): void => {
  const options: Record<string, unknown> = {
    x: el.x, y: el.y, w: el.w, h: el.h,
    objectName: presentationElementObjectName(el),
    fontFace: el.fontFace ?? scene.theme.fontFace,
    fontSize: el.fontSize ?? 18,
    bold: el.bold,
    italic: el.italic,
    color: normalizeColor(el.color, scene.theme.text),
    align: el.align,
    valign: el.valign,
    margin: el.margin ?? 0.04,
    rotate: el.rotate,
    breakLine: false,
    fit: el.textLayout ? undefined : 'shrink',
    hyperlink: el.hyperlink ? { url: el.hyperlink } : undefined,
  };
  if (el.runs?.length) {
    slide.addText(el.runs.map((run) => ({
      text: run.text,
      options: {
        bold: run.bold,
        italic: run.italic,
        fontSize: run.fontSize,
        color: run.color ? normalizeColor(run.color, scene.theme.text) : undefined,
        breakLine: run.breakLine,
        hyperlink: run.hyperlink ? { url: run.hyperlink } : undefined,
      },
    })), options);
    return;
  }
  if (el.listItems?.length) {
    slide.addText(el.listItems.map((item) => ({
      text: item.text,
      options: {
        bullet: {
          type: item.ordered ? 'number' : 'bullet',
          indent: 18 + Math.max(0, item.level ?? 0) * 18,
        },
        bold: item.bold,
        color: item.color ? normalizeColor(item.color, scene.theme.text) : undefined,
        breakLine: true,
      },
    })), options);
    return;
  }
  if (el.bullet) {
    const lines = (el.text ?? '').split('\n').filter(Boolean);
    slide.addText(lines.map((text) => ({
      text,
      options: { bullet: { type: 'ul' }, breakLine: true },
    })), options);
    return;
  }
  slide.addText(el.text ?? '', options);
};

const addShape = (slide: any, el: PresentationElement, pptx: any, scene: PresentationScene): void => {
  const requested = el.type === 'line' ? 'line' : (el.shapeType ?? 'rect');
  const shapeType = pptx.ShapeType?.[requested] ?? requested;
  const allowed = new Set(Object.values(pptx.ShapeType ?? {}));
  if (allowed.size && !allowed.has(shapeType)) throw new Error(`不支持的 PPT 形状: ${requested}`);
  slide.addShape(shapeType, {
    x: el.x, y: el.y, w: el.w, h: el.h,
    objectName: presentationElementObjectName(el),
    rotate: el.rotate,
    rectRadius: el.radius,
    fill: el.type === 'line' ? undefined : {
      color: normalizeColor(el.fill, scene.theme.surface),
      transparency: opacity(el.transparency),
    },
    line: {
      color: normalizeColor(el.lineColor, el.type === 'line' ? scene.theme.accent : scene.theme.muted),
      width: el.lineWidth ?? 1,
      dash: el.dash,
      beginArrowType: el.beginArrowType,
      endArrowType: el.endArrowType,
      transparency: opacity(el.transparency),
    },
    shadow: shadow(el.shadow),
  });
  if (el.text) addText(slide, {
    ...el,
    id: `${el.id}-text`,
    name: el.name ? `${el.name} text` : `${el.id}-text`,
    type: 'text',
    margin: el.margin ?? 0.08,
  }, scene);
};

const cellValue = (cell: string | PresentationTableCell, scene: PresentationScene) => {
  if (typeof cell === 'string') return cell;
  return {
    text: cell.text,
    options: {
      bold: cell.bold,
      color: normalizeColor(cell.color, scene.theme.text),
      fill: cell.fill ? { color: normalizeColor(cell.fill, scene.theme.surface) } : undefined,
      align: cell.align,
      rowspan: cell.rowSpan,
      colspan: cell.colSpan,
    },
  };
};

const addTable = (slide: any, el: PresentationElement, scene: PresentationScene): void => {
  if (!el.rows?.length) throw new Error(`表格元素 ${el.id ?? ''} 缺少 rows`);
  slide.addTable(el.rows.map((row) => row.map((cell) => cellValue(cell, scene))), {
    x: el.x, y: el.y, w: el.w, h: el.h,
    objectName: presentationElementObjectName(el),
    colW: el.columnWidths,
    border: { type: 'solid', color: normalizeColor(el.borderColor, 'CBD5E1'), pt: 1 },
    color: normalizeColor(el.color, scene.theme.text),
    fontFace: el.fontFace ?? scene.theme.fontFace,
    fontSize: el.fontSize ?? 13,
    fill: { color: normalizeColor(el.fill, scene.theme.surface) },
    margin: el.margin ?? 0.06,
    valign: el.valign ?? 'middle',
    autoFit: false,
  });
};

const addChart = (slide: any, el: PresentationElement, pptx: any, scene: PresentationScene): void => {
  if (!el.chartType || !el.series?.length) throw new Error(`图表元素 ${el.id ?? ''} 缺少 chartType 或 series`);
  const baseChartType = el.chartType;
  const categories = el.categories ?? [];
  const data = el.series.map((series) => ({
    name: series.name,
    labels: categories,
    values: series.values,
  }));
  const chartTypes = el.series.some((series) => series.type && series.type !== baseChartType)
    ? el.series.map((series, index) => ({
        type: pptx.ChartType?.[series.type ?? baseChartType] ?? series.type ?? baseChartType,
        data: [{ name: series.name, labels: categories, values: series.values }],
        options: { chartColors: [normalizeColor(series.color, scene.theme.chartColors[index % scene.theme.chartColors.length])] },
      }))
    : pptx.ChartType?.[baseChartType] ?? baseChartType;
  const legendPos = ({ top: 't', bottom: 'b', left: 'l', right: 'r' } as const)[el.legendPosition ?? 'bottom'];
  const options = {
    x: el.x, y: el.y, w: el.w, h: el.h,
    objectName: presentationElementObjectName(el),
    chartColors: el.series.map((series, index) =>
      normalizeColor(series.color, scene.theme.chartColors[index % scene.theme.chartColors.length])),
    showLegend: el.showLegend ?? el.series.length > 1,
    legendPos,
    showTitle: el.showTitle ?? false,
    showValue: el.showValue ?? false,
    showPercent: baseChartType === 'pie' || baseChartType === 'doughnut',
    showLabel: (el.showValue ?? false) || (el.showCategoryName ?? false),
    showBorder: false,
    catAxisLabelFontFace: scene.theme.fontFace,
    valAxisLabelFontFace: scene.theme.fontFace,
    showValAxisTitle: false,
    showCatAxisTitle: false,
    showLeaderLines: true,
    showSerName: false,
  };
  if (Array.isArray(chartTypes)) slide.addChart(chartTypes, options);
  else slide.addChart(chartTypes, data, options);
};

const addElement = async (
  slide: any,
  el: PresentationSceneSlide['elements'][number],
  pptx: any,
  scene: PresentationScene,
): Promise<void> => {
  if (![el.x, el.y, el.w, el.h].every((value) => Number.isFinite(value))) {
    throw new Error(`元素 ${el.id} 的坐标或尺寸无效`);
  }
  if (el.type === 'text') return addText(slide, el, scene);
  if (el.type === 'shape' || el.type === 'line') return addShape(slide, el, pptx, scene);
  if (el.type === 'table') return addTable(slide, el, scene);
  if (el.type === 'chart') return addChart(slide, el, pptx, scene);
  if (el.type === 'image') {
    if (!el.path && !el.data) throw new Error(`图片元素 ${el.id} 缺少 path/data`);
    const data = el.data ?? await imageData(el.path!);
    slide.addImage({
      data, x: el.x, y: el.y, w: el.w, h: el.h,
      objectName: presentationElementObjectName(el),
      altText: el.alt,
      rotate: el.rotate,
      transparency: opacity(el.transparency),
      sizing: el.fit && el.fit !== 'stretch'
        ? { type: el.fit, x: el.x, y: el.y, w: el.w, h: el.h }
        : undefined,
      hyperlink: el.hyperlink ? { url: el.hyperlink } : undefined,
      shadow: shadow(el.shadow),
    });
  }
};

export const renderPresentation = async (
  path: string,
  input: PresentationDeckSpecV2,
): Promise<{ path: string; written: true; slideCount: number; theme: string; scene: PresentationScene }> => {
  const scene = buildPresentationScene(input);
  const bytes = await renderPresentationSceneBytes(scene, input);
  await workspace.writeFileBytes(path, bytes);
  return { path, written: true, slideCount: scene.slides.length, theme: scene.theme.name, scene };
};

export const renderPresentationSceneBytes = async (
  scene: PresentationScene,
  input: Pick<PresentationDeckSpec, 'author' | 'company' | 'subject' | 'title' | 'language' | 'presentationHeader' | 'presentationFooter' | 'showSlideNumbers'>,
): Promise<Uint8Array> => {
  const PptxGenJS = await getPptxgen();
  const pptx: any = new PptxGenJS();
  if (Math.abs(scene.width - 13.333) < 0.01 && Math.abs(scene.height - 7.5) < 0.01) {
    pptx.layout = 'LAYOUT_WIDE';
  } else {
    pptx.defineLayout({ name: 'COTTAGE_CUSTOM', width: scene.width, height: scene.height });
    pptx.layout = 'COTTAGE_CUSTOM';
  }
  pptx.theme = { bodyFontFace: scene.theme.fontFace, headFontFace: scene.theme.headingFontFace };
  pptx.author = input.author ?? '';
  pptx.company = input.company ?? '';
  pptx.subject = input.subject ?? '';
  pptx.title = input.title ?? '';
  pptx.lang = input.language ?? 'zh-CN';
  pptx.defineSlideMaster({
    title: 'COTTAGE_BASE',
    background: { color: scene.theme.background },
    objects: [
      ...(input.presentationHeader
        ? [{ text: { text: input.presentationHeader, options: { x: 0.72, y: 0.12, w: Math.max(0.5, scene.width - 1.53), h: 0.2, fontFace: scene.theme.fontFace, fontSize: 8.5, color: scene.theme.muted, margin: 0 } } }]
        : []),
      ...(input.presentationFooter
        ? [{ text: { text: input.presentationFooter, options: { x: 0.72, y: Math.max(0, scene.height - 0.37), w: Math.max(0.5, scene.width - 2.53), h: 0.2, fontFace: scene.theme.fontFace, fontSize: 8.5, color: scene.theme.muted, margin: 0 } } }]
        : []),
    ],
    slideNumber: input.showSlideNumbers === false
      ? undefined
      : { x: Math.max(0, scene.width - 1.18), y: Math.max(0, scene.height - 0.42), w: 0.45, h: 0.25, fontFace: scene.theme.fontFace, fontSize: 9, color: scene.theme.muted, align: 'right', margin: 0 },
  });
  for (const sceneSlide of scene.slides) {
    const slide = pptx.addSlide('COTTAGE_BASE');
    slide.background = { color: sceneSlide.background };
    for (const el of sceneSlide.elements) await addElement(slide, el, pptx, scene);
    if (sceneSlide.notes?.trim()) slide.addNotes(sceneSlide.notes.trim());
  }
  const bytes = (await pptx.write({ outputType: 'uint8array', compression: true })) as Uint8Array;
  await validatePresentationPackage(bytes);
  return bytes;
};

export const renderPresentationScene = async (
  path: string,
  scene: PresentationScene,
  input: Pick<PresentationDeckSpec, 'author' | 'company' | 'subject' | 'title' | 'language' | 'presentationHeader' | 'presentationFooter' | 'showSlideNumbers'>,
): Promise<{ path: string; written: true; slideCount: number; theme: string; scene: PresentationScene }> => {
  const bytes = await renderPresentationSceneBytes(scene, input);
  await workspace.writeFileBytes(path, bytes);
  return { path, written: true, slideCount: scene.slides.length, theme: scene.theme.name, scene };
};
