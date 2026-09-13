<script setup lang="ts">
import { ElEmpty, ElTag } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { getPresentationAnchorFromSelection } from '../../chat/previewSelection';
import type { PresentationAnchor } from '../../chat/fileReferences';
import type { PresentationWarning } from '../../domains/office/presentationModel';
import type { PresentationSourceManifest } from '../../domains/office/presentationSourceManifest';
import type { PresentationSlidePreview } from '../../workspace/previewKind';
import PresentationSlideCanvas from './PresentationSlideCanvas.vue';

const props = defineProps<{
  slides: PresentationSlidePreview[];
  warnings?: PresentationWarning[];
  onSelectionChange?: (anchor: PresentationAnchor | null) => void;
  slideWidth?: number;
  slideHeight?: number;
  sourceManifest?: PresentationSourceManifest | null;
}>();

const rootRef = ref<HTMLDivElement | null>(null);
const activeSlideIndex = ref(props.slides[0]?.index ?? 1);
const selectedElementId = ref<string | null>(null);
const showTextLayer = ref(false);
const viewMode = ref<'design' | 'structure' | 'export'>(props.sourceManifest ? 'design' : 'export');

const activeSlide = computed(() =>
  props.slides.find((slide) => slide.index === activeSlideIndex.value) ?? props.slides[0]);
const activePosition = computed(() =>
  Math.max(0, props.slides.findIndex((slide) => slide.index === activeSlide.value?.index)));
const activeWarnings = computed(() =>
  props.warnings?.filter((warning) => warning.slideIndex === activeSlide.value?.index) ?? []);
const activeTitle = computed(() =>
  activeSlide.value?.texts.find((text) => text.trim())?.trim() || `幻灯片 ${activeSlide.value?.index ?? 1}`);
const activeDesignSlide = computed(() => props.sourceManifest?.previewSlides?.[activePosition.value]);
const designSrcdoc = computed(() => {
  const slide = activeDesignSlide.value;
  if (!slide) return '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data: blob:"><style>${slide.css ?? ''}\nhtml,body{margin:0;width:100%;height:100%;overflow:hidden}section[data-ppt-slide]{width:100%!important;height:100%!important}</style></head><body>${slide.html}</body></html>`;
});
const stageAspect = computed(() => `${props.slideWidth ?? 13.333} / ${props.slideHeight ?? 7.5}`);

watch(() => props.slides, (slides) => {
  if (!slides.some((slide) => slide.index === activeSlideIndex.value)) {
    activeSlideIndex.value = slides[0]?.index ?? 1;
  }
}, { deep: false });
watch(() => props.sourceManifest, (manifest) => {
  if (!manifest && viewMode.value === 'design') viewMode.value = 'export';
}, { deep: false });

const selectSlide = (slideIndex: number) => {
  activeSlideIndex.value = slideIndex;
  selectedElementId.value = null;
  props.onSelectionChange?.({ kind: 'presentation', slideIndex });
};
const goToPosition = (position: number) => {
  const slide = props.slides[Math.max(0, Math.min(props.slides.length - 1, position))];
  if (slide) selectSlide(slide.index);
};
const selectElement = (elementId: string, text?: string) => {
  if (!activeSlide.value) return;
  selectedElementId.value = elementId;
  props.onSelectionChange?.({
    kind: 'presentation',
    slideIndex: activeSlide.value.index,
    elementId,
    selectedText: text?.trim() || undefined,
  });
};
const handleMouseUp = () => {
  if (!rootRef.value || !props.onSelectionChange) return;
  const anchor = getPresentationAnchorFromSelection(rootRef.value);
  if (anchor) {
    selectedElementId.value = anchor.elementId ?? null;
    props.onSelectionChange(anchor);
  }
};
const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    goToPosition(activePosition.value - 1);
  } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
    event.preventDefault();
    goToPosition(activePosition.value + 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    goToPosition(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    goToPosition(props.slides.length - 1);
  }
};
</script>

