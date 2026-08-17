<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ChevronDownOutline, CodeSlashOutline } from '@vicons/ionicons5';
import { ElTag } from 'element-plus';
import { NIcon, NText } from '@/ui/element-plus-primitives';

const props = defineProps<{
  code: string;
  /** 脚本返回值的展示文本；未完成时可为 null */
  resultText?: string | null;
  logs?: string[];
  /** 流式执行中尚未结构化的日志文本 */
  streamingLogText?: string | null;
  running?: boolean;
  argsStreaming?: boolean;
}>();

const { t } = useI18n();

const isBusy = computed(() => Boolean(props.running || props.argsStreaming));

/** 执行中默认展开；完成后保持用户折叠偏好，首次进入完成态仍展开 */
const expanded = ref(true);

watch(
  isBusy,
  (busy) => {
    if (busy) expanded.value = true;
  },
  { immediate: true },
);

const hasLogs = computed(
  () =>
    (props.logs?.length ?? 0) > 0 ||
    Boolean(props.streamingLogText?.trim()),
);

const logsDisplay = computed(() => {
  if (props.streamingLogText?.trim()) return props.streamingLogText;
  if (props.logs?.length) return props.logs.join('\n');
  return '';
});

const statusTag = computed(() => {
  if (props.argsStreaming) {
    return { type: 'info' as const, label: t('chat.generatingArgs') };
  }
  if (props.running) {
    return { type: 'warning' as const, label: t('chat.running') };
  }
  return { type: 'success' as const, label: t('chat.completed') };
});

const collapsedPreview = computed(() => {
  const code = props.code.replace(/\s+/g, ' ').trim();
  if (code) {
    return code.length > 72 ? `${code.slice(0, 72)}…` : code;
  }
  if (props.resultText?.trim()) {
    const text = props.resultText.replace(/\s+/g, ' ').trim();
    return text.length > 72 ? `${text.slice(0, 72)}…` : text;
  }
  return '';
});

const toggle = () => {
  expanded.value = !expanded.value;
};
</script>

<template>
  <div
    class="run-script-card"
    :data-running="isBusy ? 'true' : 'false'"
    :data-expanded="expanded ? 'true' : 'false'"
  >
    <button
      type="button"
      class="run-script-card-header"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <span class="run-script-card-title">
        <NIcon
          :component="ChevronDownOutline"
          class="run-script-chevron"
          :class="{ 'run-script-chevron-collapsed': !expanded }"
        />
        <NIcon :component="CodeSlashOutline" />
        <NText strong>{{ t('chat.runScript.title') }}</NText>
        <span
          v-if="!expanded && collapsedPreview"
          class="run-script-collapsed-preview"
        >
          {{ collapsedPreview }}
        </span>
      </span>
      <span class="run-script-card-tags" @click.stop>
        <ElTag :type="statusTag.type" size="small">
          {{ statusTag.label }}
        </ElTag>
        <ElTag v-if="logs?.length" size="small" type="info">
          {{ t('chat.runScript.logCount', { n: logs.length }) }}
        </ElTag>
      </span>
    </button>

    <div v-show="expanded" class="run-script-card-body">
      <section v-if="code || argsStreaming" class="run-script-section">
        <NText depth="3" class="run-script-section-label">
          {{ t('chat.runScript.code') }}
        </NText>
        <pre class="run-script-pre run-script-code">{{ code }}<span
          v-if="argsStreaming"
          class="run-script-cursor"
        >▍</span></pre>
        <NText v-if="!code && argsStreaming" depth="3">
          {{ t('chat.generatingArgs') }}…
        </NText>
      </section>

      <section v-if="hasLogs" class="run-script-section">
        <NText depth="3" class="run-script-section-label">
          {{ t('chat.runScript.logs') }}
        </NText>
        <pre class="run-script-pre run-script-logs">{{ logsDisplay }}<span
          v-if="running && streamingLogText"
          class="run-script-cursor"
        >▍</span></pre>
      </section>

      <section
        v-if="resultText != null && resultText !== ''"
        class="run-script-section"
      >
        <NText depth="3" class="run-script-section-label">
          {{ t('chat.runScript.result') }}
        </NText>
        <pre class="run-script-pre run-script-result">{{ resultText }}</pre>
      </section>

      <NText
        v-else-if="running && !argsStreaming && !hasLogs && !resultText"
        depth="3"
      >
        {{ t('chat.runningEllipsis') }}
      </NText>
    </div>
  </div>
</template>

<style scoped>
.run-script-card {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  border: 1px solid var(--cottage-border);
  border-left: 3px solid var(--cottage-accent, #3b82f6);
  border-radius: calc(var(--cottage-radius-control) + 2px);
  background: linear-gradient(
    180deg,
    var(--cottage-surface) 0%,
    var(--cottage-surface-sunken) 100%
  );
  box-shadow: var(--cottage-shadow-card);
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.run-script-card[data-running='true'] {
  border-left-color: var(--cottage-warning, #e6a23c);
}

.run-script-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 10px 12px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: inherit;
  font: inherit;
}

.run-script-card-header:hover {
  background: color-mix(in srgb, var(--cottage-accent, #3b82f6) 6%, transparent);
}

.run-script-card-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
}

.run-script-chevron {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--cottage-muted, #9ca3af);
  transition: transform 0.18s ease;
}

.run-script-chevron-collapsed {
  transform: rotate(-90deg);
}

.run-script-collapsed-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--cottage-ink-muted, #6b7280);
}

.run-script-card-tags {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.run-script-card-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 12px 10px;
  min-width: 0;
}

.run-script-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.run-script-section-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.run-script-pre {
  margin: 0;
  padding: 8px 10px;
  max-height: 280px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: var(--cottage-surface-sunken, rgba(0, 0, 0, 0.03));
  border: 1px solid var(--cottage-border, rgba(0, 0, 0, 0.08));
  border-radius: var(--cottage-radius-control, 6px);
  color: var(--cottage-ink-soft, inherit);
}

.run-script-logs {
  color: var(--cottage-ink-muted, #6b7280);
}

.run-script-result {
  color: var(--cottage-ink, inherit);
}

.run-script-cursor {
  color: var(--cottage-accent, #3b82f6);
  animation: run-script-cursor-pulse 1.1s ease-in-out infinite;
}

@keyframes run-script-cursor-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.2;
  }
}
</style>
