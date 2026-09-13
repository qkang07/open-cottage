import { bytesToBase64 } from '../../imagegen/shared';
import { workspace } from '../../workspace/FileSystemWorkspace';
import type {
  PresentationChartSeries,
  PresentationElement,
  PresentationSlide,
  PresentationTableCell,
  PresentationWarning,
} from './presentationModel';
import {
  buildPresentationScene,
  parsePresentationElementObjectName,
  presentationElementObjectName,
} from './presentationModel';
import { analyzePresentationStyleBytes, type PresentationStyleProfile } from './presentationStyleProfile';

type JSZipModule = typeof import('jszip');
let jszipModule: JSZipModule | null = null;
const getJSZip = async (): Promise<JSZipModule> => {
  if (jszipModule) return jszipModule;
  const mod = await import('jszip');
  jszipModule = (mod as unknown as { default?: JSZipModule }).default ?? (mod as unknown as JSZipModule);
  return jszipModule;
};

const EMU_PER_INCH = 914400;
const ELEMENT_RE = /<p:(sp|pic|graphicFrame|cxnSp|grpSp)\b[\s\S]*?<\/p:\1>/g;
const xmlEscape = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const xmlUnescape = (value: string): string => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

const attribute = (tag: string, name: string): string | undefined => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = tag.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`, 'i'))?.[1];
  return value == null ? undefined : xmlUnescape(value);
};

type Relationship = { id: string; type: string; target: string; targetMode?: string; tag: string };
const relationships = (xml: string): Relationship[] => [...xml.matchAll(/<Relationship\b[^>]*\/?\s*>/gi)]
  .map((match) => ({
    id: attribute(match[0], 'Id') ?? '',
    type: attribute(match[0], 'Type') ?? '',
    target: attribute(match[0], 'Target') ?? '',
    targetMode: attribute(match[0], 'TargetMode'),
    tag: match[0],
  }))
  .filter((item) => item.id && item.target);

const extractTexts = (xml: string): string[] => {
  const values: string[] = [];
  for (const match of xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) {
    values.push(xmlUnescape(match[1]));
  }
  return values;
};

const numericSlideEntries = (zip: any): string[] => Object.keys(zip.files)
  .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
  .sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1] ?? 0) - Number(b.match(/slide(\d+)/i)?.[1] ?? 0));

const slideEntries = async (zip: any): Promise<string[]> => {
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  if (!presentationXml || !relsXml) return numericSlideEntries(zip);
  const rels = new Map(relationships(relsXml).map((rel) => [rel.id, resolvePartTarget('ppt/presentation.xml', rel.target)]));
  const ordered: string[] = [];
  for (const match of presentationXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/>/gi)) {
    const target = rels.get(match[1]);
    if (target && zip.file(target)) ordered.push(target);
  }
  return ordered.length ? ordered : numericSlideEntries(zip);
};

const shapeMeta = (block: string): { shapeId: string; name: string; decorative: boolean } => {
  const match = block.match(/<p:cNvPr\b[^>]*\bid="(\d+)"[^>]*\bname="([^"]*)"[^>]*>/i)
    ?? block.match(/<p:cNvPr\b[^>]*\bname="([^"]*)"[^>]*\bid="(\d+)"[^>]*>/i);
  if (!match) return { shapeId: '', name: '', decorative: false };
  const shapeId = /^\d+$/.test(match[1]) ? match[1] : match[2];
  const rawName = xmlUnescape(/^\d+$/.test(match[1]) ? match[2] : match[1]);
  return { shapeId, ...parsePresentationElementObjectName(rawName) };
};

const bounds = (block: string) => {
  const off = block.match(/<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/i);
  const ext = block.match(/<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/i);
  return {
    x: Number(off?.[1] ?? 0) / EMU_PER_INCH,
    y: Number(off?.[2] ?? 0) / EMU_PER_INCH,
    w: Number(ext?.[1] ?? 0) / EMU_PER_INCH,
    h: Number(ext?.[2] ?? 0) / EMU_PER_INCH,
  };
};

const elementType = (kind: string, block: string): PresentationElement['type'] | 'group' | 'unsupported' => {
  if (kind === 'pic') return /<(?:p14:media|a:videoFile|a:audioFile|p:oleObj)\b/i.test(block) ? 'unsupported' : 'image';
  if (kind === 'cxnSp') return 'line';
  if (kind === 'grpSp') return 'group';
  if (kind === 'graphicFrame') {
    if (/<a:tbl\b/i.test(block)) return 'table';
    if (/<c:chart\b/i.test(block)) return 'chart';
    return 'unsupported';
  }
  return /<p:txBody\b/i.test(block) ? 'text' : 'shape';
};

export type PresentationElementPreview = {
  id: string;
  shapeId: string;
  name: string;
  type: PresentationElement['type'] | 'group' | 'unsupported';
  editable: boolean;
  decorative?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  texts: string[];
  fill?: string;
  lineColor?: string;
  textColor?: string;
  shapeType?: string;
  rows?: string[][];
  chart?: {
    categories: string[];
    series: Array<{ name: string; values: number[] }>;
  };
  missingAsset?: boolean;
  imageDataUrl?: string;
  hyperlinks?: string[];
};

export type PresentationSlidePreviewData = {
  index: number;
  id: string;
  texts: string[];
  background: string;
  elements: PresentationElementPreview[];
};

const contrastRatio = (left: string, right: string): number => {
  const luminance = (color: string) => {
    const rgb = [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255)
      .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const [light, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

const previewWarnings = (
  slides: PresentationSlidePreviewData[],
  slideWidth = 13.333,
  slideHeight = 7.5,
): PresentationWarning[] => {
  const warnings: PresentationWarning[] = [];
  for (const slide of slides) {
    for (const element of slide.elements) {
      if (element.x < 0 || element.y < 0 || element.x + element.w > slideWidth || element.y + element.h > slideHeight) {
        warnings.push({ code: 'out_of_bounds', slideIndex: slide.index, elementId: element.id,
          message: `元素 ${element.id} 超出页面边界` });
      }
      if (element.missingAsset) warnings.push({ code: 'missing_asset', slideIndex: slide.index, elementId: element.id,
        message: `元素 ${element.id} 引用的资源不存在` });
      if (!element.decorative && element.type === 'text' && element.textColor && contrastRatio(element.textColor, slide.background) < 3) {
        warnings.push({ code: 'low_contrast', slideIndex: slide.index, elementId: element.id,
          message: `元素 ${element.id} 与页面背景对比度偏低` });
      }
      const text = element.texts.join('');
      if (!element.decorative && text && element.w > 0 && element.h > 0 && text.length > Math.floor(element.w * element.h * 70)) {
        warnings.push({ code: 'estimated_text_overflow', slideIndex: slide.index, elementId: element.id,
          message: `元素 ${element.id} 的文字可能溢出` });
      }
    }
    const textElements = slide.elements.filter((element) => element.type === 'text' && element.texts.length && !element.decorative);
    for (let i = 0; i < textElements.length; i += 1) {
      for (let j = i + 1; j < textElements.length; j += 1) {
        const a = textElements[i];
        const b = textElements[j];
        const overlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
          * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        if (overlap > Math.min(a.w * a.h, b.w * b.h) * 0.25) warnings.push({
          code: 'overlap', slideIndex: slide.index, elementId: b.id,
          message: `文本元素 ${a.id} 与 ${b.id} 大面积重叠`,
        });
      }
    }
  }
  return warnings;
};

const inspectTableRows = (block: string): string[][] => [...block.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)]
  .map((row) => [...row[0].matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)]
    .map((cell) => extractTexts(cell[0]).join('\n')));

const inspectChartXml = (xml: string): PresentationElementPreview['chart'] => {
  const series = [...xml.matchAll(/<c:ser>[\s\S]*?<\/c:ser>/g)].map((match, index) => {
    const block = match[0];
    const name = block.match(/<c:tx>[\s\S]*?<c:v>([\s\S]*?)<\/c:v>/i)?.[1]
      ?? block.match(/<c:tx>[\s\S]*?<c:strCache>[\s\S]*?<c:v>([\s\S]*?)<\/c:v>/i)?.[1]
      ?? `系列 ${index + 1}`;
    const valuesBlock = block.match(/<c:(?:val|yVal)>[\s\S]*?<c:numCache>([\s\S]*?)<\/c:numCache>/i)?.[1] ?? '';
    const values = [...valuesBlock.matchAll(/<c:v>([\s\S]*?)<\/c:v>/g)].map((value) => Number(xmlUnescape(value[1])));
    return { name: xmlUnescape(name), values: values.filter(Number.isFinite) };
  });
  const categoryBlock = xml.match(/<c:(?:cat|xVal)>[\s\S]*?<c:(?:strCache|numCache)>([\s\S]*?)<\/c:(?:strCache|numCache)>/i)?.[1] ?? '';
  const categories = [...categoryBlock.matchAll(/<c:v>([\s\S]*?)<\/c:v>/g)].map((value) => xmlUnescape(value[1]));
  return { categories, series };
};

const inspectSlideXml = (xml: string, index: number): PresentationSlidePreviewData => {
  const elements: PresentationElementPreview[] = [];
  for (const match of xml.matchAll(ELEMENT_RE)) {
    const block = match[0];
    const kind = match[1];
    const meta = shapeMeta(block);
    if (!meta.shapeId || meta.shapeId === '1') continue;
    const type = elementType(kind, block);
    const fill = block.match(/<p:spPr>[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/i)?.[1];
    const lineColor = block.match(/<a:ln\b[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/i)?.[1];
    const textColor = block.match(/<p:txBody>[\s\S]*?<a:rPr\b[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/i)?.[1];
    elements.push({
      id: `slide-${index}:shape-${meta.shapeId}`,
      shapeId: meta.shapeId,
      name: meta.name,
      type,
      editable: type !== 'group' && type !== 'unsupported',
      decorative: meta.decorative || undefined,
      ...bounds(block),
      texts: extractTexts(block),
      fill: fill?.toUpperCase(),
      lineColor: lineColor?.toUpperCase(),
      textColor: textColor?.toUpperCase(),
      shapeType: block.match(/<a:prstGeom\b[^>]*\bprst="([^"]+)"/i)?.[1],
      rows: type === 'table' ? inspectTableRows(block) : undefined,
    });
  }
  const background = xml.match(/<p:bg>[\s\S]*?<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/i)?.[1]?.toUpperCase() ?? 'FFFFFF';
  return {
    index,
    id: `slide-${index}`,
    texts: elements.flatMap((element) => element.texts).filter((text) => text.trim()),
    background,
    elements,
  };
};

const enrichSlideElements = async (
  zip: any,
  slideEntry: string,
  slideXml: string,
  slide: PresentationSlidePreviewData,
  includeAssets: boolean,
): Promise<void> => {
  const relXml = await zip.file(relationFileForSlide(slideEntry))?.async('string') ?? '';
  const relMap = new Map(relationships(relXml).map((rel) => [rel.id, rel]));
  for (const element of slide.elements) {
    let block: string;
    try {
      block = locateElement(slideXml, element.id).block;
    } catch {
      continue;
    }
    const hyperlinkIds = [...block.matchAll(/<a:hlinkClick\b[^>]*\br:id="([^"]+)"/gi)].map((match) => match[1]);
    element.hyperlinks = hyperlinkIds
      .map((id) => relMap.get(id)?.target)
      .filter((target): target is string => Boolean(target));
    if (element.type !== 'image' && element.type !== 'chart') continue;
    const rid = element.type === 'image'
      ? block.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/i)?.[1]
      : block.match(/<c:chart\b[^>]*\br:id="([^"]+)"/i)?.[1];
    const rel = rid ? relMap.get(rid) : undefined;
    if (!rel || rel.targetMode === 'External') {
      element.missingAsset = !rel;
      continue;
    }
    const part = resolvePartTarget(slideEntry, rel.target);
    const file = zip.file(part);
    element.missingAsset = !file;
    if (file && element.type === 'chart') {
      element.chart = inspectChartXml(await file.async('string'));
    } else if (file && element.type === 'image' && includeAssets) {
      const ext = part.split('.').pop()?.toLowerCase() ?? '';
      const mime = imageMime[ext];
      if (mime) element.imageDataUrl = `data:${mime};base64,${bytesToBase64(await file.async('uint8array'))}`;
    }
  }
};

export type InspectPresentationOptions = {
  slideIndex?: number;
  textIndex?: number;
  includeElements?: boolean;
  includeAssets?: boolean;
  includeStyleProfile?: boolean;
  includeLayouts?: boolean;
  includeMasters?: boolean;
};

export type InspectPresentationResult = {
  slides: PresentationSlidePreviewData[];
  warnings: PresentationWarning[];
  slideWidth: number;
  slideHeight: number;
  styleProfile?: PresentationStyleProfile;
  slideIndex?: number;
  textIndex?: number;
};

export const inspectPresentationBytes = async (
  bytes: Uint8Array,
  options?: InspectPresentationOptions,
): Promise<InspectPresentationResult> => {
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(bytes);
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string') ?? '';
  const size = presentationXml.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/i);
  const slideWidth = Number(size?.[1] ?? 12191695) / EMU_PER_INCH;
  const slideHeight = Number(size?.[2] ?? 6858000) / EMU_PER_INCH;
  const entries = await slideEntries(zip);
  const slides: PresentationSlidePreviewData[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    if (options?.slideIndex != null && options.slideIndex !== index + 1) continue;
    const xml = await zip.file(entries[index])!.async('string');
    const slide = inspectSlideXml(xml, index + 1);
    await enrichSlideElements(zip, entries[index], xml, slide, options?.includeAssets === true);
    if (options?.textIndex != null) {
      const text = slide.texts[options.textIndex - 1];
      if (text === undefined) throw new Error(`幻灯片 ${slide.index} 无文本块 #${options.textIndex}`);
      slide.texts = [text];
      if (!options.includeElements) slide.elements = [];
    } else if (!options?.includeElements) {
      slide.elements = [];
    }
    slides.push(slide);
  }
  if (options?.slideIndex != null && slides.length === 0) throw new Error(`幻灯片不存在: ${options.slideIndex}`);
  const includeProfile = options?.includeStyleProfile || options?.includeLayouts || options?.includeMasters;
  const profile = includeProfile ? await analyzePresentationStyleBytes(bytes) : undefined;
  const styleProfile = profile ? {
    ...profile,
    layouts: options?.includeLayouts ? profile.layouts : [],
    masters: options?.includeMasters ? profile.masters : [],
  } : undefined;
  return {
    slides,
    warnings: previewWarnings(slides, slideWidth, slideHeight),
    slideWidth,
    slideHeight,
    styleProfile,
    slideIndex: options?.slideIndex,
    textIndex: options?.textIndex,
  };
};

