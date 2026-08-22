<script setup lang="ts">
import { ElButton, ElInput, ElTag } from 'element-plus';
import { NText } from '@/ui/element-plus-primitives';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AskUserOption } from '../../chat/askUserOptions';

const props = defineProps<{
  question: string;
  options: AskUserOption[];
  compact?: boolean;
  /** 已回答时传入，切换为只读历史展示 */
  answered?: string | null;
  /** 等待参数/工具就绪时的占位文案 */
  statusText?: string | null;
}>();

const emit = defineEmits<{
  submit: [answer: string];
  cancel: [];
}>();

const customText = ref('');
const showAllAnsweredOptions = ref(false);
const { t } = useI18n();
const answerIsPresetOption = computed(
  () => Boolean(props.answered && props.options.some((option) => option.label === props.answered)),
);
const answeredOptions = computed(() => {
  if (!props.answered) return [];
  if (answerIsPresetOption.value && showAllAnsweredOptions.value) {
    return props.options;
  }
  const selected = props.options.find((option) => option.label === props.answered);
  return selected ? [selected] : [{ label: props.answered }];
});

watch(
  () => props.answered,
  () => {
    showAllAnsweredOptions.value = false;
  },
);

function submitCustom() {
  const text = customText.value.trim();
  if (!text) return;
  emit('submit', text);
  customText.value = '';
}
</script>

<template>
  <div :class="compact ? 'ask-user-prompt ask-user-prompt-compact' : 'ask-user-prompt'">
    <NText class="ask-user-question" :depth="compact ? 2 : 1">
      {{ question }}
    </NText>
    <template v-if="answered">
      <div class="ask-user-options ask-user-options-readonly">
        <ElTag
          v-for="opt in answeredOptions"
          :key="opt.label"
          size="small"
          :type="opt.label === answered ? 'success' : 'info'"
          effect="plain"
        >
          {{ opt.label }}
        </ElTag>
      </div>
      <ElButton
        v-if="answerIsPresetOption && options.length > 1"
        class="ask-user-options-toggle"
        text
        :size="compact ? 'small' : 'default'"
        @click="showAllAnsweredOptions = !showAllAnsweredOptions"
      >
        {{ showAllAnsweredOptions ? t('chat.collapseOtherOptions') : t('chat.showAllOptions') }}
      </ElButton>
    </template>
    <NText v-else-if="statusText" depth="3">
      {{ statusText }}
    </NText>
    <template v-else>
      <div v-if="options.length" class="ask-user-options">
        <ElButton
          v-for="opt in options"
          :key="opt.label"
          :size="compact ? 'small' : 'default'"
          class="ask-user-option"
          @click="emit('submit', opt.label)"
        >
          <span class="ask-user-option-label">{{ opt.label }}</span>
          <span v-if="opt.description" class="ask-user-option-description">
            {{ opt.description }}
          </span>
        </ElButton>
      </div>
      <div class="ask-user-custom">
        <ElInput
          v-model="customText"
          type="textarea"
          :autosize="{ minRows: compact ? 2 : 3, maxRows: 8 }"
          placeholder="输入你的回答…"
          @keydown.enter.exact.prevent="submitCustom"
        />
        <div class="ask-user-custom-actions">
          <ElButton
            :size="compact ? 'small' : 'default'"
            type="primary"
            :disabled="!customText.trim()"
            @click="submitCustom"
          >
            发送回答
          </ElButton>
          <ElButton :size="compact ? 'small' : 'default'" @click="emit('cancel')">
            取消
          </ElButton>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ask-user-option {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  height: auto;
  min-height: 32px;
  white-space: normal;
  text-align: left;
}

.ask-user-option-description {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
}
</style>
