<script setup lang="ts">
import { DocumentTextOutline, EyeOutline, TimeOutline } from '@vicons/ionicons5';
import { ElButton, ElEmpty, ElTag } from 'element-plus';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';

import { useAiChangedFilesStore } from '../../stores/aiChangedFiles';
import type { MessageChangedFile } from '../../chat/messageChangedFiles';
import { isLikelyTextPath } from '../../workspace/search';
import { NIcon, NText } from '@/ui/element-plus-primitives';

const emit = defineEmits<{ selected: [] }>();
const { t } = useI18n();
const store = useAiChangedFilesStore();
const { changed } = storeToRefs(store);

const kindLabel = (kind: MessageChangedFile['kind']) =>
  kind === 'created'
    ? t('chat.changedFileCreated')
    : kind === 'generated'
      ? t('chat.changedFileGenerated')
      : kind === 'deleted'
        ? t('chat.changedFileDeleted')
        : t('chat.changedFileModified');

const canReviewBefore = (path: string) => {
  const reset = store.fileOf(path)?.reset;
  if (isLikelyTextPath(path) && reset?.kind === 'delete') return true;
  return reset?.kind === 'restoreText' || reset?.kind === 'restoreBytes';
};

async function open(path: string, mode: 'current' | 'changes' | 'before') {
  await store.openReview(path, mode);
  emit('selected');
}
</script>

<template>
  <div class="changed-files-panel">
    <div class="changed-files-summary">
      <NIcon :component="DocumentTextOutline" />
      <NText>{{ t('files.allChangesSummary', { n: changed.length }) }}</NText>
    </div>
    <ElEmpty v-if="!changed.length" :description="t('files.noCurrentChanges')" />
    <div v-else class="changed-files-list">
      <div v-for="file in changed" :key="`${file.path}-${file.changeId}`" class="changed-files-row">
        <div class="changed-files-main">
          <span class="changed-files-path" :title="file.path">{{ file.path }}</span>
          <ElTag size="small" effect="plain">{{ kindLabel(file.kind) }}</ElTag>
        </div>
        <div class="changed-files-actions">
          <ElButton text @click="open(file.path, 'current')">
            <template #icon><NIcon :component="EyeOutline" /></template>
            {{ t('files.viewCurrent') }}
          </ElButton>
          <ElButton
            v-if="isLikelyTextPath(file.path)"
            text
            type="primary"
            :disabled="!canReviewBefore(file.path)"
            @click="open(file.path, 'changes')"
          >
            <template #icon><NIcon :component="TimeOutline" /></template>
            {{ t('files.viewChanges') }}
          </ElButton>
          <ElButton
            v-else
            text
            type="primary"
            :disabled="!canReviewBefore(file.path)"
            @click="open(file.path, 'before')"
          >
            <template #icon><NIcon :component="TimeOutline" /></template>
            {{ t('files.viewBeforeChange') }}
          </ElButton>
        </div>
      </div>
    </div>
    <NText v-if="changed.some((file) => !canReviewBefore(file.path))" depth="3" class="changed-files-note">
      {{ t('files.beforeUnavailableHint') }}
    </NText>
  </div>
</template>

<style scoped>
.changed-files-panel { padding: 16px; }
.changed-files-summary { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.changed-files-list { display: flex; flex-direction: column; gap: 8px; }
.changed-files-row { border: 1px solid var(--cottage-border); border-radius: 8px; padding: 10px 12px; }
.changed-files-main, .changed-files-actions { display: flex; align-items: center; gap: 8px; }
.changed-files-main { justify-content: space-between; }
.changed-files-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.changed-files-actions { justify-content: flex-end; margin-top: 6px; }
.changed-files-note { display: block; margin-top: 14px; line-height: 1.5; }
</style>
