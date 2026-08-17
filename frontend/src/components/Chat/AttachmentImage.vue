<script setup lang="ts">
import { ElImage } from 'element-plus';
import { NSpin } from '@/ui/element-plus-primitives';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ChatAttachment } from '../../chat/attachments';
import {
  isAttachmentPath,
  resolveAttachmentDataUrl,
} from '../../chat/attachmentStorage';

/**
 * 统一渲染聊天图片附件：data 为内联 base64 时直接展示；
 * 为工作区相对路径时异步读文件解析为 data URL；文件缺失时展示占位。
 */
const props = defineProps<{
  attachment: ChatAttachment;
}>();
const { t } = useI18n();
const resolved = ref<string | null>(null);
const failed = ref(false);

watch(
  () => props.attachment.data,
  async (data) => {
    failed.value = false;
    if (!isAttachmentPath(data)) {
      resolved.value = data;
      return;
    }
    resolved.value = null;
    const url = await resolveAttachmentDataUrl(props.attachment);
    if (url) {
      resolved.value = url;
    } else {
      failed.value = true;
    }
  },
  { immediate: true },
);
</script>
<template>
  <ElImage
    v-if="resolved"
    class="chat-attachment-image"
    :src="resolved"
    :alt="attachment.filename"
    fit="cover"
    :preview-src-list="[resolved]"
    preview-teleported
    hide-on-click-modal
  />
  <div
    v-else-if="failed"
    class="chat-attachment-image chat-attachment-image-missing"
    :title="attachment.filename"
  >
    {{ t('chat.attachmentMissing') }}
  </div>
  <div v-else class="chat-attachment-image chat-attachment-image-loading">
    <NSpin size="small" />
  </div>
</template>
