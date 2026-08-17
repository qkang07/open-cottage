<script setup lang="ts">
withDefaults(
  defineProps<{
    /** primary：引导配置；warning：缺密钥等告警；neutral：加载中等中性状态 */
    tone?: 'primary' | 'warning' | 'neutral';
  }>(),
  { tone: 'primary' },
);
</script>

<template>
  <div class="composer-attach-banner" :data-tone="tone" role="status">
    <div v-if="$slots.icon" class="composer-attach-banner-icon">
      <slot name="icon" />
    </div>
    <div class="composer-attach-banner-text">
      <slot />
    </div>
    <div v-if="$slots.action" class="composer-attach-banner-action">
      <slot name="action" />
    </div>
  </div>
</template>

<style scoped>
/* 覆盖输入框本体，不占文档流；配置按钮始终位于独立提示层中。 */
.composer-attach-banner {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 0;
  padding: 18px;
  border: 1px solid transparent;
  border-radius: var(--cottage-radius-md);
  color: var(--cottage-ink-soft);
  font-size: var(--cottage-font-sm);
  line-height: 1.4;
  pointer-events: auto;
  backdrop-filter: blur(1px);
}

.composer-attach-banner[data-tone='primary'] {
  border-color: var(--cottage-accent-border);
  background: color-mix(in srgb, var(--cottage-accent-bg-strong) 82%, transparent);
  color: var(--cottage-ink);
}

.composer-attach-banner[data-tone='primary'] .composer-attach-banner-icon {
  color: var(--cottage-primary);
}

.composer-attach-banner[data-tone='warning'] {
  border-color: color-mix(in srgb, var(--el-color-warning, #e6a23c) 36%, transparent);
  background: color-mix(in srgb, var(--el-color-warning-light-9, #fdf6ec) 82%, transparent);
  color: var(--cottage-ink);
}

.composer-attach-banner[data-tone='warning'] .composer-attach-banner-icon {
  color: var(--el-color-warning, #e6a23c);
}

.composer-attach-banner[data-tone='neutral'] {
  border-color: var(--cottage-border);
  background: color-mix(in srgb, var(--cottage-surface-sunken) 82%, transparent);
}

.composer-attach-banner-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 15px;
}

.composer-attach-banner-icon :deep(.n-spin-indicator),
.composer-attach-banner-icon :deep(.n-spin) {
  --n-size: 14px;
}

.composer-attach-banner-text {
  flex: 0 1 auto;
  min-width: 0;
}

.composer-attach-banner-action {
  flex-shrink: 0;
}

@media (max-width: 560px) {
  .composer-attach-banner {
    align-items: flex-start;
    flex-wrap: wrap;
    padding: 14px;
  }

  .composer-attach-banner-text {
    flex: 1 1 calc(100% - 28px);
  }

  .composer-attach-banner-action {
    margin-left: 23px;
  }
}
</style>