export const inspectPresentation = async (
  path: string,
  options?: InspectPresentationOptions,
): Promise<InspectPresentationResult> => {
  const bytes = await workspace.readFileBytes(path);
  return inspectPresentationBytes(bytes, options);
};

export type PresentationEditOperation = {
  op:
    | 'addElement' | 'updateElement' | 'removeElement' | 'replaceImage'
    | 'updateTable' | 'updateChartData' | 'updateSlideNotes' | 'addSlide' | 'removeSlide'
    | 'duplicateSlide' | 'moveSlide';
  slideIndex?: number;
  targetSlideIndex?: number;
  elementId?: string;
  element?: PresentationElement;
  patch?: Partial<PresentationElement>;
  imagePath?: string;
  rows?: Array<Array<string | PresentationTableCell>>;
  categories?: string[];
  series?: PresentationChartSeries[];
  notes?: string;
  slide?: PresentationSlide;
};

const shapeIdFromElementId = (elementId: string | undefined): string => {
  const id = elementId?.match(/shape-(\d+)$/)?.[1];
  if (!id) throw new Error(`无效的 PPT 元素 ID: ${elementId ?? ''}`);
  return id;
};

const locateElement = (xml: string, elementId: string | undefined) => {
  const wanted = shapeIdFromElementId(elementId);
  for (const match of xml.matchAll(ELEMENT_RE)) {
    if (shapeMeta(match[0]).shapeId === wanted) return { block: match[0], start: match.index!, end: match.index! + match[0].length };
  }
  throw new Error(`PPT 元素不存在: ${elementId}`);
};

const replaceBounds = (block: string, patch: Partial<PresentationElement>): string => {
  let result = block;
  const current = bounds(block);
  const x = Math.round((patch.x ?? current.x) * EMU_PER_INCH);
  const y = Math.round((patch.y ?? current.y) * EMU_PER_INCH);
  const w = Math.round((patch.w ?? current.w) * EMU_PER_INCH);
  const h = Math.round((patch.h ?? current.h) * EMU_PER_INCH);
  const line = /^<p:cxnSp\b/i.test(block);
  if ([x, y, w, h].some((value) => !Number.isFinite(value)) || (line ? w === 0 && h === 0 : w <= 0 || h <= 0)) {
    throw new Error('PPT 元素坐标或尺寸无效');
  }
  result = result.replace(/<a:off\b[^>]*\bx="-?\d+"[^>]*\by="-?\d+"\s*\/>/i, `<a:off x="${x}" y="${y}"/>`);
  result = result.replace(/<a:ext\b[^>]*\bcx="\d+"[^>]*\bcy="\d+"\s*\/>/i, `<a:ext cx="${w}" cy="${h}"/>`);
  return result;
};

const replaceShapeText = (block: string, text: string): string => {
  if (!/<p:txBody\b/i.test(block)) throw new Error('目标元素不包含可编辑文本');
  const paragraphs = text.split('\n').map((line) =>
    `<a:p><a:r><a:rPr lang="zh-CN" dirty="0"></a:rPr><a:t>${xmlEscape(line)}</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p>`,
  ).join('');
  const next = block.replace(/(<p:txBody>[\s\S]*?<a:lstStyle(?:\s[^>]*)?\/>)[\s\S]*?(<\/p:txBody>)/i, `$1${paragraphs}$2`);
  if (next === block) throw new Error('目标文本框结构不受支持，未修改原文件');
  return next;
};

