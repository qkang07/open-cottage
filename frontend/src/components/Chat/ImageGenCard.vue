<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { ImageOutline } from '@vicons/ionicons5';
import { ElTag } from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import { NIcon, NSpin, NText } from '@/ui/element-plus-primitives';
import type { ChatAttachment } from '../../chat/attachments';
import { mimeFromPath } from '../../chat/attachmentStorage';
import { useWorkspaceStore } from '../../stores/workspace';
import AttachmentImage from './AttachmentImage.vue';

/**
 * 生图/图生图工具调用卡片：
 * 执行中展示带呼吸动画的空图占位（按张数），
 * 落盘后就地把工作区图片渲染出来（点击可放大，路径可点击在编辑器打开）。
 */
const props = defineProps<{
  title: string;
  prompt?: string | null;
  running?: boolean;
  argsStreaming?: boolean;
  /** 生成张数（来自工具参数 n，缺省 1），仅占位态使用 */
  expectedCount?: number;
  /** 已保存到工作区的图片路径列表 */
  paths: string[];
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const placeholderCount = computed(() =>
  Math.min(Math.max(props.expectedCount ?? 1, 1), 4),
);

const attachments = computed<ChatAttachment[]>(() =>
  props.paths.map((path) => ({
    id: path,
    type: 'image',
    filename: path.split('/').pop() || path,
    mimeType: mimeFromPath(path),
    data: path,
  })),
);

const statusText = computed(() =>
  props.argsStreaming ? t('chat.generatingArgs') : t('chat.imageGenRunning'),
);

function selectFile(path: string) {
  void workspaceStore.selectFile(path);
}
</script>

<template>
  <div class="image-gen-card" :data-running="running ? 'true' : 'false'">
    <div class="image-gen-card-header">
      <span class="image-gen-card-title">
        <NIcon :component="ImageOutline" />
        <NText strong>{{ title }}</NText>
      </span>
      <span class="image-gen-card-tags">
        <template v-if="running || !paths.length">
          <NSpin size="small" />
          <NText depth="3" class="image-gen-card-status">{{ statusText }}</NText>
        </template>
        <ElTag v-else size="small" type="success">
          {{ t('chat.imageGenSaved', { n: paths.length }) }}
        </ElTag>
      </span>
    </div>
    <CottageTooltip
      v-if="prompt"
      :content="prompt"
      placement="top"
      delay="lazy"
    >
      <NText depth="3" class="image-gen-card-prompt">{{ prompt }}</NText>
    </CottageTooltip>
    <div class="image-gen-card-body">
      <template v-if="paths.length">
        <div
          v-for="att in attachments"
          :key="att.id"
          class="image-gen-card-item"
        >
          <AttachmentImage :attachment="att" class="image-gen-card-image" />
          <button
            type="button"
            class="image-gen-card-path"
            :title="att.data"
            @click="selectFile(att.data)"
          >
            {{ att.data }}
          </button>
        </div>
      </template>
      <template v-else>
        <div
          v-for="index in placeholderCount"
          :key="`placeholder-${index}`"
          class="image-gen-card-item"
        >
          <div class="image-gen-card-placeholder">
            <NIcon :component="ImageOutline" class="image-gen-card-placeholder-icon" />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
