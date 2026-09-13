import { workspace } from '../../workspace/FileSystemWorkspace';

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

export type PresentationProfileZone = {
  x: number;
  y: number;
  w: number;
  h: number;
  slideIndex?: number;
};

export type PresentationStyleProfile = {
  slideWidth: number;
  slideHeight: number;
  orientation: 'landscape' | 'portrait' | 'square';
  themeFonts: string[];
  themeColors: string[];
  chartColors: string[];
  masters: Array<{ path: string; name: string; layoutCount: number }>;
  layouts: Array<{ path: string; name: string; role: string }>;
  titleZones: PresentationProfileZone[];
  bodyZones: PresentationProfileZone[];
  repeatedElements: Array<{
    signature: string;
    name: string;
    occurrences: number;
    bounds: PresentationProfileZone;
    fill?: string;
    lineColor?: string;
  }>;
  representativeSlides: number[];
};

const bounds = (block: string): PresentationProfileZone => {
  const off = block.match(/<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/i);
  const ext = block.match(/<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/i);
  return {
    x: Number(off?.[1] ?? 0) / EMU_PER_INCH,
    y: Number(off?.[2] ?? 0) / EMU_PER_INCH,
    w: Number(ext?.[1] ?? 0) / EMU_PER_INCH,
    h: Number(ext?.[2] ?? 0) / EMU_PER_INCH,
  };
};

const cleanName = (value: string | undefined): string => (value ?? '')
  .replace(/&quot;/g, '"')
  .replace(/&amp;/g, '&')
  .trim();

const placeholderRole = (block: string): string =>
  block.match(/<p:ph\b[^>]*\btype="([^"]+)"/i)?.[1] ?? 'content';

const listParts = (zip: any, pattern: RegExp): string[] => Object.keys(zip.files)
  .filter((name) => pattern.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const themeData = async (zip: any): Promise<{ fonts: string[]; colors: string[] }> => {
  const themePath = listParts(zip, /^ppt\/theme\/theme\d+\.xml$/i)[0];
  const xml = themePath ? await zip.file(themePath)?.async('string') : '';
  const fonts = new Set<string>();
  for (const match of (xml ?? '').matchAll(/<a:(?:latin|ea|cs)\b[^>]*\btypeface="([^"]*)"/gi)) {
    if (match[1]?.trim()) fonts.add(match[1].trim());
  }
  const colors = new Set<string>();
  for (const match of (xml ?? '').matchAll(/<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/gi)) {
    colors.add(match[1].toUpperCase());
  }
  return { fonts: [...fonts], colors: [...colors] };
};

export const analyzePresentationStyleBytes = async (bytes: Uint8Array): Promise<PresentationStyleProfile> => {
  const JSZip = await getJSZip();
  const zip = await JSZip.loadAsync(bytes);
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string') ?? '';
  const size = presentationXml.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/i);
  const slideWidth = Number(size?.[1] ?? 12191695) / EMU_PER_INCH;
  const slideHeight = Number(size?.[2] ?? 6858000) / EMU_PER_INCH;
  const { fonts, colors } = await themeData(zip);

  const masterPaths = listParts(zip, /^ppt\/slideMasters\/slideMaster\d+\.xml$/i);
  const masters = await Promise.all(masterPaths.map(async (path) => {
    const xml = await zip.file(path)?.async('string') ?? '';
    return {
      path,
      name: cleanName(xml.match(/<p:cSld\b[^>]*\bname="([^"]*)"/i)?.[1]) || path.split('/').pop()!,
      layoutCount: [...xml.matchAll(/<p:sldLayoutId\b/gi)].length,
    };
  }));
  const layoutPaths = listParts(zip, /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i);
  const layouts = await Promise.all(layoutPaths.map(async (path) => {
    const xml = await zip.file(path)?.async('string') ?? '';
    const role = xml.match(/<p:sldLayout\b[^>]*\btype="([^"]+)"/i)?.[1] ?? 'custom';
    return {
      path,
      name: cleanName(xml.match(/<p:cSld\b[^>]*\bname="([^"]*)"/i)?.[1]) || role,
      role,
    };
  }));

  const slidePaths = listParts(zip, /^ppt\/slides\/slide\d+\.xml$/i);
  const titleZones: PresentationProfileZone[] = [];
  const bodyZones: PresentationProfileZone[] = [];
  const repeated = new Map<string, {
    signature: string;
    name: string;
    occurrences: number;
    bounds: PresentationProfileZone;
    fill?: string;
    lineColor?: string;
  }>();
  const density: Array<{ index: number; count: number; textLength: number }> = [];

  for (let index = 0; index < slidePaths.length; index += 1) {
    const xml = await zip.file(slidePaths[index])?.async('string') ?? '';
    let count = 0;
    let textLength = 0;
    for (const match of xml.matchAll(ELEMENT_RE)) {
      const block = match[0];
      const box = { ...bounds(block), slideIndex: index + 1 };
      const role = placeholderRole(block);
      if (/^(?:title|ctrTitle)$/i.test(role)) titleZones.push(box);
      if (/^(?:body|obj|subTitle)$/i.test(role)) bodyZones.push(box);
      count += 1;
      textLength += [...block.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
        .reduce((sum, value) => sum + value[1].length, 0);
      const name = cleanName(block.match(/<p:cNvPr\b[^>]*\bname="([^"]*)"/i)?.[1]);
      const fill = block.match(/<a:solidFill>[\s\S]*?<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/i)?.[1]?.toUpperCase();
      const lineColor = block.match(/<a:ln\b[\s\S]*?<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/i)?.[1]?.toUpperCase();
      const signature = [match[1], name.toLowerCase(), box.x.toFixed(2), box.y.toFixed(2), box.w.toFixed(2), box.h.toFixed(2), fill, lineColor].join('|');
      const current = repeated.get(signature);
      if (current) current.occurrences += 1;
      else repeated.set(signature, { signature, name, occurrences: 1, bounds: box, fill, lineColor });
    }
    density.push({ index: index + 1, count, textLength });
  }

  const representativeSlides = density
    .sort((a, b) => a.count - b.count || a.textLength - b.textLength)
    .filter((_, index, all) => index === 0 || index === Math.floor((all.length - 1) / 2) || index === all.length - 1)
    .map((item) => item.index)
    .filter((value, index, all) => all.indexOf(value) === index);

  return {
    slideWidth,
    slideHeight,
    orientation: Math.abs(slideWidth - slideHeight) < 0.05 ? 'square' : slideWidth > slideHeight ? 'landscape' : 'portrait',
    themeFonts: fonts,
    themeColors: colors,
    chartColors: colors.slice(0, 8),
    masters,
    layouts,
    titleZones,
    bodyZones,
    repeatedElements: [...repeated.values()]
      .filter((item) => slidePaths.length > 1 && item.occurrences / slidePaths.length >= 0.5)
      .sort((a, b) => b.occurrences - a.occurrences),
    representativeSlides,
  };
};

export const analyzePresentationStyle = async (path: string): Promise<PresentationStyleProfile> =>
  analyzePresentationStyleBytes(await workspace.readFileBytes(path));