const replaceSolidColor = (block: string, color: string, line = false): string => {
  const normalized = color.replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(normalized)) throw new Error(`无效颜色: ${color}`);
  if (line) {
    const next = block.replace(/(<a:ln\b[^>]*>[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr\b[^>]*\bval=")[0-9A-Fa-f]{6}/i, `$1${normalized}`);
    if (next === block) throw new Error('目标元素没有可安全替换的线条颜色');
    return next;
  }
  const next = block.replace(/(<p:spPr>[\s\S]*?<a:solidFill>[\s\S]*?<a:srgbClr\b[^>]*\bval=")[0-9A-Fa-f]{6}/i, `$1${normalized}`);
  if (next === block) throw new Error('目标元素没有可安全替换的填充颜色');
  return next;
};

const updateElementBlock = (block: string, patch: Partial<PresentationElement>): string => {
  const supported = new Set([
    'name', 'x', 'y', 'w', 'h', 'rotate', 'text', 'runs', 'listItems', 'fontFace', 'fontSize',
    'bold', 'italic', 'color', 'align', 'valign', 'fill', 'transparency', 'lineColor', 'zIndex',
    'lineWidth', 'dash', 'beginArrowType', 'endArrowType', 'shapeType', 'decorative',
  ]);
  const unsupported = Object.keys(patch).filter((key) => patch[key as keyof PresentationElement] !== undefined && !supported.has(key));
  if (unsupported.length) throw new Error(`updateElement 不支持修改字段: ${unsupported.join(', ')}`);
  let result = [patch.x, patch.y, patch.w, patch.h].some((value) => value != null)
    ? replaceBounds(block, patch)
    : block;
  if (patch.text !== undefined) result = replaceShapeText(result, patch.text);
  if (patch.runs?.length || patch.listItems?.length) {
    if (!/<p:txBody\b/i.test(result)) throw new Error('目标元素不包含可编辑文本');
    result = result.replace(/<p:txBody\b[\s\S]*?<\/p:txBody>/i, textBodyXml({ ...patch, type: 'text' }));
  }
  if (patch.fill) result = replaceSolidColor(result, patch.fill);
  if (patch.lineColor) result = replaceSolidColor(result, patch.lineColor, true);
  if (patch.name !== undefined || patch.decorative !== undefined) {
    const current = shapeMeta(result);
    const name = presentationElementObjectName({
      id: patch.name ?? current.name,
      decorative: patch.decorative ?? current.decorative,
    }) ?? current.name;
    result = result.replace(/(<p:cNvPr\b[^>]*\bname=")[^"]*/i, `$1${xmlEscape(name)}`);
  }
  if (patch.shapeType) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(patch.shapeType)) throw new Error(`无效形状类型: ${patch.shapeType}`);
    result = result.replace(/(<a:prstGeom\b[^>]*\bprst=")[^"]*/i, `$1${patch.shapeType}`);
  }
  if (patch.rotate !== undefined) {
    const value = Math.round(patch.rotate * 60000);
    result = result.replace(/<a:xfrm\b([^>]*)>/i, (_tag, attrs: string) => {
      const next = /\brot="[^"]*"/i.test(attrs)
        ? attrs.replace(/\brot="[^"]*"/i, `rot="${value}"`)
        : `${attrs} rot="${value}"`;
      return `<a:xfrm${next}>`;
    });
  }
  if (patch.lineWidth !== undefined) {
    result = result.replace(/<a:ln\b([^>]*)>/i, (_tag, attrs: string) => {
      const width = `w="${Math.round(patch.lineWidth! * 12700)}"`;
      const next = /\bw="[^"]*"/i.test(attrs) ? attrs.replace(/\bw="[^"]*"/i, width) : `${attrs} ${width}`;
      return `<a:ln${next}>`;
    });
  }
  if (patch.dash) {
    const dash = ({ solid: 'solid', dash: 'dash', dot: 'sysDot' } as const)[patch.dash];
    result = /<a:prstDash\b/i.test(result)
      ? result.replace(/(<a:prstDash\b[^>]*\bval=")[^"]*/i, `$1${dash}`)
      : result.replace(/(<a:ln\b[^>]*>)/i, `$1<a:prstDash val="${dash}"/>`);
  }
  const updateArrow = (position: 'head' | 'tail', value: string | undefined) => {
    if (!value) return;
    const tag = `a:${position}End`;
    result = new RegExp(`<${tag}\\b`, 'i').test(result)
      ? result.replace(new RegExp(`(<${tag}\\b[^>]*\\btype=")[^"]*`, 'i'), `$1${xmlEscape(value)}`)
      : result.replace(/(<\/a:ln>)/i, `<${tag} type="${xmlEscape(value)}"/>$1`);
  };
  updateArrow('head', patch.beginArrowType);
  updateArrow('tail', patch.endArrowType);
  if (patch.transparency !== undefined) {
    const alpha = Math.round((100 - patch.transparency) * 1000);
    const color = result.match(/<a:solidFill>[\s\S]*?(<a:srgbClr\b[^>]*(?:\/>|>[\s\S]*?<\/a:srgbClr>))/i)?.[1];
    if (!color) throw new Error('目标元素没有可编辑的纯色填充');
    let updated: string;
    if (/<a:alpha\b/i.test(color)) {
      updated = color.replace(/(<a:alpha\b[^>]*\bval=")[^"]*/i, `$1${alpha}`);
    } else if (/\/>$/.test(color)) {
      updated = color.replace(/\/>$/, `><a:alpha val="${alpha}"/></a:srgbClr>`);
    } else {
      updated = color.replace(/<\/a:srgbClr>$/i, `<a:alpha val="${alpha}"/></a:srgbClr>`);
    }
    result = result.replace(color, updated);
  }
  const align = patch.align;
  if (align) {
    result = result.replace(/<a:p>(?!<a:pPr)/gi, `<a:p><a:pPr algn="${align === 'justify' ? 'just' : align[0]}"/>`);
    result = result.replace(/<a:pPr\b([^>]*)>/gi, (_tag, attrs: string) => {
      const value = align === 'justify' ? 'just' : align[0];
      const next = /\balgn="[^"]*"/i.test(attrs)
        ? attrs.replace(/\balgn="[^"]*"/i, `algn="${value}"`)
        : `${attrs} algn="${value}"`;
      return `<a:pPr${next}>`;
    });
  }
  if (patch.valign) {
    const value = ({ top: 't', middle: 'ctr', bottom: 'b' } as const)[patch.valign];
    result = result.replace(/<a:bodyPr\b([^>]*)>/i, (_tag, attrs: string) => {
      const next = /\banchor="[^"]*"/i.test(attrs)
        ? attrs.replace(/\banchor="[^"]*"/i, `anchor="${value}"`)
        : `${attrs} anchor="${value}"`;
      return `<a:bodyPr${next}>`;
    });
  }
  if (patch.fontSize !== undefined || patch.bold !== undefined || patch.italic !== undefined || patch.fontFace || patch.color) {
    if (!/<p:txBody\b/i.test(result)) throw new Error('目标元素不包含可编辑文本样式');
    result = result.replace(/<a:rPr\b([^>]*)\/>/gi, '<a:rPr$1></a:rPr>');
    result = result.replace(/<a:rPr\b([^>]*)>/gi, (_tag, attrs: string) => {
      let next = attrs;
      const set = (name: string, value: string) => {
        next = new RegExp(`\\b${name}="[^"]*"`, 'i').test(next)
          ? next.replace(new RegExp(`\\b${name}="[^"]*"`, 'i'), `${name}="${value}"`)
          : `${next} ${name}="${value}"`;
      };
      if (patch.fontSize !== undefined) set('sz', String(Math.round(patch.fontSize * 100)));
      if (patch.bold !== undefined) set('b', patch.bold ? '1' : '0');
      if (patch.italic !== undefined) set('i', patch.italic ? '1' : '0');
      return `<a:rPr${next}>`;
    });
    if (patch.color) {
      result = result.replace(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/gi, (runProps) =>
        /<a:solidFill>/i.test(runProps)
          ? runProps.replace(/(<a:solidFill>)[\s\S]*?(<\/a:solidFill>)/i, `$1${colorXml(patch.color, '0F172A')}$2`)
          : runProps.replace(/<\/a:rPr>/i, `<a:solidFill>${colorXml(patch.color, '0F172A')}</a:solidFill></a:rPr>`));
    }
    if (patch.fontFace) {
      result = result.replace(/<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/gi, (runProps) => {
        let next = runProps;
        const face = xmlEscape(patch.fontFace!);
        next = /<a:latin\b/i.test(next)
          ? next.replace(/(<a:latin\b[^>]*\btypeface=")[^"]*/i, `$1${face}`)
          : next.replace(/<\/a:rPr>/i, `<a:latin typeface="${face}"/></a:rPr>`);
        next = /<a:ea\b/i.test(next)
          ? next.replace(/(<a:ea\b[^>]*\btypeface=")[^"]*/i, `$1${face}`)
          : next.replace(/<\/a:rPr>/i, `<a:ea typeface="${face}"/></a:rPr>`);
        return next;
      });
    }
  }
  return result;
};

const tableTexts = (rows: Array<Array<string | PresentationTableCell>>): string[] =>
  rows.flatMap((row) => row.map((cell) => typeof cell === 'string' ? cell : cell.text));

const replaceSequentialTexts = (xml: string, values: string[]): string => {
  const cellCount = [...xml.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)].length;
  if (cellCount && cellCount !== values.length) {
    throw new Error(`表格单元格数量必须保持为 ${cellCount}，实际 ${values.length}`);
  }
  let index = 0;
  const result = xml.replace(/(<a:t(?:\s[^>]*)?>)[\s\S]*?(<\/a:t>)/g, (_all, open, close) => {
    if (index >= values.length) return `${open}${close}`;
    return `${open}${xmlEscape(values[index++])}${close}`;
  });
  if (index < values.length) throw new Error('目标对象的文本单元格少于输入数据，不能安全扩展结构');
  return result;
};

const relationFileForSlide = (entry: string): string => entry.replace(/\/slide(\d+)\.xml$/i, '/_rels/slide$1.xml.rels');

const resolvePartTarget = (sourcePart: string, target: string): string => {
  const base = sourcePart.split('/').slice(0, -1);
  for (const part of target.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') base.pop(); else base.push(part);
  }
  return base.join('/');
};

const replaceImage = async (zip: any, slideEntry: string, block: string, path: string): Promise<void> => {
  const rid = block.match(/<a:blip\b[^>]*\br:embed="([^"]+)"/i)?.[1];
  if (!rid) throw new Error('目标图片缺少媒体关系，不能安全替换');
  const relEntry = relationFileForSlide(slideEntry);
  const relXml = await zip.file(relEntry)?.async('string');
  if (!relXml) throw new Error('目标幻灯片缺少关系文件');
  const rel = relationships(relXml).find((item) => item.id === rid);
  if (!rel) throw new Error(`找不到图片关系: ${rid}`);
  const newExt = path.split('.').pop()?.toLowerCase();
  const mime = imageMime[newExt ?? ''];
  if (!newExt || !mime) throw new Error(`不支持的替换图片格式: ${path}`);
  const mediaNumber = nextNumericSuffix(Object.keys(zip.files), /^ppt\/media\/image(\d+)\.[^.]+$/i);
  const mediaPart = `ppt/media/image${mediaNumber}.${newExt}`;
  zip.file(mediaPart, await workspace.readFileBytes(path));
  const target = `../media/image${mediaNumber}.${newExt}`;
  const updatedTag = rel.tag.replace(/\bTarget="[^"]*"/i, `Target="${xmlEscape(target)}"`);
  zip.file(relEntry, relXml.replace(rel.tag, updatedTag));
  const contentTypes = await zip.file('[Content_Types].xml')?.async('string');
  if (!contentTypes) throw new Error('PPT 缺少 [Content_Types].xml');
  zip.file('[Content_Types].xml', ensureContentType(contentTypes, newExt, mime));
};

