<script setup lang="ts">
import { ElTooltip } from 'element-plus';
import { computed, useAttrs } from 'vue';

/**
 * Tooltip 显示延迟等级（重要信息更快出现）：
 * - instant: 告警 / 状态 / 缺失配置 / 有后果的操作说明 — 立即
 * - quick:   无文字图标按钮（工具栏、侧栏）— 默认，略防扫过误触
 * - normal:  次要操作提示、「更多」、模式说明
 * - lazy:    溢出文本补全、完整路径、已有可见文案的冗余提示
 */
type CottageTooltipDelay = 'instant' | 'quick' | 'normal' | 'lazy';

const COTTAGE_TOOLTIP_DELAY_MS = {
  instant: 0,
  quick: 200,
  normal: 500,
  lazy: 1000,
} as const;

const props = withDefaults(
  defineProps<{
    /** 延迟等级；也可用 showAfter 直接指定毫秒 */
    delay?: CottageTooltipDelay;
    showAfter?: number;
  }>(),
  { delay: 'quick' },
);

defineOptions({ inheritAttrs: false });

const attrs = useAttrs();

const resolvedShowAfter = computed(
  () => props.showAfter ?? COTTAGE_TOOLTIP_DELAY_MS[props.delay],
);
</script>

<template>
  <ElTooltip v-bind="attrs" :show-after="resolvedShowAfter">
    <slot />
    <template v-if="$slots.content" #content>
      <slot name="content" />
    </template>
  </ElTooltip>
</template>
