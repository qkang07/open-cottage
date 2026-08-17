<script setup lang="ts">
import { KeyOutline, SettingsOutline } from '@vicons/ionicons5';
import { ElButton } from 'element-plus';
import { NIcon } from '@/ui/element-plus-primitives';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ state: 'no-model' | 'missing-key' }>();
const emit = defineEmits<{ openSettings: [] }>();
const { t } = useI18n();
</script>

<template>
  <div class="chat-setup-guide" role="status">
    <NIcon :component="props.state === 'missing-key' ? KeyOutline : SettingsOutline" />
    <div class="chat-setup-guide-copy">
      <strong>{{ t('chat.setupGuideTitle') }}</strong>
      <span>{{ props.state === 'missing-key' ? t('chat.setupGuideNoKey') : t('chat.setupGuideNoModel') }}</span>
    </div>
    <ElButton type="primary" size="small" @click="emit('openSettings')">
      {{ t('chat.setupGuideAction') }}
    </ElButton>
  </div>
</template>
