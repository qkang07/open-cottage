<script setup lang="ts">
import {
  loader,
  VueMonacoDiffEditor,
  VueMonacoEditor } from '@guolao/vue-monaco-editor';
import {
  ChatbubbleOutline,
  CloseOutline,
  OpenOutline,
  SaveOutline,
  InformationCircleOutline,
  } from '@vicons/ionicons5';
import type { editor } from 'monaco-editor';
import {
  ElButton,
  ElButtonGroup,
  ElEmpty,
  ElImage,
  ElPopover
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NSpace,
  NSpin,
  NText
} from '@/ui/element-plus-primitives';
import type {
  DropdownOption
} from '@/ui/element-plus-types';
import { storeToRefs } from 'pinia';
import { computed, h, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  TextAnchor,
  PresentationAnchor,
  SpreadsheetAnchor,
  WordAnchor,
} from '../../chat/fileReferences';
import { getTextAnchorFromWindowSelection } from '../../chat/previewSelection';
import { usePreviewSelectionStore } from '../../stores/previewSelection';
import { useAiChangedFilesStore } from '../../stores/aiChangedFiles';
import { useThemeStore } from '../../stores/theme';
import { isEditablePreview, useWorkspaceStore, workspace } from '../../stores/workspace';
import { supportsRenderPreview, type FilePreview } from '../../workspace/previewKind';
import { isLikelyTextPath } from '../../workspace/search';
import {
  loadAiChangeBaselinePreview,
  readAiChangeBaselineBytes,
} from '../../chat/aiChangeBaseline';
import CodeHighlight from './CodeHighlight.vue';
import { useAddPreviewToChat } from './composables/useAddPreviewToChat';
import { languageFromPath } from './languageFromPath';
import MarkdownPreview from './MarkdownPreview.vue';
import PresentationPreview from './PresentationPreview.vue';
import SpreadsheetPreview from './SpreadsheetPreview.vue';
import WordPreview from './WordPreview.vue';
import ContextMenuPanel from '@/ui/ContextMenuPanel.vue';
type EditablePreviewMode = 'edit' | 'preview' | 'split';
/**
 * HTML 预览沙箱：允许脚本执行（图标 / 图表 / PPT 翻页等），
 * 故意不包含 allow-same-origin，使 iframe 处于不透明源，
 * 无法读写宿主 localStorage / cookie，也无法访问 parent DOM。
 * 与 public/sandbox.html 保持一致。
 */
const HTML_PREVIEW_SANDBOX = 'allow-scripts allow-forms allow-popups allow-modals';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const aiChangedStore = useAiChangedFilesStore();
const previewSelectionStore = usePreviewSelectionStore();
const themeStore = useThemeStore();
const {
  selectedPath,
  previewKind,
  previewContent,
  previewObjectUrl,
  previewSpreadsheet,
  previewWordHtml,
  previewPresentationSlides,
  previewPresentationWarnings,
  previewPresentationSlideWidth,
  previewPresentationSlideHeight,
  previewPresentationSourceManifest,
  previewDirty,
  loading,
} = storeToRefs(workspaceStore);
const { isDark } = storeToRefs(themeStore);
const editorRef = shallowRef<editor.IStandaloneCodeEditor | null>(null);
const selectableRootRef = ref<HTMLDivElement | null>(null);
const saving = ref(false);
const editableMode = ref<EditablePreviewMode>('preview');
const contextMenuShow = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);
const fileStat = ref<{ size: number; modified: number } | null>(null);
const changeViewMode = ref<'current' | 'changes' | 'before'>('current');
const beforePreview = shallowRef<FilePreview | null>(null);
const beforeText = ref<string | null>(null);
const beforeLoading = ref(false);
const beforeError = ref('');
let beforeLoadVersion = 0;
const editorContent = computed({
  get: () => previewContent.value ?? '',
  set: (v: string) => workspaceStore.updatePreviewDraft(v),
});
const editable = computed(() => isEditablePreview(previewKind.value));
const hasRenderPreview = computed(() =>
  previewKind.value ? supportsRenderPreview(previewKind.value) : false,
);
watch([selectedPath, previewKind], () => {
  previewSelectionStore.clearSelection();
  editableMode.value = hasRenderPreview.value ? 'preview' : 'edit';
  changeViewMode.value = 'current';
  clearBeforePreview();
});
watch(
  selectedPath,
  async (path) => {
    if (!path) {
      fileStat.value = null;
      return;
    }
    fileStat.value = await workspace.statFile(path);
  },
  { immediate: true },
);
const getTextArea = (): HTMLTextAreaElement | null => null;
const getEditableTextAnchor = (): TextAnchor | null => {
  const ed = editorRef.value;
  const selection = ed?.getSelection();
  if (!selection || selection.isEmpty()) return null;
  return {
    kind: 'text',
    startLine: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLine: selection.endLineNumber,
    endColumn: selection.endColumn,
  };
};
const getSelectableRoot = () => selectableRootRef.value;
const addToChat = useAddPreviewToChat(
  () => selectedPath.value,
  () => previewKind.value,
  () => previewContent.value,
  getTextArea,
  () => previewSelectionStore.getSelection(),
  getSelectableRoot,
  getEditableTextAnchor,
);
const handleSave = async () => {
  saving.value = true;
  try {
    await workspaceStore.savePreview();
  } finally {
    saving.value = false;
  }
};
const renderIcon = (icon: typeof SaveOutline) => () =>
  h(NIcon, null, { default: () => h(icon) });
