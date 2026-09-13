export const PRESENTATION_LAYOUTS = [
  'cover',
  'section',
  'content',
  'agenda',
  'title-body',
  'two-column',
  'comparison',
  'metric-cards',
  'timeline',
  'process',
  'quote',
  'image-left',
  'image-right',
  'chart-insight',
  'table',
  'dashboard',
  'chapter-number',
  'statement-metrics',
  'spotlight',
  'split-showcase',
  'closing',
  'blank',
] as const;

export const PRESENTATION_THEME_NAMES = [
  'minimal-light',
  'dark-tech',
  'consulting-clean',
  'editorial-warm',
  'academic-blue',
  'product-vibrant',
] as const;

export const PRESENTATION_ELEMENT_TYPES = [
  'text',
  'shape',
  'line',
  'image',
  'table',
  'chart',
] as const;

export type PresentationLayout = (typeof PRESENTATION_LAYOUTS)[number];
export type PresentationThemeName = (typeof PRESENTATION_THEME_NAMES)[number];
export type PresentationElementType = (typeof PRESENTATION_ELEMENT_TYPES)[number];
export type PresentationChartType =
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'doughnut'
  | 'scatter'
  | 'bubble'
  | 'radar';

export type PresentationTextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  color?: string;
  breakLine?: boolean;
  hyperlink?: string;
};

export type PresentationListItem = {
  text: string;
  level?: number;
  ordered?: boolean;
  bold?: boolean;
  color?: string;
};

export type PresentationTableCell = {
  text: string;
  bold?: boolean;
  color?: string;
  fill?: string;
  align?: 'left' | 'center' | 'right';
  rowSpan?: number;
  colSpan?: number;
};

export type PresentationChartSeries = {
  name: string;
  values: number[];
  type?: PresentationChartType;
  color?: string;
};

export type PresentationTextLayout = 'flow' | 'frozen-lines';
export type PresentationElementFallback = 'none' | 'rasterize';

/**
 * 面向模型的扁平元素协议。不同 type 的必填字段在运行时校验，避免复杂
 * discriminated-union JSON Schema 被部分模型供应商拒绝。
 */
export type PresentationElement = {
  id?: string;
  name?: string;
  type: PresentationElementType;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  zIndex?: number;
  /** 纯装饰元素不参与可读性与文本重叠告警。 */
  decorative?: boolean;
  /** HTML 编译器的文字换行策略；V2 未提供时维持原有 shrink 行为。 */
  textLayout?: PresentationTextLayout;
  /** 仅允许显式标记的装饰对象局部栅格化。 */
  fallback?: PresentationElementFallback;
  sourceHtmlId?: string;
  rotate?: number;
  text?: string;
  runs?: PresentationTextRun[];
  listItems?: PresentationListItem[];
  fontFace?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  valign?: 'top' | 'middle' | 'bottom';
  bullet?: boolean;
  margin?: number;
  shapeType?: string;
  fill?: string;
  transparency?: number;
  lineColor?: string;
  lineWidth?: number;
  dash?: 'solid' | 'dash' | 'dot';
  beginArrowType?: string;
  endArrowType?: string;
  radius?: number;
  shadow?: boolean;
  path?: string;
  /** 编译器生成的受控 data URL；面向 Agent 的 schema 不开放。 */
  data?: string;
  fit?: 'stretch' | 'contain' | 'cover';
  alt?: string;
  hyperlink?: string;
  rows?: Array<Array<string | PresentationTableCell>>;
  columnWidths?: number[];
  borderColor?: string;
  chartType?: PresentationChartType;
  categories?: string[];
  series?: PresentationChartSeries[];
  showLegend?: boolean;
  showTitle?: boolean;
  showValue?: boolean;
  showCategoryName?: boolean;
  legendPosition?: 'top' | 'bottom' | 'left' | 'right';
};

/** 写入选择窗格名称的轻量标记，让装饰语义在重新读取 PPT 后仍可识别。 */
export const PRESENTATION_DECORATIVE_NAME_PREFIX = 'Cottage decoration · ';

export const presentationElementObjectName = (element: Pick<PresentationElement, 'id' | 'name' | 'decorative'>): string | undefined => {
  const base = element.name?.trim() || element.id?.trim();
  if (!base) return undefined;
  return element.decorative ? `${PRESENTATION_DECORATIVE_NAME_PREFIX}${base}` : base;
};

export const parsePresentationElementObjectName = (rawName: string): { name: string; decorative: boolean } => {
  const decorative = rawName.startsWith(PRESENTATION_DECORATIVE_NAME_PREFIX);
  return {
    name: decorative ? rawName.slice(PRESENTATION_DECORATIVE_NAME_PREFIX.length) : rawName,
    decorative,
  };
};