<template>
  <ElEmpty v-if="!slides.length" description="演示文稿无幻灯片" />
  <div
    v-else
    ref="rootRef"
    class="office-preview presentation-preview selectable-preview"
    tabindex="0"
    @keydown="handleKeydown"
    @mouseup="handleMouseUp"
  >
    <header class="presentation-toolbar">
      <div class="presentation-toolbar-title">
        <span class="presentation-toolbar-name" :title="activeTitle">{{ activeTitle }}</span>
        <span class="presentation-page-count">{{ activePosition + 1 }} / {{ slides.length }}</span>
      </div>
      <div class="presentation-toolbar-actions">
        <div class="presentation-view-tabs" role="tablist" aria-label="PPT 预览模式">
          <button
            v-if="sourceManifest"
            type="button"
            class="presentation-view-tab"
            :class="{ 'is-active': viewMode === 'design' }"
            @click="viewMode = 'design'"
          >设计稿</button>
          <button
            type="button"
            class="presentation-view-tab"
            :class="{ 'is-active': viewMode === 'structure' }"
            @click="viewMode = 'structure'"
          >元素结构</button>
          <button
            type="button"
            class="presentation-view-tab"
            :class="{ 'is-active': viewMode === 'export' }"
            @click="viewMode = 'export'"
          >导出结构</button>
        </div>
        <button
          type="button"
          class="presentation-toolbar-button"
          :disabled="activePosition === 0"
          aria-label="上一张幻灯片"
          @click="goToPosition(activePosition - 1)"
        >‹</button>
        <button
          type="button"
          class="presentation-toolbar-button"
          :disabled="activePosition >= slides.length - 1"
          aria-label="下一张幻灯片"
          @click="goToPosition(activePosition + 1)"
        >›</button>
      </div>
    </header>

    <div class="presentation-viewer-body">
      <aside class="presentation-thumbnails" aria-label="幻灯片缩略图">
        <button
          v-for="slide in slides"
          :key="slide.id"
          type="button"
          class="presentation-thumbnail"
          :class="{ 'is-active': slide.index === activeSlide?.index }"
          :aria-label="`查看第 ${slide.index} 张幻灯片`"
          :aria-current="slide.index === activeSlide?.index ? 'true' : undefined"
          @click="selectSlide(slide.index)"
        >
          <span class="presentation-thumbnail-number">{{ slide.index }}</span>
          <span class="presentation-thumbnail-canvas" :style="{ aspectRatio: stageAspect }">
            <PresentationSlideCanvas
              :slide="slide"
              :slide-width="slideWidth"
              :slide-height="slideHeight"
            />
          </span>
          <span
            v-if="warnings?.some((warning) => warning.slideIndex === slide.index)"
            class="presentation-thumbnail-warning"
            :title="`第 ${slide.index} 页存在版式警告`"
          >!</span>
        </button>
      </aside>

      <section v-if="activeSlide" class="presentation-stage-panel">
        <div class="presentation-stage-scroll">
          <div
            class="presentation-stage"
            :style="{ aspectRatio: stageAspect }"
            :data-slide-index="activeSlide.index"
            :aria-label="`幻灯片 ${activeSlide.index}`"
          >
            <iframe
              v-if="viewMode === 'design' && activeDesignSlide"
              class="presentation-design-frame"
              sandbox=""
              :srcdoc="designSrcdoc"
              title="PPT 临时设计稿"
            />
            <PresentationSlideCanvas
              v-else
              :slide="activeSlide"
              interactive
              :show-labels="viewMode === 'structure'"
              :slide-width="slideWidth"
              :slide-height="slideHeight"
              :selected-element-id="selectedElementId"
              @select-element="selectElement"
            />
          </div>
        </div>

        <footer class="presentation-statusbar">
          <div class="presentation-status-copy">
            <span>第 {{ activeSlide.index }} 页</span>
            <span>{{ viewMode === 'design' ? (sourceManifest?.status === 'draft' ? 'PPT 临时设计稿' : 'HTML 设计稿') : viewMode === 'structure' ? '元素结构' : 'OOXML 近似预览' }}</span>
            <span>{{ activeSlide.elements.length }} 个元素</span>
          </div>
          <div class="presentation-status-tags">
            <ElTag v-if="activeWarnings.length" size="small" type="danger" effect="plain">
              {{ activeWarnings.length }} 项警告
            </ElTag>
            <ElTag v-if="activeSlide.elements.some((element) => !element.editable)" size="small" type="warning" effect="plain">
              含只读对象
            </ElTag>
            <ElTag v-if="sourceManifest?.status === 'stale'" size="small" type="warning" effect="plain">
              源稿已过期
            </ElTag>
            <ElTag v-else-if="sourceManifest?.status === 'draft'" size="small" type="info" effect="plain">
              PPT 临时设计稿
            </ElTag>
            <button
              v-if="activeSlide.texts.length"
              type="button"
              class="presentation-text-toggle"
              :aria-expanded="showTextLayer"
              @click="showTextLayer = !showTextLayer"
            >{{ showTextLayer ? '收起文字层' : '查看文字层' }}</button>
          </div>
        </footer>

        <div v-if="activeWarnings.length" class="presentation-warning-list" aria-label="当前页版式警告">
          <button
            v-for="warning in activeWarnings"
            :key="`${warning.code}-${warning.elementId}`"
            type="button"
            class="presentation-warning-item"
            @click="warning.elementId && selectElement(warning.elementId)"
          >
            {{ warning.message }}
          </button>
        </div>

        <ol
          v-if="showTextLayer && activeSlide.texts.length"
          class="presentation-slide-texts presentation-text-layer"
          :data-slide-index="activeSlide.index"
        >
          <li
            v-for="(text, index) in activeSlide.texts"
            :key="`${activeSlide.index}-${index}`"
            :data-element-id="activeSlide.elements.find((element) => element.texts.includes(text))?.id"
          >{{ text }}</li>
        </ol>
      </section>
    </div>
  </div>
