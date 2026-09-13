import { workspace } from '../../workspace/FileSystemWorkspace';
import type {
  PresentationDeckSpecV3,
  PresentationScene,
  PresentationWarning,
} from './presentationModel';
import type { PresentationEditOperation, PresentationSlidePreviewData } from './presentationOoxml';

export type PresentationSourceManifestStatus = 'draft' | 'synced' | 'stale';

export type PresentationSourceManifest = {
  version: 1;
  draftId: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
  outputPath?: string;
  status: PresentationSourceManifestStatus;
  source: PresentationDeckSpecV3;
  previewSlides: Array<{ id: string; html: string; css?: string }>;
  scene: PresentationScene;
  warnings: PresentationWarning[];
  staleReason?: string;
};

type PresentationManifestIndex = Record<string, string>;

const INDEX_PATH = 'presentations/index.json';
const normalizeOutputPath = (path: string): string => path.trim().replace(/\\/g, '/').toLowerCase();

const digest = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((item) => item.toString(16).padStart(2, '0')).join('');
};

export const presentationDraftId = async (source: PresentationDeckSpecV3): Promise<{ draftId: string; contentHash: string }> => {
  // draftOnly/sourceDraftId 是事务控制字段，不应改变同一份设计稿的内容哈希。
  const canonical = { ...source, draftOnly: undefined, sourceDraftId: undefined };
  const contentHash = await digest(JSON.stringify(canonical));
  return { draftId: contentHash.slice(0, 20), contentHash };
};

export const readPresentationSourceManifest = async (draftId: string): Promise<PresentationSourceManifest | null> =>
  workspace.readCottagePath<PresentationSourceManifest>(`presentations/${draftId}/manifest.json`);

export const findPresentationSourceManifest = async (outputPath: string): Promise<PresentationSourceManifest | null> => {
  const index = await workspace.readCottagePath<PresentationManifestIndex>(INDEX_PATH) ?? {};
  const draftId = index[normalizeOutputPath(outputPath)];
  return draftId ? readPresentationSourceManifest(draftId) : null;
};

export const savePresentationSourceManifest = async (manifest: PresentationSourceManifest): Promise<void> => {
  await workspace.writeCottagePath(`presentations/${manifest.draftId}/manifest.json`, manifest);
  if (!manifest.outputPath) return;
  const index = await workspace.readCottagePath<PresentationManifestIndex>(INDEX_PATH) ?? {};
  index[normalizeOutputPath(manifest.outputPath)] = manifest.draftId;
  await workspace.writeCottagePath(INDEX_PATH, index);
};

/** 保存可复查的源稿拆分文件；manifest.json 仍是唯一索引和状态真相。 */
export const savePresentationSourceSidecars = async (manifest: PresentationSourceManifest): Promise<void> => {
  const root = `presentations/${manifest.draftId}`;
  await workspace.writeCottagePath(`${root}/source.json`, manifest.source);
  await workspace.writeCottagePath(`${root}/scene.json`, manifest.scene);
  await workspace.writeCottagePath(`${root}/warnings.json`, manifest.warnings);
  await workspace.writeCottagePath(`${root}/preview-slides.json`, manifest.previewSlides);
  for (const slide of manifest.previewSlides) {
    const safeId = slide.id.replace(/[^A-Za-z0-9._-]/g, '_');
    await workspace.writeCottagePath(`${root}/slides/${safeId}.html`, slide.html);
    await workspace.writeCottagePath(`${root}/slides/${safeId}.css`, slide.css ?? '');
  }
};

export const markPresentationSourceManifestStale = async (
  outputPath: string,
  reason: string,
): Promise<'stale' | 'absent'> => {
  const manifest = await findPresentationSourceManifest(outputPath);
  if (!manifest) return 'absent';
  const updated = {
    ...manifest,
    status: 'stale',
    staleReason: reason,
    updatedAt: new Date().toISOString(),
  } satisfies PresentationSourceManifest;
  await savePresentationSourceManifest(updated);
  await savePresentationSourceSidecars(updated).catch(() => undefined);
  return 'stale';
};

export const updatePresentationSourceManifestScene = async (
  outputPath: string,
  scene: PresentationScene,
  warnings: PresentationWarning[],
): Promise<'synced' | 'absent'> => {
  const manifest = await findPresentationSourceManifest(outputPath);
  if (!manifest) return 'absent';
  const updated = {
    ...manifest,
    scene,
    warnings,
    status: 'synced',
    staleReason: undefined,
    updatedAt: new Date().toISOString(),
  } satisfies PresentationSourceManifest;
  await savePresentationSourceManifest(updated);
  await savePresentationSourceSidecars(updated).catch(() => undefined);
  return 'synced';
};