export type PresentationSemanticItem = {
  title?: string;
  subtitle?: string;
  text?: string;
  value?: string;
  label?: string;
  accent?: string;
  path?: string;
};

export type PresentationTheme = {
  name?: PresentationThemeName;
  background?: string;
  surface?: string;
  text?: string;
  muted?: string;
  accent?: string;
  accent2?: string;
  fontFace?: string;
  headingFontFace?: string;
  radius?: number;
  shadow?: boolean;
  chartColors?: string[];
};

export type PresentationSlide = {
  id?: string;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  notes?: string;
  layout?: PresentationLayout;
  background?: string;
  accent?: string;
  kicker?: string;
  chapterNumber?: string;
  takeaway?: string;
  items?: PresentationSemanticItem[];
  left?: PresentationSemanticItem;
  right?: PresentationSemanticItem;
  quote?: string;
  attribution?: string;
  elements?: PresentationElement[];
};

export type PresentationDeckSpecV2 = {
  version?: 2;
  title?: string;
  subject?: string;
  author?: string;
  company?: string;
  language?: string;
  theme?: PresentationTheme;
  presentationHeader?: string;
  presentationFooter?: string;
  showSlideNumbers?: boolean;
  slides: PresentationSlide[];
};

export type PresentationReferenceMode =
  | 'content-only'
  | 'inspiration'
  | 'match-style'
  | 'native-template';

export type PresentationHtmlLayoutRole =
  | 'cover'
  | 'section'
  | 'content'
  | 'comparison'
  | 'data'
  | 'image'
  | 'closing'
  | 'blank';

export type PresentationHtmlModuleName =
  | 'cover'
  | 'section'
  | 'title-body'
  | 'comparison'
  | 'metrics'
  | 'timeline'
  | 'process'
  | 'matrix'
  | 'funnel'
  | 'roadmap'
  | 'hierarchy'
  | 'image-story'
  | 'image-gallery'
  | 'quote'
  | 'chart-insight'
  | 'table'
  | 'closing';

export type PresentationHtmlTableBinding = {
  id: string;
  rows: Array<Array<string | PresentationTableCell>>;
  columnWidths?: number[];
};

export type PresentationHtmlChartBinding = {
  id: string;
  chartType: PresentationChartType;
  categories?: string[];
  series: PresentationChartSeries[];
  showLegend?: boolean;
  showValue?: boolean;
  showCategoryName?: boolean;
  legendPosition?: 'top' | 'bottom' | 'left' | 'right';
};

export type PresentationHtmlSlide = {
  id?: string;
  html?: string;
  css?: string;
  notes?: string;
  layoutRole?: PresentationHtmlLayoutRole;
  templateSlideIndex?: number;
  module?: PresentationHtmlModuleName;
  title?: string;
  subtitle?: string;
  items?: PresentationSemanticItem[];
  chartBindings?: PresentationHtmlChartBinding[];
  tableBindings?: PresentationHtmlTableBinding[];
};

/**
 * HTML 只作为浏览器布局输入；最终仍由 PresentationScene 生成原生 PPTX。
 * 字段保持扁平，跨字段约束在运行时完成，避免供应商工具 schema 兼容问题。
 */
export type PresentationDeckSpecV3 = {
  version: 3;
  pipeline: 'html-layout';
  title?: string;
  subject?: string;
  author?: string;
  company?: string;
  language?: string;
  theme?: PresentationTheme;
  presentationHeader?: string;
  presentationFooter?: string;
  showSlideNumbers?: boolean;
  slideWidth?: number;
  slideHeight?: number;
  sharedCss?: string;
  referencePath?: string;
  referenceMode?: PresentationReferenceMode;
  referenceSlideIndices?: number[];
  draftOnly?: boolean;
  sourceDraftId?: string;
  slides?: PresentationHtmlSlide[];
};

export type PresentationDeckSpec = PresentationDeckSpecV2 | PresentationDeckSpecV3;

export type ResolvedPresentationTheme = Required<
  Pick<
    PresentationTheme,
    | 'name'
    | 'background'
    | 'surface'
    | 'text'
    | 'muted'
    | 'accent'
    | 'accent2'
    | 'fontFace'
    | 'headingFontFace'
    | 'radius'
    | 'shadow'
    | 'chartColors'
  >
>;

export type PresentationWarningCode =
  | 'out_of_bounds'
  | 'estimated_text_overflow'
  | 'overlap'
  | 'low_contrast'
  | 'missing_asset'
  | 'repetitive_layout'
  | 'unsupported_css'
  | 'font_unavailable'
  | 'layout_unstable'
  | 'text_wrap_drift'
  | 'flattened_element'
  | 'roundtrip_mismatch'
  | 'template_fidelity_limited';

export type PresentationWarning = {
  code: PresentationWarningCode;
  slideIndex: number;
  elementId?: string;
  message: string;
};