const updateChartCaches = (chartXml: string, categories: string[], series: PresentationChartSeries[]): string => {
  const existingSeriesCount = [...chartXml.matchAll(/<c:ser>[\s\S]*?<\/c:ser>/g)].length;
  if (existingSeriesCount !== series.length) {
    throw new Error(`图表系列数量必须保持为 ${existingSeriesCount}，实际 ${series.length}`);
  }
  const existingPointCount = Number(chartXml.match(/<c:(?:cat|xVal)>[\s\S]*?<c:ptCount\b[^>]*\bval="(\d+)"/i)?.[1] ?? categories.length);
  if (existingPointCount !== categories.length) {
    throw new Error(`图表分类数量必须保持为 ${existingPointCount}，实际 ${categories.length}`);
  }
  if (series.some((item) => item.values.length !== categories.length)) {
    throw new Error('每个图表系列的数据长度必须与 categories 一致');
  }
  const points = (values: Array<string | number>, numeric: boolean) =>
    `<c:ptCount val="${values.length}"/>${values.map((value, index) =>
      `<c:pt idx="${index}"><c:v>${numeric ? Number(value) : xmlEscape(String(value))}</c:v></c:pt>`).join('')}`;
  let seriesIndex = 0;
  return chartXml.replace(/<c:ser>[\s\S]*?<\/c:ser>/g, (seriesXml) => {
    const data = series[seriesIndex++];
    if (!data) return seriesXml;
    let next = seriesXml.replace(/(<c:tx>[\s\S]*?<c:v>)[\s\S]*?(<\/c:v>)/i, `$1${xmlEscape(data.name)}$2`);
    next = next.replace(/(<c:(?:cat|xVal)>[\s\S]*?<c:(?:strCache|numCache)>)[\s\S]*?(<\/c:(?:strCache|numCache)>[\s\S]*?<\/c:(?:cat|xVal)>)/i,
      `$1${points(categories, false)}$2`);
    next = next.replace(/(<c:(?:val|yVal)>[\s\S]*?<c:numCache>)[\s\S]*?(<\/c:numCache>[\s\S]*?<\/c:(?:val|yVal)>)/i,
      `$1${points(data.values, true)}$2`);
    return next;
  });
};

const syncEmbeddedChartWorkbook = async (
  zip: any,
  chartPart: string,
  categories: string[],
  series: PresentationChartSeries[],
): Promise<boolean> => {
  const relPart = chartPart.replace(/\/([^/]+\.xml)$/i, '/_rels/$1.rels');
  const relXml = await zip.file(relPart)?.async('string');
  const rel = relXml ? relationships(relXml).find((item) => /\/package$/i.test(item.type)) : undefined;
  if (!rel) return false;
  const workbookPart = resolvePartTarget(chartPart, rel.target);
  const workbookBytes = await zip.file(workbookPart)?.async('uint8array');
  if (!workbookBytes) return false;
  const XLSX = await import('xlsx-js-style');
  const workbook = XLSX.read(workbookBytes, { type: 'array' });
  const sheetName = workbook.SheetNames[0] ?? 'Sheet1';
  const rows: Array<Array<string | number>> = [
    ['', ...series.map((item) => item.name)],
    ...categories.map((category, index) => [
      category,
      ...series.map((item) => item.values[index] ?? 0),
    ]),
  ];
  workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows);
  if (!workbook.SheetNames.length) workbook.SheetNames.push(sheetName);
  const output = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  zip.file(workbookPart, output);
  return true;
};

const editChart = async (
  zip: any,
  slideEntry: string,
  block: string,
  categories: string[],
  series: PresentationChartSeries[],
): Promise<boolean> => {
  const rid = block.match(/<c:chart\b[^>]*\br:id="([^"]+)"/i)?.[1];
  if (!rid) throw new Error('目标元素不是可编辑图表');
  const relEntry = relationFileForSlide(slideEntry);
  const relXml = await zip.file(relEntry)?.async('string');
  const rel = relXml ? relationships(relXml).find((item) => item.id === rid) : undefined;
  if (!rel) throw new Error('找不到图表关系');
  const chartPart = resolvePartTarget(slideEntry, rel.target);
  const chartXml = await zip.file(chartPart)?.async('string');
  if (!chartXml) throw new Error('找不到图表 XML');
  zip.file(chartPart, updateChartCaches(chartXml, categories, series));
  return syncEmbeddedChartWorkbook(zip, chartPart, categories, series);
};

const applyToSlideXml = (xml: string, located: ReturnType<typeof locateElement>, replacement: string): string =>
  `${xml.slice(0, located.start)}${replacement}${xml.slice(located.end)}`;

const updateSlideNotes = async (zip: any, slideEntry: string, notes: string): Promise<void> => {
  const relEntry = relationFileForSlide(slideEntry);
  const relXml = await zip.file(relEntry)?.async('string');
  const rel = relXml ? relationships(relXml).find((item) => /\/notesSlide$/i.test(item.type)) : undefined;
  if (!rel) throw new Error('该幻灯片没有备注页，当前只能安全修改已有备注');
  const notesPart = resolvePartTarget(slideEntry, rel.target);
  const notesXml = await zip.file(notesPart)?.async('string');
  if (!notesXml) throw new Error('找不到幻灯片备注 XML');
  const textElements = [...notesXml.matchAll(/<a:t(?:\s[^>]*)?>[\s\S]*?<\/a:t>/g)];
  if (!textElements.length) throw new Error('备注页没有可编辑文本块');
  let replaced = false;
  const next = notesXml.replace(/(<a:t(?:\s[^>]*)?>)[\s\S]*?(<\/a:t>)/g, (_all: string, open: string, close: string) => {
    if (replaced) return `${open}${close}`;
    replaced = true;
    return `${open}${xmlEscape(notes)}${close}`;
  });
  zip.file(notesPart, next);
};

const nextNumericSuffix = (names: string[], pattern: RegExp): number => Math.max(
  0,
  ...names.map((name) => Number(name.match(pattern)?.[1] ?? 0)),
) + 1;

const insertBeforeClosingTag = (xml: string, tag: string, fragment: string): string => {
  const marker = `</${tag}>`;
  const index = xml.lastIndexOf(marker);
  if (index < 0) throw new Error(`OOXML 缺少 ${tag} 结束标签`);
  return `${xml.slice(0, index)}${fragment}${xml.slice(index)}`;
};

const insertSlideElement = (slideXml: string, block: string, zIndex: number | undefined): string => {
  const blocks = [...slideXml.matchAll(ELEMENT_RE)];
  if (zIndex == null || zIndex >= blocks.length) return insertBeforeClosingTag(slideXml, 'p:spTree', block);
  const target = blocks[Math.max(0, zIndex)];
  if (!target || target.index == null) return insertBeforeClosingTag(slideXml, 'p:spTree', block);
  return `${slideXml.slice(0, target.index)}${block}${slideXml.slice(target.index)}`;
};

const ensureContentType = (xml: string, extension: string, contentType: string): string => {
  const exists = [...xml.matchAll(/<Default\b[^>]*\/?\s*>/gi)]
    .some((match) => attribute(match[0], 'Extension')?.toLowerCase() === extension.toLowerCase());
  return exists ? xml : insertBeforeClosingTag(xml, 'Types', `<Default Extension="${xmlEscape(extension)}" ContentType="${xmlEscape(contentType)}"/>`);
};

const ensurePartOverride = (xml: string, partName: string, contentType: string): string => {
  const exists = [...xml.matchAll(/<Override\b[^>]*\/?\s*>/gi)]
    .some((match) => attribute(match[0], 'PartName') === partName);
  return exists ? xml : insertBeforeClosingTag(xml, 'Types', `<Override PartName="${xmlEscape(partName)}" ContentType="${xmlEscape(contentType)}"/>`);
};

const nextRelationshipId = (xml: string): string => {
  const used = new Set(relationships(xml).map((rel) => rel.id));
  let index = 1;
  while (used.has(`rId${index}`)) index += 1;
  return `rId${index}`;
};

const addRelationship = (
  xml: string,
  type: string,
  target: string,
  targetMode?: string,
): { xml: string; id: string } => {
  const id = nextRelationshipId(xml);
  const mode = targetMode ? ` TargetMode="${xmlEscape(targetMode)}"` : '';
  return {
    id,
    xml: insertBeforeClosingTag(xml, 'Relationships', `<Relationship Id="${id}" Type="${xmlEscape(type)}" Target="${xmlEscape(target)}"${mode}/>`),
  };
};

