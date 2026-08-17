import {
  ElMessage
} from 'element-plus';
import { formatReferenceLabel } from '../../../chat/fileReferences';
import {
  getPresentationAnchorFromSelection,
  getTextAnchorFromTextarea,
  getTextAnchorFromWindowSelection,
  getWordAnchorFromSelection,
} from '../../../chat/previewSelection';
import type { TextAnchor } from '../../../chat/fileReferences';
import { useChatReferenceStore } from '../../../stores/chatReference';
import type { PreviewSelection } from '../../../stores/previewSelection';
import { useTaskStore } from '../../../stores/task';
import { isEditablePreview } from '../../../stores/workspace';
import type { PreviewKind } from '../../../workspace/previewKind';

export const useAddPreviewToChat = (
  selectedPath: () => string | null,
  previewKind: () => PreviewKind | null,
  previewContent: () => string | null,
  getTextArea: () => HTMLTextAreaElement | null,
  getPreviewSelection: () => PreviewSelection,
  getSelectableRoot: () => HTMLElement | null,
  getEditableTextAnchor?: () => TextAnchor | null,
) => {
  const message = ElMessage;
  const chatReferenceStore = useChatReferenceStore();
  const taskStore = useTaskStore();

  const resolveAnchor = (): PreviewSelection => {
    const stored = getPreviewSelection();
    if (stored) return stored;

    const content = previewContent() ?? '';
    const root = getSelectableRoot();
    const kind = previewKind();

    if (kind === 'word' && root) {
      return getWordAnchorFromSelection(root);
    }
    if (kind === 'presentation' && root) {
      return getPresentationAnchorFromSelection(root);
    }

    const editable = isEditablePreview(kind);
    const editableAnchor = editable ? getEditableTextAnchor?.() ?? null : null;
    if (editableAnchor) return editableAnchor;
    const el = editable ? getTextArea() : null;
    if (editable && el && content) {
      return getTextAnchorFromTextarea(
        content,
        el.selectionStart,
        el.selectionEnd,
      );
    }

    if (content && (kind === 'text' || kind === 'markdown')) {
      return getTextAnchorFromWindowSelection(content, root);
    }

    return null;
  };

  return () => {
    const path = selectedPath();
    if (!path) {
      message.warning('请先选择文件');
      return;
    }

    const anchor = resolveAnchor();
    chatReferenceStore.addReference({ path, anchor: anchor ?? undefined });
    taskStore.focusChatPanel();
    chatReferenceStore.focusComposer();

    const label = formatReferenceLabel({
      id: '',
      path,
      anchor: anchor ?? undefined,
    });
    message.success(anchor ? `已引用 ${label}` : `已引用 ${path}`);
  };
};