const menuOptions = computed<DropdownOption[]>(() => {
  if (!selectedPath.value) return [];
  return [{
    key: 'addToChat',
    label: t('preview.addToChat'),
    icon: renderIcon(ChatbubbleOutline),
  }];
});
const handleMenuSelect = (key: string) => {
  contextMenuShow.value = false;
  if (key === 'addToChat') addToChat();
};
const onPreviewContextMenu = (e: MouseEvent) => {
  e.preventDefault();
  contextMenuX.value = e.clientX;
  contextMenuY.value = e.clientY;
  contextMenuShow.value = true;
};
const onKeyDown = (e: KeyboardEvent) => {
  if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
  const key = e.key.toLowerCase();
  if (key !== 'l' && e.code !== 'KeyL') return;
  if (!selectedPath.value) return;
  e.preventDefault();
  e.stopPropagation();
  addToChat();
};
const onGotoLine = (event: Event) => {
  const detail = (event as CustomEvent<{ path: string; line: number }>).detail;
  if (!detail || detail.path !== selectedPath.value) return;
  const ed = editorRef.value;
  if (!ed) return;
  ed.revealLineInCenter(detail.line);
  ed.setPosition({ lineNumber: detail.line, column: 1 });
  ed.focus();
};
onMounted(() => {
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('cottage:goto-line', onGotoLine);
});
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('cottage:goto-line', onGotoLine);
  clearBeforePreview();
});
const handleSpreadsheetSelect = (anchor: SpreadsheetAnchor | null) => {
  previewSelectionStore.setSelection(anchor);
};
const handleWordSelect = (anchor: WordAnchor | null) => {
  previewSelectionStore.setSelection(anchor);
};
const handlePresentationSelect = (anchor: PresentationAnchor | null) => {
  previewSelectionStore.setSelection(anchor);
};
const handleTextMouseUp = () => {
  if (!previewContent.value || !selectableRootRef.value) return;
  const anchor = getTextAnchorFromWindowSelection(
    previewContent.value,
    selectableRootRef.value,
  );
  previewSelectionStore.setSelection(anchor);
};
const citeShortcutHint = computed(() => {
  const isMac = /mac|iphone|ipad/i.test(navigator.platform);
  return isMac ? '⌘⇧L' : 'Ctrl+Shift+L';
});
const fileExt = computed(() => {
  if (!selectedPath.value) return t('preview.extNone');
  const name = selectedPath.value.split('/').pop() ?? selectedPath.value;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : t('preview.extNone');
});
const modifiedLabel = computed(() => {
  const ts = fileStat.value?.modified;
  if (!ts) return t('common.unknown');
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return String(ts);
  }
});
const fileMetaItems = computed(() => {
  if (!selectedPath.value) return [];
  return [
    { label: t('preview.path'), value: selectedPath.value },
    { label: t('preview.name'), value: fileName.value },
    { label: t('preview.type'), value: previewKind.value ?? t('common.unknown') },
    { label: t('preview.ext'), value: fileExt.value },
    { label: t('preview.size'), value: fileStat.value ? `${fileStat.value.size} B` : t('common.unknown') },
    { label: t('preview.modified'), value: modifiedLabel.value },
  ];
});
const editorLanguage = computed(() =>
  languageFromPath(selectedPath.value ?? ''),
);
const editorOptions = computed<editor.IStandaloneEditorConstructionOptions>(() => ({
  minimap: { enabled: false },
  fontSize: 13,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  theme: isDark.value ? 'vs-dark' : 'vs',
}));
const diffEditorOptions = computed<editor.IDiffEditorConstructionOptions>(() => ({
  readOnly: true,
  originalEditable: false,
  renderSideBySide: true,
  minimap: { enabled: false },
  fontSize: 13,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
}));
const handleEditorMount = (ed: editor.IStandaloneCodeEditor) => {
  editorRef.value = ed;
  void loader.init().then((monaco) => {
    ed.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL,
      () => {
        if (!selectedPath.value) return;
        addToChat();
      },
    );
  });
};
watch(
  isDark,
  (dark) => {
    void loader.init().then((monaco) => {
      monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
    });
  },
  { immediate: true },
);
const fileName = computed(() => {
  if (!selectedPath.value) return t('preview.noFileSelected');
  return selectedPath.value.split('/').pop() ?? selectedPath.value;
});
const segmentedOptions = computed(() => [
  { label: t('preview.modeEdit'), value: 'edit' },
  { label: t('preview.modePreview'), value: 'preview' },
  { label: t('preview.modeSplit'), value: 'split' },
]);