export type PresentationSceneSlide = {
  id: string;
  index: number;
  title?: string;
  notes?: string;
  background: string;
  elements: Array<PresentationElement & Required<Pick<PresentationElement, 'id' | 'x' | 'y' | 'w' | 'h'>>>;
};

export type PresentationScene = {
  width: number;
  height: number;
  sourceKind?: 'semantic-v2' | 'html-v3' | 'pptx-import';
  template?: {
    path: string;
    mode: PresentationReferenceMode;
    sourceSlideIndices?: number[];
  };
  theme: ResolvedPresentationTheme;
  metadata: Pick<PresentationDeckSpecV2, 'title' | 'subject' | 'author' | 'company' | 'language'>;
  slides: PresentationSceneSlide[];
  warnings: PresentationWarning[];
};

const THEME_PRESETS: Record<PresentationThemeName, ResolvedPresentationTheme> = {
  'minimal-light': {
    name: 'minimal-light', background: 'F8FAFC', surface: 'FFFFFF', text: '0F172A',
    muted: '475569', accent: '2563EB', accent2: '0EA5E9', fontFace: 'Noto Sans SC',
    headingFontFace: 'Noto Sans SC', radius: 0.12, shadow: false,
    chartColors: ['2563EB', '0EA5E9', '14B8A6', 'F59E0B', '8B5CF6', 'EF4444'],
  },
  'dark-tech': {
    name: 'dark-tech', background: '0B1020', surface: '151C31', text: 'E5E7EB',
    muted: 'A5B4CB', accent: '22D3EE', accent2: '8B5CF6', fontFace: 'Noto Sans SC',
    headingFontFace: 'Noto Sans SC', radius: 0.12, shadow: true,
    chartColors: ['22D3EE', '8B5CF6', '34D399', 'FBBF24', 'FB7185', '60A5FA'],
  },
  'consulting-clean': {
    name: 'consulting-clean', background: 'FFFFFF', surface: 'F8FAFC', text: '111827',
    muted: '4B5563', accent: '0EA5E9', accent2: '1D4ED8', fontFace: 'Noto Sans SC',
    headingFontFace: 'Noto Sans SC', radius: 0.08, shadow: false,
    chartColors: ['0EA5E9', '1D4ED8', '14B8A6', 'F59E0B', '7C3AED', 'DC2626'],
  },
  'editorial-warm': {
    name: 'editorial-warm', background: 'FBF7F0', surface: 'FFFDFC', text: '292524',
    muted: '78716C', accent: 'C2410C', accent2: 'CA8A04', fontFace: 'Noto Sans SC',
    headingFontFace: 'Noto Serif SC', radius: 0.08, shadow: false,
    chartColors: ['C2410C', 'CA8A04', '0F766E', '7C3AED', 'BE123C', '0369A1'],
  },
  'academic-blue': {
    name: 'academic-blue', background: 'F7FAFC', surface: 'FFFFFF', text: '102A43',
    muted: '486581', accent: '1D4ED8', accent2: '0F766E', fontFace: 'Noto Sans SC',
    headingFontFace: 'Noto Serif SC', radius: 0.05, shadow: false,
    chartColors: ['1D4ED8', '0F766E', '0369A1', '7C3AED', 'B45309', 'BE123C'],
  },
  'product-vibrant': {
    name: 'product-vibrant', background: 'F8FAFF', surface: 'FFFFFF', text: '172033',
    muted: '526078', accent: '6D28D9', accent2: 'DB2777', fontFace: 'Noto Sans SC',
    headingFontFace: 'Noto Sans SC', radius: 0.18, shadow: true,
    chartColors: ['6D28D9', 'DB2777', '0284C7', '059669', 'EA580C', 'EAB308'],
  },
};