const xfrmXml = (element: PresentationElement): string => {
  const x = Math.round((element.x ?? 0.75) * EMU_PER_INCH);
  const y = Math.round((element.y ?? 1.6) * EMU_PER_INCH);
  const cx = Math.round((element.w ?? 3) * EMU_PER_INCH);
  const cy = Math.round((element.h ?? 1) * EMU_PER_INCH);
  const rotate = element.rotate ? ` rot="${Math.round(element.rotate * 60000)}"` : '';
  return `<a:xfrm${rotate}><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;
};

const colorXml = (color: string | undefined, fallback: string, transparency?: number): string => {
  const normalized = (color ?? fallback).replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(normalized)) throw new Error(`无效颜色: ${color}`);
  const alpha = transparency == null ? '' : `<a:alpha val="${Math.round((100 - transparency) * 1000)}"/>`;
  return `<a:srgbClr val="${normalized}">${alpha}</a:srgbClr>`;
};

const textBodyXml = (element: PresentationElement, rootTag: 'p:txBody' | 'a:txBody' = 'p:txBody'): string => {
  const paragraph = (text: string, options?: { bold?: boolean; italic?: boolean; color?: string; bullet?: boolean; ordered?: boolean; level?: number }) => {
    const bullet = options?.bullet
      ? `${options.ordered ? '<a:buAutoNum type="arabicPeriod"/>' : '<a:buChar char="•"/>'}`
      : '';
    const align = element.align ? ` algn="${element.align === 'justify' ? 'just' : element.align[0]}"` : '';
    const paragraphProps = bullet || align ? `<a:pPr lvl="${Math.max(0, options?.level ?? 0)}"${align}>${bullet}</a:pPr>` : '';
    const bold = options?.bold ? ' b="1"' : '';
    const italic = options?.italic ? ' i="1"' : '';
    const size = Math.round((element.fontSize ?? 18) * 100);
    const color = colorXml(options?.color ?? element.color, '0F172A');
    const face = xmlEscape(element.fontFace ?? 'Noto Sans SC');
    return `<a:p>${paragraphProps}<a:r><a:rPr lang="zh-CN" sz="${size}"${bold}${italic}><a:solidFill>${color}</a:solidFill><a:latin typeface="${face}"/><a:ea typeface="${face}"/></a:rPr><a:t>${xmlEscape(text)}</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p>`;
  };
  let paragraphs: string;
  if (element.listItems?.length) {
    paragraphs = element.listItems.map((item) => paragraph(item.text, {
      bullet: true, ordered: item.ordered, level: item.level, bold: item.bold, color: item.color,
    })).join('');
  } else if (element.runs?.length) {
    const runs = element.runs.map((run) => {
      const size = Math.round((run.fontSize ?? element.fontSize ?? 18) * 100);
      const bold = run.bold ? ' b="1"' : '';
      const italic = run.italic ? ' i="1"' : '';
      const face = xmlEscape(element.fontFace ?? 'Noto Sans SC');
      const lineBreak = run.breakLine ? '<a:br/>' : '';
      return `${lineBreak}<a:r><a:rPr lang="zh-CN" sz="${size}"${bold}${italic}><a:solidFill>${colorXml(run.color ?? element.color, '0F172A')}</a:solidFill><a:latin typeface="${face}"/><a:ea typeface="${face}"/></a:rPr><a:t>${xmlEscape(run.text)}</a:t></a:r>`;
    }).join('');
    paragraphs = `<a:p>${runs}<a:endParaRPr lang="zh-CN"/></a:p>`;
  } else {
    paragraphs = (element.text ?? '').split('\n').map((line) => paragraph(line, {
      bullet: element.bullet, bold: element.bold, italic: element.italic,
    })).join('');
  }
  const anchor = ({ top: 't', middle: 'ctr', bottom: 'b' } as const)[element.valign ?? 'top'];
  const inset = Math.round((element.margin ?? 0.04) * EMU_PER_INCH);
  return `<${rootTag}><a:bodyPr wrap="square" anchor="${anchor}" lIns="${inset}" rIns="${inset}" tIns="${inset}" bIns="${inset}"/><a:lstStyle/>${paragraphs || '<a:p><a:endParaRPr lang="zh-CN"/></a:p>'}</${rootTag}>`;
};

const shapePropertiesXml = (element: PresentationElement): string => {
  const shapeType = element.type === 'line' ? 'line' : (element.shapeType ?? 'rect');
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(shapeType)) throw new Error(`无效形状类型: ${shapeType}`);
  const dash = ({ solid: 'solid', dash: 'dash', dot: 'sysDot' } as const)[element.dash ?? 'solid'];
  const begin = element.beginArrowType ? `<a:headEnd type="${xmlEscape(element.beginArrowType)}"/>` : '';
  const end = element.endArrowType ? `<a:tailEnd type="${xmlEscape(element.endArrowType)}"/>` : '';
  const fill = element.type === 'line' || element.type === 'text'
    ? '<a:noFill/>'
    : `<a:solidFill>${colorXml(element.fill, 'FFFFFF', element.transparency)}</a:solidFill>`;
  const line = element.type === 'text'
    ? '<a:ln><a:noFill/></a:ln>'
    : `<a:ln w="${Math.round((element.lineWidth ?? 1) * 12700)}"><a:solidFill>${colorXml(element.lineColor, '64748B')}</a:solidFill><a:prstDash val="${dash}"/>${begin}${end}</a:ln>`;
  return `<p:spPr>${xfrmXml(element)}<a:prstGeom prst="${shapeType}"><a:avLst/></a:prstGeom>${fill}${line}</p:spPr>`;
};

const tableXml = (element: PresentationElement): string => {
  if (!element.rows?.length) throw new Error('新增表格元素缺少 rows');
  const cols = Math.max(...element.rows.map((row) => row.length));
  if (!cols) throw new Error('新增表格至少需要一列');
  const width = Math.round((element.w ?? 3) * EMU_PER_INCH);
  const colWidths = element.columnWidths?.length === cols
    ? element.columnWidths.map((value) => Math.round(value * EMU_PER_INCH))
    : Array.from({ length: cols }, () => Math.floor(width / cols));
  const grid = colWidths.map((value) => `<a:gridCol w="${value}"/>`).join('');
  const rows = element.rows.map((row) => {
    const cells = Array.from({ length: cols }, (_, index) => row[index] ?? '').map((raw) => {
      const cell = typeof raw === 'string' ? { text: raw } : raw;
      const spans = `${cell.rowSpan ? ` rowSpan="${cell.rowSpan}"` : ''}${cell.colSpan ? ` gridSpan="${cell.colSpan}"` : ''}`;
      return `<a:tc${spans}>${textBodyXml({ ...element, type: 'text', text: cell.text, color: cell.color, bold: cell.bold }, 'a:txBody')}<a:tcPr><a:solidFill>${colorXml(cell.fill ?? element.fill, 'FFFFFF')}</a:solidFill></a:tcPr></a:tc>`;
    }).join('');
    return `<a:tr h="${Math.round(((element.h ?? 1) / element.rows!.length) * EMU_PER_INCH)}">${cells}</a:tr>`;
  }).join('');
  return `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic>`;
};

const imageMime: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
};

const serializeAddedElement = async (
  zip: any,
  slideEntry: string,
  slideXml: string,
  element: PresentationElement,
): Promise<{ slideXml: string; relationXml?: string; contentTypesXml?: string }> => {
  if (element.type === 'chart') throw new Error('既有 PPT 暂不支持新增图表；请在 writePresentation 新建/重建时添加');
  if (element.hyperlink || element.runs?.some((run) => run.hyperlink)) {
    throw new Error('既有 PPT 新增元素暂不支持超链接关系；请在 writePresentation 新建/重建时添加');
  }
  const maxShapeId = Math.max(1, ...[...slideXml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/gi)].map((match) => Number(match[1])));
  const shapeId = maxShapeId + 1;
  const name = xmlEscape(presentationElementObjectName(element) ?? `${element.type} ${shapeId}`);
  let block: string;
  let relationXml: string | undefined;
  let contentTypesXml: string | undefined;
  if (element.type === 'image') {
    if (!element.path) throw new Error('新增图片元素缺少 path');
    const ext = element.path.split('.').pop()?.toLowerCase() ?? '';
    const mime = imageMime[ext];
    if (!mime) throw new Error(`不支持的 PPT 图片格式: ${element.path}`);
    const relEntry = relationFileForSlide(slideEntry);
    relationXml = await zip.file(relEntry)?.async('string') ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const mediaNumber = nextNumericSuffix(Object.keys(zip.files), /^ppt\/media\/image(\d+)\.[^.]+$/i);
    const mediaPart = `ppt/media/image${mediaNumber}.${ext}`;
    zip.file(mediaPart, await workspace.readFileBytes(element.path));
    const added = addRelationship(relationXml!, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', `../media/image${mediaNumber}.${ext}`);
    relationXml = added.xml;
    const contentTypes = await zip.file('[Content_Types].xml')?.async('string');
    if (!contentTypes) throw new Error('PPT 缺少 [Content_Types].xml');
    contentTypesXml = ensureContentType(contentTypes, ext, mime);
    const description = element.alt ? ` descr="${xmlEscape(element.alt)}"` : '';
    const alpha = element.transparency == null ? '' : `<a:alphaModFix amt="${Math.round((100 - element.transparency) * 1000)}"/>`;
    block = `<p:pic><p:nvPicPr><p:cNvPr id="${shapeId}" name="${name}"${description}/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${added.id}">${alpha}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrmXml(element)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  } else if (element.type === 'table') {
    block = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${shapeId}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm>${xfrmXml(element).replace(/^<a:xfrm[^>]*>|<\/a:xfrm>$/g, '')}</p:xfrm>${tableXml(element)}</p:graphicFrame>`;
  } else if (element.type === 'line') {
    block = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${shapeId}" name="${name}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>${shapePropertiesXml(element)}</p:cxnSp>`;
  } else {
    const text = element.type === 'text' || element.text || element.runs?.length || element.listItems?.length
      ? textBodyXml(element)
      : '';
    block = `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="${name}"/><p:cNvSpPr${element.type === 'text' ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>${shapePropertiesXml(element)}${text}</p:sp>`;
  }
  return { slideXml: insertSlideElement(slideXml, block, element.zIndex), relationXml, contentTypesXml };
};

const slideIdTags = (presentationXml: string): string[] => {
  const list = presentationXml.match(/<p:sldIdLst\b[^>]*>([\s\S]*?)<\/p:sldIdLst>/i)?.[1];
  if (list == null) throw new Error('PPT 缺少幻灯片列表');
  return [...list.matchAll(/<p:sldId\b[^>]*\/?\s*>/gi)].map((match) => match[0]);
};

const replaceSlideIdTags = (presentationXml: string, tags: string[]): string =>
  presentationXml.replace(/(<p:sldIdLst\b[^>]*>)[\s\S]*?(<\/p:sldIdLst>)/i, `$1${tags.join('')}$2`);