const changedFile = computed(() =>
  selectedPath.value ? aiChangedStore.fileOf(selectedPath.value) : null,
);
const selectedIsText = computed(() =>
  selectedPath.value ? isLikelyTextPath(selectedPath.value) : false,
);
const canViewBefore = computed(() => {
  const reset = changedFile.value?.reset;
  if (selectedIsText.value && reset?.kind === 'delete') return true;
  return reset?.kind === 'restoreText' || reset?.kind === 'restoreBytes';
});

function clearBeforePreview() {
  beforeLoadVersion += 1;
  const preview = beforePreview.value;
  if (preview && 'objectUrl' in preview && preview.objectUrl) {
    URL.revokeObjectURL(preview.objectUrl);
  }
  beforePreview.value = null;
  beforeText.value = null;
  beforeError.value = '';
  beforeLoading.value = false;
}

async function loadBeforeVersion(): Promise<boolean> {
  const path = selectedPath.value;
  const reset = changedFile.value?.reset;
  clearBeforePreview();
  if (!path || !reset) {
    beforeError.value = t('preview.beforeUnavailable');
    return false;
  }
  const version = ++beforeLoadVersion;
  beforeLoading.value = true;
  try {
    if (reset.kind === 'delete' && selectedIsText.value) {
      beforeText.value = '';
      return true;
    }
    if (reset.kind === 'delete') throw new Error(t('preview.beforeUnavailable'));
    if (reset.kind === 'restoreText') {
      beforeText.value = reset.content;
      return true;
    }
    if (selectedIsText.value) {
      const bytes = await readAiChangeBaselineBytes(reset.baseline);
      if (!bytes) throw new Error(t('preview.beforeUnavailable'));
      if (version !== beforeLoadVersion) return false;
      beforeText.value = new TextDecoder().decode(bytes);
      return true;
    }
    const loaded = await loadAiChangeBaselinePreview(path, reset.baseline);
    if (!loaded) throw new Error(t('preview.beforeUnavailable'));
    if (version !== beforeLoadVersion) {
      if ('objectUrl' in loaded && loaded.objectUrl) URL.revokeObjectURL(loaded.objectUrl);
      return false;
    }
    beforePreview.value = loaded;
    return true;
  } catch (error) {
    if (version === beforeLoadVersion) {
      beforeError.value = error instanceof Error ? error.message : String(error);
    }
    return false;
  } finally {
    if (version === beforeLoadVersion) beforeLoading.value = false;
  }
}

async function switchChangeViewMode(mode: 'current' | 'changes' | 'before') {
  if (mode === 'current') {
    changeViewMode.value = mode;
    clearBeforePreview();
    return;
  }
  if (!canViewBefore.value) return;
  changeViewMode.value = mode;
  await loadBeforeVersion();
}