</template>

<style scoped>
.presentation-preview {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  overflow: hidden;
  container-type: inline-size;
  color: var(--cottage-ink);
  background: var(--cottage-surface-sunken);
  outline: none;
}
.presentation-preview:focus-visible { box-shadow: inset 0 0 0 1px var(--el-color-primary); }
.presentation-toolbar {
  display: flex;
  flex: 0 0 44px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid var(--cottage-border);
  background: color-mix(in srgb, var(--cottage-surface) 94%, transparent);
}
.presentation-toolbar-title,
.presentation-toolbar-actions,
.presentation-status-copy,
.presentation-status-tags {
  display: flex;
  align-items: center;
}
.presentation-toolbar-title { gap: 9px; min-width: 0; }
.presentation-toolbar-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.presentation-page-count { color: var(--cottage-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.presentation-toolbar-actions { gap: 4px; }
.presentation-view-tabs { display: flex; gap: 2px; margin-right: 6px; padding: 2px; border-radius: 7px; background: var(--cottage-surface-sunken); }
.presentation-view-tab { padding: 4px 8px; border: 0; border-radius: 5px; background: transparent; color: var(--cottage-muted); font-size: 11px; cursor: pointer; }
.presentation-view-tab.is-active { background: var(--cottage-surface); color: var(--el-color-primary); box-shadow: 0 1px 3px rgb(15 23 42 / 12%); }
.presentation-toolbar-button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--cottage-border);
  border-radius: 7px;
  background: var(--cottage-surface);
  color: var(--cottage-ink-soft);
  font: 20px/1 sans-serif;
  cursor: pointer;
}
.presentation-toolbar-button:hover:not(:disabled) { border-color: var(--el-color-primary); color: var(--el-color-primary); }
.presentation-toolbar-button:disabled { cursor: default; opacity: 0.38; }
.presentation-viewer-body {
  display: grid;
  grid-template-columns: 172px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.presentation-thumbnails {
  min-width: 0;
  overflow-y: auto;
  padding: 10px 9px 18px;
  border-right: 1px solid var(--cottage-border);
  background: color-mix(in srgb, var(--cottage-surface) 72%, var(--cottage-surface-sunken));
  scrollbar-gutter: stable;
}
.presentation-thumbnail {
  position: relative;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: start;
  width: 100%;
  margin: 0 0 9px;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--cottage-muted);
  cursor: pointer;
}
.presentation-thumbnail:hover { background: var(--cottage-surface); }
.presentation-thumbnail.is-active {
  border-color: color-mix(in srgb, var(--el-color-primary) 70%, var(--cottage-border));
  background: var(--cottage-surface);
  color: var(--el-color-primary);
  box-shadow: 0 3px 12px rgb(15 23 42 / 8%);
}
.presentation-thumbnail-number {
  padding-top: 3px;
  font-size: 11px;
  line-height: 1;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.presentation-thumbnail-canvas {
  display: block;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--cottage-border) 85%, #0000);
  border-radius: 4px;
  background: #fff;
  box-shadow: 0 2px 7px rgb(15 23 42 / 9%);
}
.presentation-thumbnail-warning {
  position: absolute;
  right: 0;
  bottom: -2px;
  display: grid;
  width: 16px;
  height: 16px;
  place-items: center;
  border-radius: 50%;
  background: var(--el-color-danger);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
}
.presentation-stage-panel {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}
.presentation-stage-scroll {
  display: grid;
  flex: 1;
  min-height: 0;
  overflow: auto;
  place-items: center;
  padding: clamp(12px, 2.5vw, 28px);
  background:
    radial-gradient(circle at 50% 35%, rgb(255 255 255 / 55%), transparent 58%),
    var(--cottage-surface-sunken);
}
.presentation-stage {
  width: min(100%, 1180px);
  overflow: hidden;
  flex: 0 0 auto;
  border: 1px solid color-mix(in srgb, var(--cottage-border) 86%, #0000);
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 18px 46px rgb(15 23 42 / 16%), 0 3px 10px rgb(15 23 42 / 10%);
}
.presentation-design-frame { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
.presentation-statusbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 38px;
  padding: 5px 12px;
  border-top: 1px solid var(--cottage-border);
  background: var(--cottage-surface);
  font-size: 11px;
}
.presentation-status-copy { gap: 12px; color: var(--cottage-muted); }
.presentation-status-tags { justify-content: flex-end; gap: 6px; }
.presentation-text-toggle {
  padding: 3px 7px;
  border: none;
  background: transparent;
  color: var(--el-color-primary);
  font: inherit;
  cursor: pointer;
}
.presentation-warning-list,
.presentation-text-layer {
  flex: 0 0 auto;
  max-height: 112px;
  margin: 0;
  overflow: auto;
  border-top: 1px solid var(--cottage-border);
  background: var(--cottage-surface);
  color: var(--cottage-ink-soft);
  font-size: 12px;
  line-height: 1.5;
}
.presentation-warning-list { padding: 8px 14px; color: var(--el-color-danger); }
.presentation-warning-item { display: block; width: 100%; padding: 2px 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.presentation-text-layer { padding: 8px 18px 10px 36px; }
.presentation-text-layer li { margin: 2px 0; }

@container (max-width: 720px) {
  .presentation-viewer-body { grid-template-columns: 1fr; grid-template-rows: 104px minmax(0, 1fr); }
  .presentation-thumbnails {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 7px 10px;
    border-right: none;
    border-bottom: 1px solid var(--cottage-border);
  }
  .presentation-thumbnail {
    grid-template-columns: 18px 116px;
    flex: 0 0 146px;
    margin: 0;
  }
  .presentation-status-copy span:nth-child(2),
  .presentation-status-copy span:nth-child(3) { display: none; }
}
</style>