const addPresentationSlideReference = async (
  zip: any,
  slidePart: string,
  insertAt: number,
): Promise<void> => {
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  if (!presentationXml || !relsXml) throw new Error('PPT 缺少演示文稿关系');
  const added = addRelationship(
    relsXml,
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
    slidePart.replace(/^ppt\//, ''),
  );
  const tags = slideIdTags(presentationXml);
  const maxId = Math.max(255, ...tags.map((tag) => Number(attribute(tag, 'id') ?? 0)));
  tags.splice(Math.max(0, Math.min(tags.length, insertAt - 1)), 0, `<p:sldId id="${maxId + 1}" r:id="${added.id}"/>`);
  zip.file('ppt/presentation.xml', replaceSlideIdTags(presentationXml, tags));
  zip.file('ppt/_rels/presentation.xml.rels', added.xml);
};

const removeSlide = async (zip: any, slideIndex: number, entries: string[]): Promise<void> => {
  if (entries.length <= 1) throw new Error('PPT 至少保留一页幻灯片');
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  const contentTypes = await zip.file('[Content_Types].xml')?.async('string');
  if (!presentationXml || !relsXml || !contentTypes) throw new Error('PPT 核心关系不完整');
  const tags = slideIdTags(presentationXml);
  const removedTag = tags[slideIndex - 1];
  const rid = removedTag ? attribute(removedTag, 'r:id') : undefined;
  if (!rid) throw new Error(`找不到第 ${slideIndex} 页的关系 ID`);
  tags.splice(slideIndex - 1, 1);
  const rel = relationships(relsXml).find((item) => item.id === rid);
  if (!rel) throw new Error(`找不到第 ${slideIndex} 页的关系`);
  const slidePart = resolvePartTarget('ppt/presentation.xml', rel.target);
  zip.file('ppt/presentation.xml', replaceSlideIdTags(presentationXml, tags));
  zip.file('ppt/_rels/presentation.xml.rels', relsXml.replace(rel.tag, ''));
  zip.file('[Content_Types].xml', contentTypes.replace(
    /<Override\b[^>]*\/?\s*>/gi,
    (tag: string) => attribute(tag, 'PartName') === `/${slidePart}` ? '' : tag,
  ));
  zip.remove(slidePart);
  zip.remove(relationFileForSlide(slidePart));
};

const moveSlide = async (zip: any, slideIndex: number, targetSlideIndex: number): Promise<void> => {
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presentationXml) throw new Error('PPT 缺少 presentation.xml');
  const tags = slideIdTags(presentationXml);
  if (targetSlideIndex < 1 || targetSlideIndex > tags.length) throw new Error('moveSlide 的 targetSlideIndex 无效');
  const [tag] = tags.splice(slideIndex - 1, 1);
  if (!tag) throw new Error(`幻灯片不存在: ${slideIndex}`);
  tags.splice(targetSlideIndex - 1, 0, tag);
  zip.file('ppt/presentation.xml', replaceSlideIdTags(presentationXml, tags));
};

const cloneSlideChartParts = async (zip: any, sourceSlidePart: string, relsXml: string): Promise<string> => {
  let nextRels = relsXml;
  let contentTypes = await zip.file('[Content_Types].xml')?.async('string');
  if (!contentTypes) throw new Error('PPT 缺少 [Content_Types].xml');
  for (const rel of relationships(relsXml).filter((item) => /\/chart$/i.test(item.type))) {
    const sourceChartPart = resolvePartTarget(sourceSlidePart, rel.target);
    const chartXml = await zip.file(sourceChartPart)?.async('string');
    if (!chartXml) throw new Error(`复制页引用的图表部件不存在: ${sourceChartPart}`);
    const chartNumber = nextNumericSuffix(Object.keys(zip.files), /^ppt\/charts\/chart(\d+)\.xml$/i);
    const chartPart = `ppt/charts/chart${chartNumber}.xml`;
    zip.file(chartPart, chartXml);
    const sourceChartRelsPart = sourceChartPart.replace(/\/([^/]+\.xml)$/i, '/_rels/$1.rels');
    const chartRels = await zip.file(sourceChartRelsPart)?.async('string');
    if (chartRels) {
      let nextChartRels = chartRels;
      for (const packageRel of relationships(chartRels).filter((item) => /\/package$/i.test(item.type))) {
        const sourceWorkbook = resolvePartTarget(sourceChartPart, packageRel.target);
        const workbookBytes = await zip.file(sourceWorkbook)?.async('uint8array');
        if (!workbookBytes) continue;
        const ext = sourceWorkbook.split('.').pop()?.toLowerCase() ?? 'xlsx';
        const workbookNumber = nextNumericSuffix(Object.keys(zip.files), /^ppt\/embeddings\/[A-Za-z_-]*(\d+)\.[^.]+$/i);
        const workbookPart = `ppt/embeddings/embeddedWorkbook${workbookNumber}.${ext}`;
        zip.file(workbookPart, workbookBytes);
        const updatedPackageTag = packageRel.tag.replace(/\bTarget="[^"]*"/i, `Target="../embeddings/embeddedWorkbook${workbookNumber}.${ext}"`);
        nextChartRels = nextChartRels.replace(packageRel.tag, updatedPackageTag);
      }
      zip.file(chartPart.replace(/\/([^/]+\.xml)$/i, '/_rels/$1.rels'), nextChartRels);
    }
    contentTypes = ensurePartOverride(
      contentTypes,
      `/${chartPart}`,
      'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
    );
    const updatedChartTag = rel.tag.replace(/\bTarget="[^"]*"/i, `Target="../charts/chart${chartNumber}.xml"`);
    nextRels = nextRels.replace(rel.tag, updatedChartTag);
  }
  zip.file('[Content_Types].xml', contentTypes);
  return nextRels;
};