const hex = (value: string | undefined, fallback: string): string => {
  const normalized = value?.trim().replace(/^#/, '').toUpperCase();
  return normalized && /^[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
};

export const resolvePresentationTheme = (theme?: PresentationTheme): ResolvedPresentationTheme => {
  const preset = THEME_PRESETS[theme?.name ?? 'minimal-light'];
  return {
    ...preset,
    background: hex(theme?.background, preset.background),
    surface: hex(theme?.surface, preset.surface),
    text: hex(theme?.text, preset.text),
    muted: hex(theme?.muted, preset.muted),
    accent: hex(theme?.accent, preset.accent),
    accent2: hex(theme?.accent2, preset.accent2),
    fontFace: theme?.fontFace?.trim() || preset.fontFace,
    headingFontFace: theme?.headingFontFace?.trim() || theme?.fontFace?.trim() || preset.headingFontFace,
    radius: theme?.radius ?? preset.radius,
    shadow: theme?.shadow ?? preset.shadow,
    chartColors: theme?.chartColors?.length
      ? theme.chartColors.map((color, index) => hex(color, preset.chartColors[index % preset.chartColors.length]))
      : preset.chartColors,
  };
};

const element = (
  id: string,
  type: PresentationElementType,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Omit<PresentationElement, 'id' | 'type' | 'x' | 'y' | 'w' | 'h'> = {},
): PresentationSceneSlide['elements'][number] => ({ id, type, x, y, w, h, ...extra });

const titleElements = (
  slide: PresentationSlide,
  theme: ResolvedPresentationTheme,
  compact = false,
): PresentationSceneSlide['elements'] => {
  const out: PresentationSceneSlide['elements'] = [];
  if (slide.title) out.push(element('title', 'text', 0.72, 0.42, 11.9, compact ? 0.62 : 0.82, {
    text: slide.title, fontSize: compact ? 25 : 30, bold: true, color: theme.text,
    fontFace: theme.headingFontFace,
  }));
  if (slide.title) out.push(element('title-accent', 'shape', 0.74, compact ? 1.12 : 1.34, 1.45, 0.06, {
    shapeType: 'rect', fill: slide.accent ?? theme.accent, lineColor: slide.accent ?? theme.accent,
  }));
  if (slide.subtitle) out.push(element('subtitle', 'text', 0.74, compact ? 1.28 : 1.52, 11.8, 0.48, {
    text: slide.subtitle, fontSize: 15, italic: true, color: theme.muted,
  }));
  return out;
};

const semanticElements = (
  slide: PresentationSlide,
  theme: ResolvedPresentationTheme,
  slideIndex: number,
): PresentationSceneSlide['elements'] => {
  const layout = slide.layout ?? (slideIndex === 1 ? 'cover' : 'content');
  const items = slide.items ?? [];
  const out: PresentationSceneSlide['elements'] = [];
  if (layout === 'blank') return out;
  if (layout === 'chapter-number') {
    const accent = slide.accent ?? theme.accent;
    out.push(element('chapter-number', 'text', 7.25, 1.35, 5.55, 3.45, {
      text: slide.chapterNumber ?? items[0]?.value ?? String(slideIndex).padStart(2, '0'),
      fontSize: 120, bold: true, color: theme.surface, align: 'right',
      fontFace: theme.headingFontFace, decorative: true,
    }));
    if (slide.kicker ?? items[0]?.label) out.push(element('kicker', 'text', 0.9, 2.45, 6.0, 0.42, {
      text: slide.kicker ?? items[0]?.label ?? '', fontSize: 13, bold: true, color: accent,
    }));
    out.push(element('chapter-accent', 'shape', 0.95, 3.08, 0.9, 0.1, {
      shapeType: 'rect', fill: accent, lineColor: accent,
    }));
    if (slide.title) out.push(element('title', 'text', 0.9, 3.32, 8.25, 1.15, {
      text: slide.title, fontSize: 44, bold: true, color: theme.text,
      fontFace: theme.headingFontFace, valign: 'middle',
    }));
    if (slide.subtitle) out.push(element('subtitle', 'text', 0.95, 4.72, 10.8, 0.65, {
      text: slide.subtitle, fontSize: 18, color: theme.muted,
    }));
    return out;
  }
  if (layout === 'cover' || layout === 'closing') {
    if (slide.title) out.push(element('title', 'text', 0.9, 2.15, 11.5, 1.35, {
      text: slide.title, fontSize: 42, bold: true, color: theme.text, fontFace: theme.headingFontFace,
      valign: 'middle', align: layout === 'closing' ? 'center' : 'left',
    }));
    out.push(element('cover-accent', 'shape', layout === 'closing' ? 5.55 : 0.95, 3.85, 2.2, 0.08, {
      shapeType: 'rect', fill: slide.accent ?? theme.accent, lineColor: slide.accent ?? theme.accent,
    }));
    if (slide.subtitle) out.push(element('subtitle', 'text', 0.9, 4.12, 11.5, 0.8, {
      text: slide.subtitle, fontSize: 19, color: theme.muted,
      align: layout === 'closing' ? 'center' : 'left',
    }));
    return out;
  }
  if (layout === 'section') {
    out.push(element('section-accent', 'shape', 0, 3.05, 0.25, 1.05, {
      shapeType: 'rect', fill: slide.accent ?? theme.accent, lineColor: slide.accent ?? theme.accent,
    }));
    if (slide.title) out.push(element('title', 'text', 0.9, 2.75, 11.5, 1.25, {
      text: slide.title, fontSize: 36, bold: true, color: theme.text, fontFace: theme.headingFontFace,
      valign: 'middle',
    }));
    if (slide.subtitle) out.push(element('subtitle', 'text', 0.95, 4.15, 11.3, 0.7, {
      text: slide.subtitle, fontSize: 18, color: theme.muted,
    }));
    return out;
  }
  out.push(...titleElements(slide, theme, layout === 'dashboard'));
  const top = slide.subtitle ? 2.15 : 1.65;
  if (layout === 'statement-metrics') {
    const statement = slide.quote ?? slide.bullets?.join('\n') ?? '';
    out.push(element('statement-mark', 'text', 0.78, top + 0.05, 1.35, 1.4, {
      text: '“', fontSize: 88, bold: true, color: slide.accent ?? theme.accent,
      fontFace: theme.headingFontFace, decorative: true,
    }));
    out.push(element('statement', 'text', 2.0, top + 0.42, 5.25, 3.75, {
      text: statement, fontSize: 20, color: theme.text, valign: 'middle',
    }));
    items.slice(0, 3).forEach((item, index) => {
      const y = top + 0.12 + index * 1.47;
      const accent = item.accent ?? (index === 0 ? theme.accent : theme.chartColors[index]);
      out.push(element(`metric-${index}`, 'shape', 7.75, y, 4.7, 1.22, {
        shapeType: 'roundRect', fill: theme.surface, lineColor: theme.surface,
        radius: theme.radius, shadow: theme.shadow,
      }));
      out.push(element(`metric-accent-${index}`, 'shape', 7.75, y, 0.08, 1.22, {
        shapeType: 'rect', fill: accent, lineColor: accent,
      }));
      out.push(element(`metric-value-${index}`, 'text', 8.08, y + 0.16, 1.45, 0.72, {
        text: item.value ?? item.title ?? '', fontSize: 29, bold: true, color: accent,
      }));
      out.push(element(`metric-label-${index}`, 'text', 9.5, y + 0.27, 2.65, 0.55, {
        text: item.label ?? item.text ?? item.subtitle ?? '', fontSize: 13.5, color: theme.text,
      }));
    });
    return out;
  }
  if (layout === 'spotlight') {
    const primary = items[0];
    const supporting = items.slice(1, 3);
    if (primary) {
      const accent = primary.accent ?? slide.accent ?? theme.accent;
      out.push(element('spotlight-card', 'shape', 0.75, top, 5.35, 4.65, {
        shapeType: 'roundRect', fill: theme.surface, lineColor: theme.surface,
        radius: theme.radius, shadow: theme.shadow,
      }));
      out.push(element('spotlight-accent', 'shape', 0.75, top, 5.35, 0.08, {
        shapeType: 'rect', fill: accent, lineColor: accent,
      }));
      out.push(element('spotlight-value', 'text', 1.15, top + 0.58, 4.5, 1.35, {
        text: primary.value ?? primary.title ?? '', fontSize: 58, bold: true, color: accent,
      }));
      out.push(element('spotlight-label', 'text', 1.17, top + 2.28, 4.45, 0.55, {
        text: primary.label ?? '', fontSize: 18, bold: true, color: theme.text,
      }));
      out.push(element('spotlight-body', 'text', 1.17, top + 3.0, 4.45, 1.05, {
        text: primary.text ?? primary.subtitle ?? '', fontSize: 14, color: theme.muted,
      }));
    }
    supporting.forEach((item, index) => {
      const y = top + index * 2.4;
      const accent = item.accent ?? theme.chartColors[index + 1];
      out.push(element(`support-card-${index}`, 'shape', 6.5, y, 5.95, 2.18, {
        shapeType: 'roundRect', fill: theme.surface, lineColor: theme.surface,
        radius: theme.radius, shadow: theme.shadow,
      }));
      out.push(element(`support-accent-${index}`, 'shape', 6.5, y, 0.08, 2.18, {
        shapeType: 'rect', fill: accent, lineColor: accent,
      }));
      out.push(element(`support-value-${index}`, 'text', 6.88, y + 0.25, 2.15, 0.7, {
        text: item.value ?? item.title ?? '', fontSize: 27, bold: true, color: accent,
      }));
      out.push(element(`support-label-${index}`, 'text', 6.88, y + 1.08, 5.05, 0.42, {
        text: item.label ?? '', fontSize: 16, bold: true, color: theme.text,
      }));
      out.push(element(`support-body-${index}`, 'text', 9.05, y + 0.27, 3.0, 1.35, {
        text: item.text ?? item.subtitle ?? '', fontSize: 13, color: theme.muted, align: 'right',
      }));
    });
    return out;
  }
  if (layout === 'split-showcase') {
    const panels = [slide.left ?? items[0], slide.right ?? items[1]];
    const widths = [6.15, 5.2];
    const xs = [0.75, 7.25];
    panels.forEach((item, index) => {
      if (!item) return;
      const accent = item.accent ?? (index === 0 ? theme.accent : theme.accent2);
      out.push(element(`showcase-${index}`, 'shape', xs[index], top, widths[index], 4.65, {
        shapeType: 'roundRect', fill: theme.surface, lineColor: theme.surface,
        radius: theme.radius, shadow: theme.shadow,
      }));
      out.push(element(`showcase-accent-${index}`, 'shape', xs[index], top, widths[index], 0.08, {
        shapeType: 'rect', fill: accent, lineColor: accent,
      }));
      out.push(element(`showcase-value-${index}`, 'text', xs[index] + 0.4, top + 0.52, widths[index] - 0.8, 1.15, {
        text: item.value ?? '', fontSize: index === 0 ? 50 : 34, bold: true, color: accent,
      }));
      out.push(element(`showcase-title-${index}`, 'text', xs[index] + 0.4, top + 1.88, widths[index] - 0.8, 0.62, {
        text: item.title ?? item.label ?? '', fontSize: 19, bold: true, color: theme.text,
      }));
      out.push(element(`showcase-body-${index}`, 'text', xs[index] + 0.4, top + 2.72, widths[index] - 0.8, 1.35, {
        text: item.text ?? item.subtitle ?? '', fontSize: 14, color: theme.muted,
      }));
    });
    return out;
  }
  if (layout === 'content' || layout === 'title-body' || layout === 'agenda') {
    const bullets = slide.bullets?.length ? slide.bullets : items.map((item) => item.title ?? item.text ?? '');
    if (bullets.length) out.push(element('body', 'text', 0.82, top, 11.65, 5.0, {
      text: bullets.join('\n'), fontSize: layout === 'agenda' ? 21 : 18, color: theme.text,
      bullet: true, margin: 0.05,
    }));
    return out;
  }
  if (layout === 'two-column' || layout === 'comparison') {
    const columns = [slide.left ?? items[0], slide.right ?? items[1]];
    columns.forEach((column, index) => {
      if (!column) return;
      const x = index === 0 ? 0.75 : 6.85;
      if (layout === 'comparison') out.push(element(`column-card-${index}`, 'shape', x, top, 5.75, 4.7, {
        shapeType: 'roundRect', fill: theme.surface, lineColor: index === 0 ? theme.accent : theme.accent2,
        lineWidth: 1.2, radius: theme.radius, shadow: theme.shadow,
      }));
      out.push(element(`column-title-${index}`, 'text', x + 0.25, top + 0.25, 5.25, 0.55, {
        text: column.title ?? column.label ?? '', fontSize: 21, bold: true,
        color: index === 0 ? theme.accent : theme.accent2,
      }));
      out.push(element(`column-body-${index}`, 'text', x + 0.25, top + 1.0, 5.25, 3.25, {
        text: column.text ?? column.subtitle ?? '', fontSize: 16, color: theme.text, valign: 'top',
      }));
    });
    return out;
  }
  if (layout === 'metric-cards' || layout === 'dashboard') {
    const count = Math.min(items.length, layout === 'dashboard' ? 6 : 4);
    const cols = layout === 'dashboard' ? 3 : Math.max(1, count);
    const cardW = (11.85 - (cols - 1) * 0.28) / cols;
    items.slice(0, count).forEach((item, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const x = 0.74 + col * (cardW + 0.28);
      const y = top + row * 2.05;
      out.push(element(`card-${index}`, 'shape', x, y, cardW, 1.75, {
        shapeType: 'roundRect', fill: theme.surface, lineColor: 'D8E0EA', lineWidth: 0.8,
        radius: theme.radius, shadow: theme.shadow,
      }));
      out.push(element(`card-value-${index}`, 'text', x + 0.22, y + 0.2, cardW - 0.44, 0.65, {
        text: item.value ?? item.title ?? '', fontSize: 28, bold: true,
        color: item.accent ?? theme.accent,
      }));
      out.push(element(`card-label-${index}`, 'text', x + 0.22, y + 0.95, cardW - 0.44, 0.5, {
        text: item.label ?? item.text ?? item.subtitle ?? '', fontSize: 13, color: theme.muted,
      }));
    });
    return out;
  }
  if (layout === 'timeline' || layout === 'process') {
    const count = Math.max(1, Math.min(items.length, 6));
    const startX = 1.0;
    const span = 11.25;
    const step = count > 1 ? span / (count - 1) : 0;
    out.push(element('flow-line', 'line', startX, 3.45, span, 0, {
      lineColor: theme.accent, lineWidth: 2, endArrowType: layout === 'process' ? 'triangle' : undefined,
    }));
    items.slice(0, count).forEach((item, index) => {
      const x = startX + step * index;
      out.push(element(`flow-dot-${index}`, 'shape', x - 0.18, 3.27, 0.36, 0.36, {
        shapeType: 'ellipse', fill: item.accent ?? theme.accent, lineColor: item.accent ?? theme.accent,
      }));
      out.push(element(`flow-title-${index}`, 'text', x - 0.75, 2.35, 1.5, 0.6, {
        text: item.title ?? item.label ?? `${index + 1}`, fontSize: 15, bold: true,
        align: 'center', color: theme.text,
      }));
      out.push(element(`flow-body-${index}`, 'text', x - 0.85, 3.85, 1.7, 1.15, {
        text: item.text ?? item.subtitle ?? '', fontSize: 11.5, align: 'center', color: theme.muted,
      }));
    });
    if (layout === 'process' && slide.takeaway) {
      out.push(element('takeaway-card', 'shape', 0.9, 5.55, 11.55, 0.82, {
        shapeType: 'roundRect', fill: theme.surface, lineColor: theme.surface,
        radius: theme.radius,
      }));
      out.push(element('takeaway-accent', 'shape', 0.9, 5.55, 0.08, 0.82, {
        shapeType: 'rect', fill: slide.accent ?? theme.accent, lineColor: slide.accent ?? theme.accent,
      }));
      out.push(element('takeaway', 'text', 1.25, 5.72, 10.75, 0.45, {
        text: slide.takeaway, fontSize: 15, bold: true, color: theme.text,
      }));
    }
    return out;
  }
  if (layout === 'quote') {
    out.push(element('quote-mark', 'text', 0.9, 1.75, 1.0, 1.0, {
      text: '“', fontSize: 64, bold: true, color: theme.accent,
    }));
    out.push(element('quote', 'text', 1.55, 2.15, 10.5, 2.25, {
      text: slide.quote ?? slide.subtitle ?? '', fontSize: 29, italic: true,
      color: theme.text, valign: 'middle',
    }));
    if (slide.attribution) out.push(element('attribution', 'text', 7.7, 4.65, 4.3, 0.55, {
      text: `— ${slide.attribution}`, fontSize: 15, color: theme.muted, align: 'right',
    }));
    return out;
  }
  if (layout === 'image-left' || layout === 'image-right') {
    const image = items.find((item) => item.path);
    const imageX = layout === 'image-left' ? 0.75 : 7.05;
    const textX = layout === 'image-left' ? 7.1 : 0.75;
    if (image?.path) out.push(element('hero-image', 'image', imageX, top, 5.55, 4.75, {
      path: image.path, fit: 'cover', alt: image.label ?? image.title,
    }));
    out.push(element('hero-body', 'text', textX, top + 0.35, 5.45, 3.8, {
      text: slide.bullets?.join('\n') ?? items.find((item) => !item.path)?.text ?? '',
      fontSize: 18, color: theme.text, bullet: Boolean(slide.bullets?.length),
    }));
    return out;
  }
  // chart-insight / table 由显式 elements 承载；此处只生成文字洞察区。
  if (layout === 'chart-insight' || layout === 'table') {
    if (slide.bullets?.length) out.push(element('insight', 'text', 9.65, top, 2.8, 4.85, {
      text: slide.bullets.join('\n'), fontSize: 14, color: theme.text, bullet: true,
    }));
    return out;
  }
  return out;
};

const luminance = (color: string): number => {
  const rgb = [0, 2, 4].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
};

const contrastRatio = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

const overlapArea = (a: PresentationSceneSlide['elements'][number], b: PresentationSceneSlide['elements'][number]): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const estimateWarnings = (
  slides: PresentationSceneSlide[],
  sourceSlides: PresentationSlide[],
): PresentationWarning[] => {
  const warnings: PresentationWarning[] = [];
  for (const slide of slides) {
    for (const el of slide.elements) {
      if (el.x < 0 || el.y < 0 || el.x + el.w > 13.333 || el.y + el.h > 7.5) {
        warnings.push({ code: 'out_of_bounds', slideIndex: slide.index, elementId: el.id,
          message: `元素 ${el.id} 超出 16:9 页面边界` });
      }
      const text = el.runs?.map((run) => run.text).join('') ?? el.text ?? '';
      if (text && el.type === 'text' && !el.decorative) {
        const fontSize = el.fontSize ?? 18;
        const estimatedCapacity = Math.max(1, Math.floor(el.w * el.h * 1250 / fontSize));
        if (text.length > estimatedCapacity) warnings.push({
          code: 'estimated_text_overflow', slideIndex: slide.index, elementId: el.id,
          message: `元素 ${el.id} 文字可能溢出（估算容量 ${estimatedCapacity} 字）`,
        });
        const color = hex(el.color, '000000');
        if (contrastRatio(color, slide.background) < 3) warnings.push({
          code: 'low_contrast', slideIndex: slide.index, elementId: el.id,
          message: `元素 ${el.id} 与页面背景对比度偏低`,
        });
      }
    }
    const textElements = slide.elements.filter((item) => item.type === 'text' && item.text?.trim() && !item.decorative);
    for (let i = 0; i < textElements.length; i += 1) {
      for (let j = i + 1; j < textElements.length; j += 1) {
        const a = textElements[i];
        const b = textElements[j];
        const overlap = overlapArea(a, b);
        if (overlap > Math.min(a.w * a.h, b.w * b.h) * 0.25) warnings.push({
          code: 'overlap', slideIndex: slide.index, elementId: b.id,
          message: `文本元素 ${a.id} 与 ${b.id} 大面积重叠`,
        });
      }
    }
  }
  const contentLayouts = sourceSlides
    .map((slide, index) => ({ layout: slide.layout ?? (index === 0 ? 'cover' : 'content'), index: index + 1 }))
    .filter(({ layout }) => !['cover', 'section', 'chapter-number', 'closing', 'blank'].includes(layout));
  if (contentLayouts.length >= 5) {
    const counts = new Map<PresentationLayout, { count: number; firstIndex: number }>();
    for (const item of contentLayouts) {
      const current = counts.get(item.layout);
      counts.set(item.layout, current
        ? { ...current, count: current.count + 1 }
        : { count: 1, firstIndex: item.index });
    }
    for (const [layout, usage] of counts) {
      if (usage.count >= 3 && usage.count / contentLayouts.length >= 0.5) warnings.push({
        code: 'repetitive_layout',
        slideIndex: usage.firstIndex,
        message: `非章节内容页中 ${usage.count}/${contentLayouts.length} 页重复使用 ${layout}；建议按信息类型轮换构图`,
      });
    }
  }
  return warnings;
};

const validateElement = (
  el: PresentationSceneSlide['elements'][number],
  slideIndex: number,
): void => {
  const label = `第 ${slideIndex} 页元素 ${el.id}`;
  if (![el.x, el.y, el.w, el.h].every(Number.isFinite)) {
    throw new Error(`${label} 的坐标或尺寸无效`);
  }
  if (el.type === 'line') {
    if (el.w === 0 && el.h === 0) throw new Error(`${label} 的连接线长度不能为 0`);
  } else if (el.w <= 0 || el.h <= 0) {
    throw new Error(`${label} 的宽高必须大于 0`);
  }
  if (el.type === 'image' && !el.path?.trim()) throw new Error(`${label} 缺少图片 path`);
  if (el.type === 'table' && !el.rows?.length) throw new Error(`${label} 缺少表格 rows`);
  if (el.type === 'chart') {
    if (!el.chartType || !el.series?.length) throw new Error(`${label} 缺少 chartType 或 series`);
    if (el.chartType !== 'scatter' && el.chartType !== 'bubble' && !el.categories?.length) {
      throw new Error(`${label} 缺少 categories`);
    }
    const expected = el.categories?.length;
    if (expected && el.series.some((series) => series.values.length !== expected)) {
      throw new Error(`${label} 的系列数据长度必须与 categories 一致`);
    }
  }
};

export const buildPresentationScene = (input: PresentationDeckSpecV2): PresentationScene => {
  if (!input.slides?.length) throw new Error('PPT 至少需要一页幻灯片');
  if (input.slides.length > 100) throw new Error('PPT 页数不能超过 100');
  const theme = resolvePresentationTheme(input.theme);
  const slides = input.slides.map((slide, idx): PresentationSceneSlide => {
    const index = idx + 1;
    const semantic = semanticElements(slide, theme, index);
    const explicit = (slide.elements ?? []).map((raw, elementIndex) => ({
      ...raw,
      id: raw.id?.trim() || `element-${elementIndex + 1}`,
      x: raw.x ?? 0.75,
      y: raw.y ?? 1.6,
      w: raw.w ?? 3.0,
      h: raw.h ?? 1.0,
    }));
    const ids = new Set<string>();
    const elements = [...semantic, ...explicit]
      .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
      .map((el) => {
        if (ids.has(el.id)) throw new Error(`第 ${index} 页存在重复元素 id: ${el.id}`);
        ids.add(el.id);
        return el;
      });
    if (elements.length > 200) throw new Error(`第 ${index} 页元素数量不能超过 200`);
    elements.forEach((el) => validateElement(el, index));
    return {
      id: slide.id?.trim() || `slide-${index}`,
      index,
      title: slide.title,
      notes: slide.notes,
      background: hex(slide.background, theme.background),
      elements,
    };
  });
  const warnings = estimateWarnings(slides, input.slides);
  return {
    width: 13.333,
    height: 7.5,
    sourceKind: 'semantic-v2',
    theme,
    metadata: {
      title: input.title,
      subject: input.subject,
      author: input.author,
      company: input.company,
      language: input.language,
    },
    slides,
    warnings,
  };
};
