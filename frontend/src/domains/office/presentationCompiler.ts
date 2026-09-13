import { workspace } from '../../workspace/FileSystemWorkspace';
import type {
  PresentationDeckSpecV3,
  PresentationScene,
  PresentationWarning,
} from './presentationModel';
import { compilePresentationHtml } from './presentationHtmlCompiler';
import {
  presentationDraftId,
  readPresentationSourceManifest,
  savePresentationSourceManifest,
  savePresentationSourceSidecars,
  type PresentationSourceManifest,
} from './presentationSourceManifest';
import {
  applyNativePresentationTemplate,
  inspectPresentationBytes,
  validatePresentationPackage,
} from './presentationOoxml';
import { renderPresentationSceneBytes } from './presentationRenderer';

export type PresentationRoundtripSummary = {
  expectedSlides: number;
  actualSlides: number;
  expectedElements: number;
  matchedElements: number;
  coordinateMismatchCount: number;
};

export type PresentationV3WriteResult = {
  path?: string;
  written: boolean;
  draftOnly: boolean;
  pipeline: 'html-layout';
  draftId: string;
  slideCount: number;
  warnings: PresentationWarning[];
  degradedElements: string[];
  roundtripSummary?: PresentationRoundtripSummary;
  sourceManifestStatus: 'draft' | 'synced';
};

const resolveDraftSource = async (input: PresentationDeckSpecV3): Promise<PresentationDeckSpecV3> => {
  if (!input.sourceDraftId) return input;
  const manifest = await readPresentationSourceManifest(input.sourceDraftId);
  if (!manifest) throw new Error(`PPT 临时设计稿不存在: ${input.sourceDraftId}`);
  if (manifest.status === 'stale') throw new Error(`PPT 临时设计稿已过期: ${manifest.staleReason ?? input.sourceDraftId}`);
  return {
    ...manifest.source,
    ...input,
    version: 3,
    pipeline: 'html-layout',
    slides: input.slides?.length ? input.slides : manifest.source.slides,
    // 提交稿的引用字段不是内容本身，避免提交后生成新的 draftId 并留下重复源稿。
    sourceDraftId: undefined,
    draftOnly: input.draftOnly ?? false,
  };
};

const templateSlideIndices = (
  input: PresentationDeckSpecV3,
  representativeSlides: number[] | undefined,
): number[] => {
  const preferred = input.referenceSlideIndices?.filter((value) => Number.isInteger(value) && value > 0) ?? [];
  const defaults = representativeSlides?.length ? representativeSlides : [1];
  return (input.slides ?? []).map((slide, index) =>
    slide.templateSlideIndex ?? preferred[index % Math.max(1, preferred.length)] ?? defaults[index % defaults.length] ?? 1);
};

const addWarningOnce = (warnings: PresentationWarning[], warning: PresentationWarning): void => {
  if (!warnings.some((item) => item.code === warning.code && item.slideIndex === warning.slideIndex && item.elementId === warning.elementId && item.message === warning.message)) {
    warnings.push(warning);
  }
};

const roundtrip = async (
  bytes: Uint8Array,
  scene: PresentationScene,
  warnings: PresentationWarning[],
): Promise<PresentationRoundtripSummary> => {
  const inspected = await inspectPresentationBytes(bytes, { includeElements: true });
  let expectedElements = 0;
  let matchedElements = 0;
  let coordinateMismatchCount = 0;
  if (inspected.slides.length !== scene.slides.length) addWarningOnce(warnings, {
    code: 'roundtrip_mismatch', slideIndex: 1,
    message: `PPTX 回读页数不一致：预期 ${scene.slides.length}，实际 ${inspected.slides.length}`,
  });
  for (const slide of scene.slides) {
    const actualSlide = inspected.slides[slide.index - 1];
    for (const element of slide.elements) {
      expectedElements += 1;
      const actual = actualSlide?.elements.find((candidate) => candidate.name === (element.name?.trim() || element.id));
      if (!actual) {
        addWarningOnce(warnings, {
          code: 'roundtrip_mismatch', slideIndex: slide.index, elementId: element.id,
          message: `元素 ${element.id} 未在生成的 PPTX 中回读到`,
        });
        continue;
      }
      matchedElements += 1;
      const drift = Math.max(
        Math.abs(actual.x - element.x), Math.abs(actual.y - element.y),
        Math.abs(actual.w - element.w), Math.abs(actual.h - element.h),
      );
      if (drift > 0.04) {
        coordinateMismatchCount += 1;
        addWarningOnce(warnings, {
          code: 'roundtrip_mismatch', slideIndex: slide.index, elementId: element.id,
          message: `元素 ${element.id} 的 PPTX 回读坐标偏差为 ${drift.toFixed(3)} 英寸`,
        });
      }
    }
  }
  return {
    expectedSlides: scene.slides.length,
    actualSlides: inspected.slides.length,
    expectedElements,
    matchedElements,
    coordinateMismatchCount,
  };
};

export const writePresentationV3 = async (
  path: string,
  rawInput: PresentationDeckSpecV3,
): Promise<PresentationV3WriteResult> => {
  const input = await resolveDraftSource(rawInput);
  const compiled = await compilePresentationHtml(input);
  const id = await presentationDraftId(input);
  const now = new Date().toISOString();
  const baseManifest: PresentationSourceManifest = {
    version: 1,
    draftId: id.draftId,
    contentHash: id.contentHash,
    createdAt: now,
    updatedAt: now,
    status: input.draftOnly ? 'draft' : 'synced',
    source: input,
    previewSlides: compiled.sanitizedSlides,
    scene: compiled.scene,
    warnings: compiled.warnings,
  };
  if (input.draftOnly) {
    await savePresentationSourceManifest(baseManifest);
    await savePresentationSourceSidecars(baseManifest).catch(() => undefined);
    return {
      written: false,
      draftOnly: true,
      pipeline: 'html-layout',
      draftId: id.draftId,
      slideCount: compiled.scene.slides.length,
      warnings: compiled.warnings,
      degradedElements: compiled.degradedElements,
      sourceManifestStatus: 'draft',
    };
  }

  let bytes = await renderPresentationSceneBytes(compiled.scene, input);
  if (input.referenceMode === 'native-template') {
    const templateBytes = await workspace.readFileBytes(input.referencePath!);
    const applied = await applyNativePresentationTemplate(
      templateBytes,
      bytes,
      templateSlideIndices(input, compiled.styleProfile?.representativeSlides),
    );
    bytes = applied.bytes;
    if (!applied.preservedDecorationCount) addWarningOnce(compiled.warnings, {
      code: 'template_fidelity_limited', slideIndex: 1,
      message: '模板母版与版式已保留，但没有识别到可安全复制的页面级装饰对象',
    });
  }
  await validatePresentationPackage(bytes);
  const roundtripSummary = await roundtrip(bytes, compiled.scene, compiled.warnings);
  const syncedManifest: PresentationSourceManifest = {
    ...baseManifest,
    outputPath: path,
    status: 'synced',
    warnings: compiled.warnings,
    updatedAt: new Date().toISOString(),
  };
  await workspace.writeFileBytes(path, bytes);
  await savePresentationSourceManifest(syncedManifest);
  await savePresentationSourceSidecars(syncedManifest).catch(() => undefined);
  return {
    path,
    written: true,
    draftOnly: false,
    pipeline: 'html-layout',
    draftId: id.draftId,
    slideCount: compiled.scene.slides.length,
    warnings: compiled.warnings,
    degradedElements: compiled.degradedElements,
    roundtripSummary,
    sourceManifestStatus: 'synced',
  };
};