const duplicateSlide = async (
  zip: any,
  slideIndex: number,
  targetSlideIndex: number | undefined,
  entries: string[],
): Promise<void> => {
  const sourcePart = entries[slideIndex - 1];
  const sourceXml = await zip.file(sourcePart)?.async('string');
  if (!sourceXml) throw new Error(`幻灯片不存在: ${slideIndex}`);
  const sourceRelPart = relationFileForSlide(sourcePart);
  const sourceRels = await zip.file(sourceRelPart)?.async('string');
  if (sourceRels && relationships(sourceRels).some((rel) => /\/(?:notesSlide|comments|threadedComment)$/i.test(rel.type))) {
    throw new Error('含备注或批注的幻灯片暂不能安全复制；原文件未修改');
  }
  const slideNumber = nextNumericSuffix(Object.keys(zip.files), /^ppt\/slides\/slide(\d+)\.xml$/i);
  const slidePart = `ppt/slides/slide${slideNumber}.xml`;
  zip.file(slidePart, sourceXml);
  if (sourceRels) {
    zip.file(relationFileForSlide(slidePart), await cloneSlideChartParts(zip, sourcePart, sourceRels));
  }
  const contentTypes = await zip.file('[Content_Types].xml')?.async('string');
  if (!contentTypes) throw new Error('PPT 缺少 [Content_Types].xml');
  zip.file('[Content_Types].xml', ensurePartOverride(
    contentTypes,
    `/${slidePart}`,
    'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  ));
  await addPresentationSlideReference(zip, slidePart, targetSlideIndex ?? slideIndex + 1);
};

const createSlide = async (
  zip: any,
  slide: PresentationSlide,
  insertAt: number,
  entries: string[],
): Promise<void> => {
  if (!entries.length) throw new Error('无法在缺少现有母版/版式的 PPT 中新增页面');
  if (slide.notes?.trim()) throw new Error('editPresentation 新增页面暂不支持同时创建备注页');
  const scene = buildPresentationScene({ version: 2, slides: [{ ...slide, layout: slide.layout ?? 'content' }] });
  const unsupported = scene.slides[0].elements.find((element) => element.type === 'chart');
  if (unsupported) throw new Error('editPresentation 新增页面暂不支持图表；请用 writePresentation 完整重建');
  const sourceRelPart = relationFileForSlide(entries[0]);
  const sourceRels = await zip.file(sourceRelPart)?.async('string');
  const layoutRel = sourceRels ? relationships(sourceRels).find((rel) => /\/slideLayout$/i.test(rel.type)) : undefined;
  if (!layoutRel) throw new Error('PPT 缺少可复用的幻灯片版式关系');
  const slideNumber = nextNumericSuffix(Object.keys(zip.files), /^ppt\/slides\/slide(\d+)\.xml$/i);
  const slidePart = `ppt/slides/slide${slideNumber}.xml`;
  let slideXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
    + '<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  let relXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  relXml = addRelationship(relXml, layoutRel.type, layoutRel.target).xml;
  zip.file(slidePart, slideXml);
  zip.file(relationFileForSlide(slidePart), relXml);
  for (const element of scene.slides[0].elements) {
    const serialized = await serializeAddedElement(zip, slidePart, slideXml, element);
    slideXml = serialized.slideXml;
    if (serialized.relationXml) zip.file(relationFileForSlide(slidePart), serialized.relationXml);
    if (serialized.contentTypesXml) zip.file('[Content_Types].xml', serialized.contentTypesXml);
  }
  zip.file(slidePart, slideXml);
  const contentTypes = await zip.file('[Content_Types].xml')?.async('string');
  if (!contentTypes) throw new Error('PPT 缺少 [Content_Types].xml');
  zip.file('[Content_Types].xml', ensurePartOverride(
    contentTypes,
    `/${slidePart}`,
    'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  ));
  await addPresentationSlideReference(zip, slidePart, insertAt);
};

export const validatePresentationPackage = async (bytes: Uint8Array): Promise<void> => {
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(bytes);
  if (!zip.file('[Content_Types].xml') || !zip.file('ppt/presentation.xml')) {
    throw new Error('生成后的 PPTX 包缺少核心 OOXML 部件');
  }
  const entries = await slideEntries(zip);
  if (!entries.length || entries.some((entry) => !zip.file(entry))) {
    throw new Error('生成后的 PPTX 包包含无效幻灯片关系');
  }
  // 检查所有内部关系，避免模板克隆或资源替换留下悬空 rId。
  for (const relsEntry of Object.keys(zip.files).filter((name) => /\/_rels\/[^/]+\.rels$/i.test(name))) {
    const xml = await zip.file(relsEntry)?.async('string') ?? '';
    const owner = relsEntry.replace(/\/_rels\/([^/]+)\.rels$/i, '/$1');
    for (const rel of relationships(xml)) {
      if (rel.targetMode === 'External' || rel.target.startsWith('#')) continue;
      const target = resolvePartTarget(owner, rel.target);
      if (!zip.file(target)) throw new Error(`生成后的 PPTX 关系悬空: ${relsEntry} -> ${rel.target}`);
    }
  }
};

const packageDir = (part: string): string => part.includes('/') ? part.slice(0, part.lastIndexOf('/')) : '';
const relativePackageTarget = (fromPart: string, toPart: string): string => {
  const from = packageDir(fromPart).split('/').filter(Boolean);
  const to = toPart.split('/').filter(Boolean);
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return `${'../'.repeat(from.length)}${to.join('/')}` || './';
};

const relationPartFor = (part: string): string => {
  const dir = packageDir(part);
  const file = part.slice(dir.length ? dir.length + 1 : 0);
  return `${dir ? `${dir}/` : ''}_rels/${file}.rels`;
};

const uniqueImportedPart = (zip: any, sourcePart: string): string => {
  const dir = packageDir(sourcePart);
  const file = sourcePart.slice(dir.length ? dir.length + 1 : 0);
  const dot = file.lastIndexOf('.');
  const stem = dot >= 0 ? file.slice(0, dot) : file;
  const ext = dot >= 0 ? file.slice(dot) : '';
  let index = 1;
  let candidate = `${dir ? `${dir}/` : ''}${stem}-cottage-${index}${ext}`;
  while (zip.file(candidate)) {
    index += 1;
    candidate = `${dir ? `${dir}/` : ''}${stem}-cottage-${index}${ext}`;
  }
  return candidate;
};

const contentTypeForPart = (contentTypes: string, part: string): string => {
  const override = [...contentTypes.matchAll(/<Override\b[^>]*\/>/gi)]
    .find((match) => attribute(match[0], 'PartName') === `/${part}`);
  if (override) return attribute(override[0], 'ContentType') ?? 'application/octet-stream';
  const ext = part.split('.').pop()?.toLowerCase() ?? '';
  const fallback = [...contentTypes.matchAll(/<Default\b[^>]*\/>/gi)]
    .find((match) => attribute(match[0], 'Extension')?.toLowerCase() === ext);
  return fallback ? attribute(fallback[0], 'ContentType') ?? 'application/octet-stream' : 'application/octet-stream';
};

const rewriteRelationshipTarget = (tag: string, target: string): string =>
  tag.replace(/\bTarget="[^"]*"/i, `Target="${xmlEscape(target)}"`);

type ImportPartContext = {
  map: Map<string, string>;
  sourceContentTypes: string;
  destinationSlidePart: string;
};

const importPartGraph = async (
  sourceZip: any,
  destinationZip: any,
  sourcePart: string,
  context: ImportPartContext,
): Promise<string> => {
  const existing = context.map.get(sourcePart);
  if (existing) return existing;
  const file = sourceZip.file(sourcePart);
  if (!file) throw new Error(`导入 PPT 模板时缺少资源部件: ${sourcePart}`);
  const destinationPart = uniqueImportedPart(destinationZip, sourcePart);
  context.map.set(sourcePart, destinationPart);
  destinationZip.file(destinationPart, await file.async('uint8array'));
  let destinationContentTypes = await destinationZip.file('[Content_Types].xml')?.async('string');
  if (!destinationContentTypes) throw new Error('模板缺少 [Content_Types].xml');
  destinationContentTypes = ensurePartOverride(
    destinationContentTypes,
    `/${destinationPart}`,
    contentTypeForPart(context.sourceContentTypes, sourcePart),
  );
  destinationZip.file('[Content_Types].xml', destinationContentTypes);

  const sourceRelsPart = relationPartFor(sourcePart);
  const sourceRels = await sourceZip.file(sourceRelsPart)?.async('string');
  if (!sourceRels) return destinationPart;
  let destinationRels = sourceRels;
  for (const rel of relationships(sourceRels)) {
    if (rel.targetMode === 'External') continue;
    if (/\/slide$/i.test(rel.type) && /notesSlide/i.test(sourcePart)) {
      destinationRels = destinationRels.replace(
        rel.tag,
        rewriteRelationshipTarget(rel.tag, relativePackageTarget(destinationPart, context.destinationSlidePart)),
      );
      continue;
    }
    const childSource = resolvePartTarget(sourcePart, rel.target);
    if (!sourceZip.file(childSource)) continue;
    const childDestination = await importPartGraph(sourceZip, destinationZip, childSource, context);
    destinationRels = destinationRels.replace(
      rel.tag,
      rewriteRelationshipTarget(rel.tag, relativePackageTarget(destinationPart, childDestination)),
    );
  }
  destinationZip.file(relationPartFor(destinationPart), destinationRels);
  return destinationPart;
};

const templateLayoutPart = async (zip: any, slidePart: string): Promise<string> => {
  const rels = await zip.file(relationFileForSlide(slidePart))?.async('string') ?? '';
  const layout = relationships(rels).find((rel) => /\/slideLayout$/i.test(rel.type));
  if (!layout) throw new Error(`模板页面缺少版式关系: ${slidePart}`);
  return resolvePartTarget(slidePart, layout.target);
};

const preservedTemplateBlocks = (xml: string): string[] => [...xml.matchAll(ELEMENT_RE)]
  .map((match) => ({ kind: match[1], block: match[0], meta: shapeMeta(match[0]) }))
  .filter(({ kind, block, meta }) => {
    if (/<p:ph\b/i.test(block)) return false;
    const text = extractTexts(block).join('').trim();
    if (meta.shapeId && new RegExp(`\\bspid="${meta.shapeId}"`, 'i').test(xml)) return true;
    if (kind === 'grpSp') return true;
    if (kind === 'graphicFrame' && !/<a:tbl\b|<c:chart\b/i.test(block)) return true;
    if (kind === 'pic' && /<(?:p14:media|a:videoFile|a:audioFile|p:oleObj)\b/i.test(block)) return true;
    if (kind === 'sp' && !text) return true;
    if (kind === 'pic' && /(?:logo|brand|header|footer|background|decoration|watermark)/i.test(meta.name)) return true;
    return false;
  })
  .map((item) => item.block);

const nextRelationshipIdNumeric = (xml: string): string => {
  const max = Math.max(0, ...relationships(xml).map((rel) => Number(rel.id.match(/(\d+)$/)?.[1] ?? 0)));
  return `rId${max + 1}`;
};

const mergeTemplateDecorations = (
  generatedSlideXml: string,
  generatedRelsXml: string,
  templateSlideXml: string,
  templateRelsXml: string,
): { slideXml: string; relsXml: string } => {
  let slideXml = generatedSlideXml;
  let relsXml = generatedRelsXml;
  let maxShapeId = Math.max(1, ...[...slideXml.matchAll(/<p:cNvPr\b[^>]*\bid="(\d+)"/gi)].map((match) => Number(match[1])));
  const templateRelMap = new Map(relationships(templateRelsXml).map((rel) => [rel.id, rel]));
  const blocks: string[] = [];
  const shapeIdMap = new Map<string, string>();
  for (let block of preservedTemplateBlocks(templateSlideXml)) {
    const oldShapeId = shapeMeta(block).shapeId;
    maxShapeId += 1;
    if (oldShapeId) shapeIdMap.set(oldShapeId, String(maxShapeId));
    block = block.replace(/(<p:cNvPr\b[^>]*\bid=")\d+("[^>]*>)/i, `$1${maxShapeId}$2`);
    const relationIds = new Set([...block.matchAll(/\br:(?:id|embed|link)="([^"]+)"/gi)].map((match) => match[1]));
    for (const oldId of relationIds) {
      const rel = templateRelMap.get(oldId);
      if (!rel) continue;
      const newId = nextRelationshipIdNumeric(relsXml);
      block = block.replace(new RegExp(`(\\br:(?:id|embed|link)=")${oldId}(")`, 'g'), `$1${newId}$2`);
      const newTag = rel.tag.replace(/\bId="[^"]*"/i, `Id="${newId}"`);
      relsXml = relsXml.replace(/<\/Relationships>\s*$/i, `${newTag}</Relationships>`);
    }
    blocks.push(block);
  }
  if (blocks.length) {
    slideXml = slideXml.replace(/(<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>)/i, `$1${blocks.join('')}`);
  }
  const transition = templateSlideXml.match(/<p:transition\b[\s\S]*?<\/p:transition>|<p:transition\b[^>]*\/>/i)?.[0];
  if (transition) slideXml = slideXml.replace(/<\/p:sld>\s*$/i, `${transition}</p:sld>`);
  let timing = templateSlideXml.match(/<p:timing\b[\s\S]*?<\/p:timing>/i)?.[0];
  if (timing) {
    const referenced = new Set([...timing.matchAll(/\bspid="(\d+)"/gi)].map((match) => match[1]));
    if ([...referenced].every((id) => shapeIdMap.has(id))) {
      for (const [oldId, newId] of shapeIdMap) timing = timing.replace(new RegExp(`(\\bspid=")${oldId}(")`, 'g'), `$1${newId}$2`);
      slideXml = slideXml.replace(/<\/p:sld>\s*$/i, `${timing}</p:sld>`);
    }
  }
  const templateBackground = templateSlideXml.match(/<p:bg>[\s\S]*?<\/p:bg>/i)?.[0];
  if (templateBackground) {
    if (/<p:bg>[\s\S]*?<\/p:bg>/i.test(slideXml)) slideXml = slideXml.replace(/<p:bg>[\s\S]*?<\/p:bg>/i, templateBackground);
    else slideXml = slideXml.replace(/(<p:cSld\b[^>]*>)/i, `$1${templateBackground}`);
  }
  return { slideXml, relsXml };
};

/**
 * 以模板 OOXML 包为底座导入 PptxGenJS 已生成的原生页面。模板的 master、
 * layout、theme 与未知复杂部件不重建；新页面资源按关系图复制并重新命名。
 */
export const applyNativePresentationTemplate = async (
  templateBytes: Uint8Array,
  generatedBytes: Uint8Array,
  templateSlideIndices: number[],
): Promise<{ bytes: Uint8Array; preservedDecorationCount: number }> => {
  const JSZip = await getJSZip();
  const destination = await JSZip.loadAsync(templateBytes);
  const source = await JSZip.loadAsync(generatedBytes);
  const templateEntries = await slideEntries(destination);
  const generatedEntries = await slideEntries(source);
  if (!templateEntries.length) throw new Error('native-template 模板没有可复用页面');
  if (generatedEntries.length !== templateSlideIndices.length) throw new Error('native-template 页面映射数量不一致');
  const sourceContentTypes = await source.file('[Content_Types].xml')?.async('string');
  if (!sourceContentTypes) throw new Error('生成文稿缺少 [Content_Types].xml');
  let preservedDecorationCount = 0;

  for (let index = 0; index < generatedEntries.length; index += 1) {
    const templateIndex = templateSlideIndices[index];
    const templatePart = templateEntries[templateIndex - 1];
    if (!templatePart) throw new Error(`模板页面不存在: ${templateIndex}`);
    const layoutPart = await templateLayoutPart(destination, templatePart);
    const templateSlideXml = await destination.file(templatePart)?.async('string') ?? '';
    const templateRelsXml = await destination.file(relationFileForSlide(templatePart))?.async('string') ?? '';
    let slideXml = await source.file(generatedEntries[index])?.async('string') ?? '';
    const sourceRels = await source.file(relationFileForSlide(generatedEntries[index]))?.async('string')
      ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const destinationSlideNumber = nextNumericSuffix(Object.keys(destination.files), /^ppt\/slides\/slide(\d+)\.xml$/i);
    const destinationSlidePart = `ppt/slides/slide${destinationSlideNumber}.xml`;
    const sourceLayoutRel = relationships(sourceRels).find((rel) => /\/slideLayout$/i.test(rel.type));
    let relsXml = sourceRels;
    if (sourceLayoutRel) {
      relsXml = relsXml.replace(
        sourceLayoutRel.tag,
        rewriteRelationshipTarget(sourceLayoutRel.tag, relativePackageTarget(destinationSlidePart, layoutPart)),
      );
    } else {
      relsXml = addRelationship(
        relsXml,
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
        relativePackageTarget(destinationSlidePart, layoutPart),
      ).xml;
    }
    const context: ImportPartContext = {
      map: new Map(), sourceContentTypes, destinationSlidePart,
    };
    for (const rel of relationships(sourceRels)) {
      if (/\/slideLayout$/i.test(rel.type) || rel.targetMode === 'External') continue;
      const sourcePart = resolvePartTarget(generatedEntries[index], rel.target);
      if (!source.file(sourcePart)) continue;
      const importedPart = await importPartGraph(source, destination, sourcePart, context);
      const current = relationships(relsXml).find((candidate) => candidate.id === rel.id);
      if (current) relsXml = relsXml.replace(
        current.tag,
        rewriteRelationshipTarget(current.tag, relativePackageTarget(destinationSlidePart, importedPart)),
      );
    }
    const decorationBlocks = preservedTemplateBlocks(templateSlideXml);
    preservedDecorationCount += decorationBlocks.length;
    const merged = mergeTemplateDecorations(slideXml, relsXml, templateSlideXml, templateRelsXml);
    slideXml = merged.slideXml;
    relsXml = merged.relsXml;
    destination.file(destinationSlidePart, slideXml);
    destination.file(relationFileForSlide(destinationSlidePart), relsXml);
    let contentTypes = await destination.file('[Content_Types].xml')?.async('string');
    if (!contentTypes) throw new Error('模板缺少 [Content_Types].xml');
    contentTypes = ensurePartOverride(
      contentTypes,
      `/${destinationSlidePart}`,
      'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
    );
    destination.file('[Content_Types].xml', contentTypes);
    await addPresentationSlideReference(destination, destinationSlidePart, templateEntries.length + index + 1);
  }

  for (let index = 0; index < templateEntries.length; index += 1) {
    const entries = await slideEntries(destination);
    await removeSlide(destination, 1, entries);
  }
  const core = await source.file('docProps/core.xml')?.async('uint8array');
  if (core) destination.file('docProps/core.xml', core);
  const output = await destination.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  await validatePresentationPackage(output);
  return { bytes: output, preservedDecorationCount };
};

export const editPresentationOoxml = async (
  path: string,
  operations: PresentationEditOperation[],
): Promise<{ path: string; edited: true; operationCount: number; warnings: string[] }> => {
  const bytes = await workspace.readFileBytes(path);
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(bytes);
  let entries = await slideEntries(zip);
  const warnings: string[] = [];

  for (const operation of operations) {
    if (operation.op === 'addSlide') {
      const insertAt = operation.slideIndex ?? entries.length + 1;
      if (insertAt < 1 || insertAt > entries.length + 1 || !operation.slide) {
        throw new Error('addSlide 需要 slide，slideIndex 须为有效插入位置');
      }
      await createSlide(zip, operation.slide, insertAt, entries);
      entries = await slideEntries(zip);
      continue;
    }
    if (!operation.slideIndex || operation.slideIndex < 1 || operation.slideIndex > entries.length) {
      throw new Error(`编辑操作 ${operation.op} 的 slideIndex 无效`);
    }
    if (operation.op === 'removeSlide') {
      await removeSlide(zip, operation.slideIndex, entries);
      entries = await slideEntries(zip);
      continue;
    }
    if (operation.op === 'moveSlide') {
      if (!operation.targetSlideIndex) throw new Error('moveSlide 缺少 targetSlideIndex');
      await moveSlide(zip, operation.slideIndex, operation.targetSlideIndex);
      entries = await slideEntries(zip);
      continue;
    }
    if (operation.op === 'duplicateSlide') {
      await duplicateSlide(zip, operation.slideIndex, operation.targetSlideIndex, entries);
      entries = await slideEntries(zip);
      continue;
    }
    const slideEntry = entries[operation.slideIndex - 1];
    let xml = await zip.file(slideEntry)!.async('string');
    if (operation.op === 'updateSlideNotes') {
      await updateSlideNotes(zip, slideEntry, operation.notes ?? '');
      continue;
    }
    if (operation.op === 'addElement') {
      if (!operation.element) throw new Error('addElement 缺少 element');
      const normalized = buildPresentationScene({ version: 2, slides: [{ layout: 'blank', elements: [operation.element] }] })
        .slides[0].elements[0];
      const serialized = await serializeAddedElement(zip, slideEntry, xml, normalized);
      zip.file(slideEntry, serialized.slideXml);
      if (serialized.relationXml) zip.file(relationFileForSlide(slideEntry), serialized.relationXml);
      if (serialized.contentTypesXml) zip.file('[Content_Types].xml', serialized.contentTypesXml);
      continue;
    }
    const located = locateElement(xml, operation.elementId);
    const previewType = elementType(located.block.match(/^<p:(\w+)/)?.[1] ?? '', located.block);
    if (previewType === 'group' || previewType === 'unsupported') {
      throw new Error(`元素 ${operation.elementId} 属于只读对象，已保留原件`);
    }
    if (operation.op === 'removeElement') {
      const shapeId = shapeIdFromElementId(operation.elementId);
      if (new RegExp(`\\bspid="${shapeId}"`, 'i').test(xml)) {
        throw new Error(`元素 ${operation.elementId} 被动画引用，不能在保留动画的同时删除`);
      }
      xml = applyToSlideXml(xml, located, '');
      zip.file(slideEntry, xml);
      continue;
    }
    if (operation.op === 'replaceImage') {
      if (!operation.imagePath) throw new Error('replaceImage 缺少 imagePath');
      await replaceImage(zip, slideEntry, located.block, operation.imagePath);
      continue;
    }
    if (operation.op === 'updateTable') {
      if (previewType !== 'table' || !operation.rows) throw new Error('updateTable 需要表格目标和 rows');
      const replacement = replaceSequentialTexts(located.block, tableTexts(operation.rows));
      zip.file(slideEntry, applyToSlideXml(xml, located, replacement));
      continue;
    }
    if (operation.op === 'updateChartData') {
      if (previewType !== 'chart' || !operation.categories || !operation.series?.length) {
        throw new Error('updateChartData 需要图表目标、categories 和 series');
      }
      const synced = await editChart(zip, slideEntry, located.block, operation.categories, operation.series);
      if (!synced) warnings.push('图表显示缓存已更新；该图表没有可同步的嵌入工作簿');
      continue;
    }
    if (operation.op === 'updateElement') {
      const patch = operation.patch ?? {};
      const replacement = updateElementBlock(located.block, patch);
      let nextXml = applyToSlideXml(xml, located, replacement);
      if (patch.zIndex !== undefined) {
        const moved = locateElement(nextXml, operation.elementId);
        nextXml = insertSlideElement(applyToSlideXml(nextXml, moved, ''), moved.block, patch.zIndex);
      }
      zip.file(slideEntry, nextXml);
    }
  }

  const output = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  await validatePresentationPackage(output);
  // 在所有操作成功后才触发一次工作区写入，避免半完成文档。
  await workspace.writeFileBytes(path, output);
  return { path, edited: true, operationCount: operations.length, warnings };
};
