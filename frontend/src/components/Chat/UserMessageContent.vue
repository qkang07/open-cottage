<script setup lang="ts">
import {
  DocumentOutline,
  FolderOutline } from '@vicons/ionicons5';
import { ElButton } from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NText
} from '@/ui/element-plus-primitives';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CottageMessage } from '../../agent/messages';
import { parseUserMessageDisplay, type StoredFileReference } from '../../chat/userMessageFormat';
import { useWorkspaceStore } from '../../stores/workspace';
import AttachmentImage from './AttachmentImage.vue';
const props = withDefaults(
  defineProps<{
    message: CottageMessage;
    editable?: boolean;
  }>(),
  { editable: false },
);
const emit = defineEmits<{
  edit: [];
}>();
const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const REF_PLACEHOLDER_RE = /\{\{ref:([^|]+)\|([^}]+)\}\}/g;
const llmText = computed(
  () => props.message.sections.find((s) => s.type === 'content')?.text ?? '',
);
const display = computed(() =>
  parseUserMessageDisplay(llmText.value, {
    userText: props.message.userText,
    fileReferences: props.message.fileReferences,
  }),
);
const parts = computed(() => {
  const result: (
    | { type: 'text'; text: string }
    | { type: 'ref'; ref: StoredFileReference }
  )[] = [];
  let lastIndex = 0;
  const refMap = new Map(display.value.references.map((r) => [r.id, r]));
  const userText = display.value.userText;
  userText.replace(REF_PLACEHOLDER_RE, (match, id, _path, offset) => {
    if (offset > lastIndex) {
      const segment = userText.slice(lastIndex, offset);
      if (segment) result.push({ type: 'text', text: segment });
    }
    const ref = refMap.get(id);
    if (ref) {
      result.push({ type: 'ref', ref });
    }
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex < userText.length) {
    const segment = userText.slice(lastIndex);
    if (segment) result.push({ type: 'text', text: segment });
  }
  return result;
});
const hasOrderedRefs = computed(() => parts.value.some((p) => p.type === 'ref'));
const hasLegacyRefs = computed(
  () => !hasOrderedRefs.value && display.value.references.length > 0,
);
const hasActiveFileContext = computed(() => Boolean(display.value.activeFilePath));
const hasText = computed(
  () => parts.value.length > 0 || Boolean(display.value.userText.trim()),
);
const attachments = computed(() => props.message.attachments ?? []);
function selectFile(path: string) {
  void workspaceStore.selectFile(path);
}
function isDirectoryRef(ref: StoredFileReference): boolean {
  return ref.entryType === 'directory';
}
function onBodyClick(event: MouseEvent) {
  if (!props.editable) return;
  const target = event.target as HTMLElement | null;
  // 图片附件有自己的点击放大预览，点击进入编辑态会导致组件卸载、预览被关闭
  if (target?.closest('button, a, .el-button, .user-message-attachments')) return;
  emit('edit');
}
</script>
<template>
  <div
    v-if="!parts.length && !hasLegacyRefs && !hasActiveFileContext && !hasText && !attachments.length"
    class="user-message-body"
    :class="{ 'user-message-body-editable': editable }"
    :title="editable ? t('chat.editMessageClickHint') : undefined"
    @click="onBodyClick"
  >
    <NText depth="3" italic>
      （空消息）
    </NText>
  </div>
  <div
    v-else
    class="user-message-body"
    :class="{ 'user-message-body-editable': editable }"
    :title="editable ? t('chat.editMessageClickHint') : undefined"
    @click="onBodyClick"
  >
    <div v-if="hasActiveFileContext" class="user-message-refs">
      <CottageTooltip :content="`当前打开（上下文）：${display.activeFilePath}`" placement="top" delay="lazy">
        <ElButton
          class="user-message-ref-btn user-message-ref-btn-active"
          @click="selectFile(display.activeFilePath!)"
        >
          <template #icon>
            <NIcon :component="DocumentOutline" />
          </template>
          当前打开：{{ display.activeFilePath }}
        </ElButton>
      </CottageTooltip>
    </div>
    <div v-if="hasLegacyRefs" class="user-message-refs">
      <CottageTooltip
        v-for="ref in display.references"
        :key="`${ref.path}:${ref.label}`"
        :content="ref.implicit ? `当前打开：${ref.path}` : ref.path"
        placement="top"
        delay="lazy"
      >
        <ElButton
          :class="
            ref.implicit
              ? 'user-message-ref-btn user-message-ref-btn-active'
              : 'user-message-ref-btn'
          "
          :disabled="isDirectoryRef(ref)"
          @click="!isDirectoryRef(ref) && selectFile(ref.path)"
        >
          <template #icon>
            <NIcon :component="isDirectoryRef(ref) ? FolderOutline : DocumentOutline" />
          </template>
          {{ ref.label }}{{ isDirectoryRef(ref) && !ref.label.endsWith('/') ? '/' : '' }}
        </ElButton>
      </CottageTooltip>
    </div>
    <div v-if="parts.length > 0" class="user-message-text">
      <template v-for="(part, index) in parts" :key="index">
        <span v-if="part.type === 'text'">{{ part.text }}</span>
        <CottageTooltip
          v-else
          :content="part.ref.implicit ? `当前打开：${part.ref.path}` : part.ref.path"
          placement="top"
          delay="lazy"
        >
          <ElButton
            :class="
              part.ref.implicit
                ? 'user-message-ref-btn user-message-ref-btn-active'
                : 'user-message-ref-btn'
            "
            :disabled="isDirectoryRef(part.ref)"
            @click="!isDirectoryRef(part.ref) && selectFile(part.ref.path)"
          >
            <template #icon>
              <NIcon :component="isDirectoryRef(part.ref) ? FolderOutline : DocumentOutline" />
            </template>
            {{ part.ref.label }}{{ isDirectoryRef(part.ref) && !part.ref.label.endsWith('/') ? '/' : '' }}
          </ElButton>
        </CottageTooltip>
      </template>
    </div>
    <div v-if="attachments.length > 0" class="user-message-attachments">
      <AttachmentImage
        v-for="att in attachments"
        :key="att.id"
        :attachment="att"
      />
    </div>
  </div>
</template>