watch(
  () => aiChangedStore.reviewRequest?.nonce,
  () => {
    const request = aiChangedStore.reviewRequest;
    if (!request || request.path !== selectedPath.value) return;
    void switchChangeViewMode(request.mode);
  },
);
</script>
<template>
  <div class="panel preview-panel">
    <div v-if="selectedPath" class="panel-header preview-panel-header">
      <NText strong class="preview-title-name" :ellipsis="{ tooltip: true }">
        {{ fileName }}{{ previewDirty ? t('preview.unsaved') : '' }}
      </NText>
      <NSpace :size="8" class="preview-header-actions">
        <NText
          v-if="selectedPath"
          depth="3"
          class="preview-cite-hint"
        >
          {{ t('preview.citeShortcut', { keys: citeShortcutHint }) }}
        </NText>
        <ElButtonGroup v-if="changedFile">
          <ElButton
            :type="changeViewMode === 'current' ? 'primary' : 'default'"
            @click="switchChangeViewMode('current')"
          >
            {{ t('preview.changeModeCurrent') }}
          </ElButton>
          <ElButton
            v-if="selectedIsText"
            :type="changeViewMode === 'changes' ? 'primary' : 'default'"
            :disabled="!canViewBefore"
            @click="switchChangeViewMode('changes')"
          >
            {{ t('preview.changeModeDiff') }}
          </ElButton>
          <ElButton
            v-else
            :type="changeViewMode === 'before' ? 'primary' : 'default'"
            :disabled="!canViewBefore"
            @click="switchChangeViewMode('before')"
          >
            {{ t('preview.changeModeBefore') }}
          </ElButton>
        </ElButtonGroup>
        <ElButtonGroup v-if="changeViewMode === 'current' && editable && hasRenderPreview">
          <ElButton
            v-for="opt in segmentedOptions"
            :key="opt.value"
            :type="editableMode === opt.value ? 'primary' : 'default'"
            @click="editableMode = opt.value as EditablePreviewMode"
          >
            {{ opt.label }}
          </ElButton>
        </ElButtonGroup>
        <ElButton
          v-if="changeViewMode === 'current' && editable"
          type="primary"
          :disabled="!previewDirty"
          :loading="saving"
          @click="handleSave"
        >
          <template #icon>
            <NIcon :component="SaveOutline" />
          </template>
          {{ t('common.save') }}
        </ElButton>
        <ElButton
          v-if="previewKind === 'html'"
          text
          @click="workspaceStore.openHtmlPreview()"
        >
          <template #icon>
            <NIcon :component="OpenOutline" />
          </template>
          {{ t('preview.openInNewWindow') }}
        </ElButton>
        <ElPopover
          v-if="selectedPath"
          placement="bottom-end"
          trigger="click"
          width="360"
        >
          <template #reference>
            <ElButton class="cottage-icon-btn" :aria-label="t('preview.fileInfo')">
              <template #icon>
                <NIcon :component="InformationCircleOutline" />
              </template>
            </ElButton>
          </template>
          <div class="preview-file-meta-popover">
            <div
              v-for="item in fileMetaItems"
              :key="item.label"
              class="preview-file-meta-row"
            >
              <span class="preview-file-meta-label">{{ item.label }}</span>
              <span class="preview-file-meta-value">{{ item.value }}</span>
            </div>
          </div>
        </ElPopover>
        <CottageTooltip :content="t('preview.closePreview')" placement="top">
          <ElButton
            v-if="selectedPath"
            class="cottage-icon-btn"
            @click="workspaceStore.clearPreview()"
          >
            <template #icon>
              <NIcon :component="CloseOutline" />
            </template>
          </ElButton>
        </CottageTooltip>
      </NSpace>
    </div>
    <div class="panel-body preview-body">
      <div v-if="loading && selectedPath" class="centered">
        <NSpin size="small" />
      </div>
      <div
        v-else-if="selectedPath"
        class="preview-context-menu-area"
        @contextmenu="onPreviewContextMenu"
      >
        <ContextMenuPanel
          :show="contextMenuShow"
          :x="contextMenuX"
          :y="contextMenuY"
          :options="menuOptions"
          @select="handleMenuSelect(String($event))"
          @clickoutside="contextMenuShow = false"
          @update:show="contextMenuShow = $event"
        />
        <div class="preview-context-inner">
          <template v-if="selectedPath && previewKind">
            <div v-if="changeViewMode === 'changes'" class="change-review-view">
              <div v-if="beforeLoading" class="centered"><NSpin size="small" /></div>
              <ElEmpty v-else-if="beforeError || beforeText === null" :description="beforeError || t('preview.beforeUnavailable')" />
              <VueMonacoDiffEditor
                v-else
                :original="beforeText"
                :modified="previewContent ?? ''"
                :language="editorLanguage"
                :original-model-path="`cottage-before://${selectedPath}`"
                :modified-model-path="`cottage-current://${selectedPath}`"
                height="100%"
                :theme="isDark ? 'vs-dark' : 'vs'"
                :options="diffEditorOptions"
              />
            </div>
            <div v-else-if="changeViewMode === 'before'" class="change-review-view">
              <div v-if="beforeLoading" class="centered"><NSpin size="small" /></div>
              <ElEmpty v-else-if="beforeError || !beforePreview" :description="beforeError || t('preview.beforeUnavailable')" />
              <SpreadsheetPreview
                v-else-if="beforePreview.kind === 'spreadsheet'"
                :data="beforePreview.data"
              />
              <WordPreview
                v-else-if="beforePreview.kind === 'word'"
                :html="beforePreview.html"
              />
              <PresentationPreview
                v-else-if="beforePreview.kind === 'presentation'"
                :slides="beforePreview.slides"
                :warnings="beforePreview.warnings"
                :slide-width="beforePreview.slideWidth"
                :slide-height="beforePreview.slideHeight"
                :source-manifest="beforePreview.sourceManifest"
              />
              <div v-else-if="beforePreview.kind === 'image'" class="media-preview-wrap">
                <ElImage :src="beforePreview.objectUrl" :alt="selectedPath" class="media-preview" object-fit="contain" />
              </div>
              <video
                v-else-if="beforePreview.kind === 'video'"
                :src="beforePreview.objectUrl"
                controls
                class="media-preview video-preview"
              />
              <iframe
                v-else-if="beforePreview.kind === 'pdf'"
                :src="beforePreview.objectUrl"
                :title="selectedPath"
                class="pdf-preview"
              />
              <ElEmpty v-else :description="t('preview.beforeUnavailable')" />
            </div>
            <template v-else-if="editable">
              <template v-if="editableMode === 'preview'">
                <div
                  v-if="previewContent === null"
                >
                  <ElEmpty :description="t('preview.loadFailed')" />
                </div>
                <div
                  v-else-if="previewKind === 'markdown'"
                  ref="selectableRootRef"
                  class="selectable-preview editable-render-preview"
                  @mouseup="handleTextMouseUp"
                >
                  <MarkdownPreview :content="previewContent" />
                </div>
                <iframe
                  v-else-if="previewKind === 'html'"
                  class="html-inline-preview"
                  :title="selectedPath ?? t('preview.htmlPreview')"
                  :srcdoc="previewContent"
                  :sandbox="HTML_PREVIEW_SANDBOX"
                />
                <div
                  v-else
                  class="file-editor"
                >
                  <VueMonacoEditor
                    v-model:value="editorContent"
                    height="100%"
                    :language="editorLanguage"
                    :options="editorOptions"
                    @mount="handleEditorMount"
                    @change="(v) => workspaceStore.updatePreviewDraft(v ?? '')"
                  />
                </div>
              </template>
              <div
                v-else-if="editableMode === 'split'"
                class="editable-split-preview"
              >
                <div class="editable-split-pane">
                  <div
                    class="file-editor"
                  >
                    <VueMonacoEditor
                      v-model:value="editorContent"
                      height="100%"
                      :language="editorLanguage"
                      :options="editorOptions"
                      @mount="handleEditorMount"
                      @change="(v) => workspaceStore.updatePreviewDraft(v ?? '')"
                    />
                  </div>
                </div>
                <div class="editable-split-pane">
                  <div
                    v-if="previewContent === null"
                  >
                    <ElEmpty :description="t('preview.loadFailed')" />
                  </div>
                  <div
                    v-else-if="previewKind === 'markdown'"
                    ref="selectableRootRef"
                    class="selectable-preview editable-render-preview"
                    @mouseup="handleTextMouseUp"
                  >
                    <MarkdownPreview :content="previewContent" />
                  </div>
                  <iframe
                    v-else-if="previewKind === 'html'"
                    class="html-inline-preview"
                    :title="selectedPath ?? t('preview.htmlPreview')"
                    :srcdoc="previewContent"
                    :sandbox="HTML_PREVIEW_SANDBOX"
                  />
                </div>
              </div>
              <div v-else class="editable-full">
                <div
                  class="file-editor"
                >
                  <VueMonacoEditor
                    v-model:value="editorContent"
                    height="100%"
                    :language="editorLanguage"
                    :options="editorOptions"
                    @mount="handleEditorMount"
                    @change="(v) => workspaceStore.updatePreviewDraft(v ?? '')"
                  />
                </div>
              </div>
            </template>
            <template v-else>
              <div
                v-if="previewKind === 'markdown'"
              >
                <div
                  v-if="previewContent !== null"
                  ref="selectableRootRef"
                  class="selectable-preview"
                  @mouseup="handleTextMouseUp"
                >
                  <MarkdownPreview :content="previewContent" />
                </div>
                <ElEmpty v-else :description="t('preview.loadMdFailed')" />
              </div>
              <div v-else-if="previewKind === 'text'" class="preview-text-wrap">
                <div
                  v-if="previewContent !== null"
                  ref="selectableRootRef"
                  class="selectable-preview"
                  @mouseup="handleTextMouseUp"
                >
                  <CodeHighlight
                    :code="previewContent"
                    :language="editorLanguage"
                    class-name="code-preview-highlight"
                  />
                </div>
                <ElEmpty v-else :description="t('preview.loadFailed')" />
              </div>
              <SpreadsheetPreview
                v-else-if="previewKind === 'spreadsheet' && previewSpreadsheet"
                :key="selectedPath"
                :data="previewSpreadsheet"
                :on-range-select="handleSpreadsheetSelect"
              />
              <ElEmpty
                v-else-if="previewKind === 'spreadsheet'"
                :description="t('preview.loadTableFailed')"
              />
              <WordPreview
                v-else-if="previewKind === 'word' && previewWordHtml"
                :html="previewWordHtml"
                :on-selection-change="handleWordSelect"
              />
              <ElEmpty
                v-else-if="previewKind === 'word'"
                :description="t('preview.loadWordFailed')"
              />
              <PresentationPreview
                v-else-if="previewKind === 'presentation' && previewPresentationSlides"
                :slides="previewPresentationSlides"
                :warnings="previewPresentationWarnings"
                :slide-width="previewPresentationSlideWidth"
                :slide-height="previewPresentationSlideHeight"
                :source-manifest="previewPresentationSourceManifest"
                :on-selection-change="handlePresentationSelect"
              />
              <ElEmpty
                v-else-if="previewKind === 'presentation'"
                :description="t('preview.loadPptFailed')"
              />
              <div
                v-else-if="previewKind === 'image' && previewObjectUrl"
                class="media-preview-wrap"
              >
                <ElImage
                  :src="previewObjectUrl"
                  :alt="selectedPath"
                  class="media-preview"
                  object-fit="contain"
                />
              </div>
              <ElEmpty
                v-else-if="previewKind === 'image'"
                :description="t('preview.loadImageFailed')"
              />
              <video
                v-else-if="previewKind === 'video' && previewObjectUrl"
                :src="previewObjectUrl"
                controls
                class="media-preview video-preview"
              />
              <ElEmpty
                v-else-if="previewKind === 'video'"
                :description="t('preview.loadVideoFailed')"
              />
              <iframe
                v-else-if="previewKind === 'pdf' && previewObjectUrl"
                :src="previewObjectUrl"
                :title="selectedPath ?? 'PDF'"
                class="pdf-preview"
              />
              <ElEmpty
                v-else-if="previewKind === 'pdf'"
                :description="t('preview.loadPdfFailed')"
              />
              <ElEmpty v-else :description="t('preview.unsupportedType')" />
            </template>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