const htmlElementByStableName = (html: string, name: string): { document: Document; node: HTMLElement } | null => {
  if (typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const node = [...document.querySelectorAll<HTMLElement>('[data-ppt-element]')]
    .find((candidate) => candidate.dataset.pptElement === name || candidate.dataset.pptName === name);
  return node ? { document, node } : null;
};

const serializeHtmlBody = (document: Document): string => document.body.innerHTML;

export const synchronizePresentationSourceManifest = async (
  outputPath: string,
  operations: PresentationEditOperation[],
  beforeSlides: PresentationSlidePreviewData[],
): Promise<'synced' | 'stale' | 'absent'> => {
  const manifest = await findPresentationSourceManifest(outputPath);
  if (!manifest) return 'absent';
  if (manifest.status === 'stale') return 'stale';
  const source = structuredClone(manifest.source);
  const scene = structuredClone(manifest.scene);
  let staleReason: string | undefined;
  const sourceSlides = source.slides ?? [];

  for (const operation of operations) {
    const slideIndex = operation.slideIndex ?? 0;
    if (operation.op === 'removeSlide') {
      sourceSlides.splice(slideIndex - 1, 1);
      scene.slides.splice(slideIndex - 1, 1);
    } else if (operation.op === 'moveSlide') {
      const sourceSlide = sourceSlides.splice(slideIndex - 1, 1)[0];
      const sceneSlide = scene.slides.splice(slideIndex - 1, 1)[0];
      if (!sourceSlide || !sceneSlide || !operation.targetSlideIndex) staleReason = '页面重排无法映射到 HTML 源稿';
      else {
        sourceSlides.splice(operation.targetSlideIndex - 1, 0, sourceSlide);
        scene.slides.splice(operation.targetSlideIndex - 1, 0, sceneSlide);
      }
    } else if (operation.op === 'duplicateSlide') {
      const sourceSlide = sourceSlides[slideIndex - 1];
      const sceneSlide = scene.slides[slideIndex - 1];
      if (!sourceSlide || !sceneSlide) staleReason = '复制页面无法映射到 HTML 源稿';
      else {
        const insertAt = (operation.targetSlideIndex ?? slideIndex + 1) - 1;
        sourceSlides.splice(insertAt, 0, { ...structuredClone(sourceSlide), id: `${sourceSlide.id ?? `slide-${slideIndex}`}-copy` });
        scene.slides.splice(insertAt, 0, { ...structuredClone(sceneSlide), id: `${sceneSlide.id}-copy` });
      }
    } else if (operation.op === 'updateSlideNotes') {
      const sourceSlide = sourceSlides[slideIndex - 1];
      const sceneSlide = scene.slides[slideIndex - 1];
      if (!sourceSlide || !sceneSlide) staleReason = '备注页面无法映射到 HTML 源稿';
      else {
        sourceSlide.notes = operation.notes ?? '';
        sceneSlide.notes = operation.notes ?? '';
      }
    } else if (operation.op === 'addSlide' || operation.op === 'addElement' || operation.op === 'removeElement') {
      staleReason = `${operation.op} 无法安全同步回 HTML 源稿`;
    } else {
      const preview = beforeSlides[slideIndex - 1]?.elements.find((element) => element.id === operation.elementId);
      const stableName = preview?.name;
      const sourceSlide = sourceSlides[slideIndex - 1];
      const sceneSlide = scene.slides[slideIndex - 1];
      if (!stableName || !sourceSlide?.html || !sceneSlide) {
        staleReason = `元素 ${operation.elementId ?? ''} 无法映射到 HTML 源稿`;
        continue;
      }
      const found = htmlElementByStableName(sourceSlide.html, stableName);
      const sceneElement = sceneSlide.elements.find((element) => element.id === stableName || element.name === stableName);
      if (!found || !sceneElement) {
        staleReason = `元素 ${stableName} 不存在于 HTML 源稿`;
        continue;
      }
      if (operation.op === 'replaceImage') {
        found.node.dataset.pptSrc = operation.imagePath ?? '';
        sceneElement.path = operation.imagePath;
      } else if (operation.op === 'updateTable') {
        const bindingId = found.node.dataset.pptBinding;
        const binding = sourceSlide.tableBindings?.find((item) => item.id === bindingId);
        if (!binding || !operation.rows) staleReason = `表格 ${stableName} 缺少源 binding`;
        else {
          binding.rows = operation.rows;
          sceneElement.rows = operation.rows;
        }
      } else if (operation.op === 'updateChartData') {
        const bindingId = found.node.dataset.pptBinding;
        const binding = sourceSlide.chartBindings?.find((item) => item.id === bindingId);
        if (!binding || !operation.series) staleReason = `图表 ${stableName} 缺少源 binding`;
        else {
          binding.categories = operation.categories;
          binding.series = operation.series;
          sceneElement.categories = operation.categories;
          sceneElement.series = operation.series;
        }
      } else if (operation.op === 'updateElement') {
        const patch = operation.patch ?? {};
        if (patch.x !== undefined || patch.y !== undefined || patch.w !== undefined || patch.h !== undefined
          || patch.zIndex !== undefined || patch.rotate !== undefined || patch.shapeType !== undefined) {
          staleReason = `元素 ${stableName} 的几何修改无法安全同步回流式 HTML`;
          continue;
        }
        Object.assign(sceneElement, patch);
        if (patch.text !== undefined) {
          found.node.textContent = patch.text;
          if (found.node.dataset.pptType === 'shape') found.node.dataset.pptShapeText = patch.text;
        }
        if (patch.color) found.node.style.color = `#${patch.color.replace(/^#/, '')}`;
        if (patch.fill) found.node.style.backgroundColor = `#${patch.fill.replace(/^#/, '')}`;
        if (patch.fontSize) found.node.style.fontSize = `${patch.fontSize * 96 / 72}px`;
        if (patch.bold !== undefined) found.node.style.fontWeight = patch.bold ? '700' : '400';
        if (patch.italic !== undefined) found.node.style.fontStyle = patch.italic ? 'italic' : 'normal';
      }
      sourceSlide.html = serializeHtmlBody(found.document);
    }
    if (staleReason) break;
  }

  scene.slides.forEach((slide, index) => { slide.index = index + 1; });
  source.slides = sourceSlides;
  const updated = {
    ...manifest,
    source,
    scene,
    status: staleReason ? 'stale' : 'synced',
    staleReason,
    updatedAt: new Date().toISOString(),
  } satisfies PresentationSourceManifest;
  await savePresentationSourceManifest(updated);
  await savePresentationSourceSidecars(updated).catch(() => undefined);
  return staleReason ? 'stale' : 'synced';
};
