<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElEmpty,
  ElTag,
} from 'element-plus';
import {
  NIcon,
  NText,
} from '@/ui/element-plus-primitives';
import {
  CheckmarkCircle,
  CloseCircle,
  DocumentOutline,
  TimeOutline,
  AlertCircle,
  CreateOutline,
} from '@vicons/ionicons5';
import type { TraceEvent, TraceToolCallEvent } from '../../platform/trace';
import { loadTraceEvents } from '../../platform/trace';
import FileWriteDiff from '../Chat/FileWriteDiff.vue';

const { t } = useI18n();

const props = defineProps<{
  sessionId: string | null;
}>();

const events = ref<TraceEvent[]>([]);
const loading = ref(false);
const expanded = ref<string[]>([]);

async function load() {
  if (!props.sessionId) {
    events.value = [];
    return;
  }
  loading.value = true;
  try {
    events.value = await loadTraceEvents(props.sessionId);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.sessionId,
  () => { void load(); },
  { immediate: true },
);

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const toolStatusTag = (
  status: TraceToolCallEvent['status'],
): { type: 'success' | 'danger' | 'warning' | 'info'; label: string } => {
  switch (status) {
    case 'ok':
      return { type: 'success', label: t('trace.success') };
    case 'blocked_policy':
      return { type: 'warning', label: t('trace.policyBlocked') };
    case 'blocked_plan':
      return { type: 'warning', label: t('trace.planBlocked') };
    case 'duplicate':
      return { type: 'warning', label: t('trace.duplicateBlocked') };
    case 'doom_loop':
      return { type: 'warning', label: t('trace.loopDetected') };
    case 'error':
      return { type: 'danger', label: t('trace.error') };
    case 'aborted':
      return { type: 'info', label: t('trace.aborted') };
    case 'unknown_tool':
      return { type: 'danger', label: t('trace.unknownTool') };
  }
};

function eventKey(event: TraceEvent, index: number): string {
  if (event.type === 'tool_call') return `tool-${event.id}`;
  return `${event.type}-${index}`;
}
</script>

<template>
  <div class="trace-panel">
    <div class="trace-panel-toolbar">
      <NText depth="3" class="trace-panel-meta">
        {{ t('trace.sessionSummary', { id: sessionId ?? '—', n: events.length }) }}
      </NText>
      <ElButton size="small" :loading="loading" @click="load">{{ t('trace.refresh') }}</ElButton>
    </div>

    <ElEmpty v-if="!events.length && !loading" :description="t('trace.empty')" />

    <ElCollapse v-else v-model="expanded" class="trace-list">
      <ElCollapseItem
        v-for="(event, index) in events"
        :key="eventKey(event, index)"
        :name="eventKey(event, index)"
        :class="`trace-item trace-item-${event.type}`"
      >
        <template #title>
          <span class="trace-item-title">
            <NIcon
              :component="
                event.type === 'tool_call'
                  ? event.status === 'ok'
                    ? CheckmarkCircle
                    : event.status === 'aborted'
                      ? TimeOutline
                      : AlertCircle
                  : event.type === 'verify'
                    ? event.verdict === 'pass'
                      ? CheckmarkCircle
                      : CloseCircle
                    : event.type === 'plan'
                      ? DocumentOutline
                      : TimeOutline
              "
              class="trace-item-icon"
            />
            <NText strong class="trace-item-label">
              <template v-if="event.type === 'turn_start'">{{ t('trace.turnStart') }}</template>
              <template v-else-if="event.type === 'turn_end'">
                {{ t('trace.turnEnd', { reason: event.endReason }) }}
              </template>
              <template v-else-if="event.type === 'model_call'">
                {{ t('trace.modelCall', { provider: event.identity.provider, model: event.identity.model }) }}
              </template>
              <template v-else-if="event.type === 'plan'">
                {{ t('trace.executionPlan', { goal: event.goal }) }}
              </template>
              <template v-else-if="event.type === 'verify'">
                {{ t('trace.verify', { result: event.verdict === 'pass' ? t('trace.pass') : t('trace.fail') }) }}
              </template>
              <template v-else-if="event.type === 'tool_call'">
                {{ t('trace.tool', { name: event.name }) }}
              </template>
              <template v-else-if="event.type === 'handoff'">
                {{ t('trace.handoff') }}
              </template>
              <template v-else-if="event.type === 'compaction'">
                {{ t('trace.compaction', { dropped: event.droppedCount, kept: event.keptCount }) }}
              </template>
            </NText>
            <span class="trace-item-time">{{ formatTime(event.at) }}</span>
            <ElTag
              v-if="event.type === 'tool_call'"
              size="small"
              :type="toolStatusTag(event.status).type"
            >
              {{ toolStatusTag(event.status).label }}
            </ElTag>
            <ElTag
              v-if="event.type === 'tool_call' && event.durationMs !== undefined"
              size="small"
              type="info"
            >
              {{ event.durationMs }}ms
            </ElTag>
            <ElTag
              v-if="event.type === 'model_call'"
              size="small"
              :type="event.error ? 'danger' : 'info'"
            >
              {{ event.durationMs }}ms
            </ElTag>
            <ElTag
              v-if="event.type === 'tool_call' && event.streamed"
              size="small"
              type="info"
            >
              {{ t('trace.streaming') }}{{ event.chunkCount ? ` · ${event.chunkCount}` : '' }}
            </ElTag>
            <ElTag
              v-if="event.type === 'turn_start'"
              size="small"
              type="info"
            >
              {{ event.mode }}
            </ElTag>
          </span>
        </template>

        <div class="trace-item-body">
          <template v-if="event.type === 'plan'">
            <NText depth="3">{{ t('trace.planItemCount', { n: event.itemCount }) }}</NText>
            <pre v-if="event.budget" class="trace-pre">{{
              JSON.stringify(event.budget, null, 2)
            }}</pre>
          </template>

          <template v-else-if="event.type === 'verify'">
            <NText :type="event.verdict === 'pass' ? 'success' : 'danger'">
              {{
                t('trace.verifySummary', {
                  verdict: event.verdict === 'pass' ? t('trace.pass') : t('trace.fail'),
                  checkCount: event.checkCount,
                  manifestCount: event.manifestPathCount,
                })
              }}
            </NText>
            <div v-if="event.uncovered.length" class="trace-uncovered">
              <NText depth="3">{{ t('trace.uncoveredLabel') }}</NText>
              <NText
                v-for="(item, i) in event.uncovered"
                :key="i"
                depth="3"
                class="trace-uncovered-item"
              >
                · {{ item }}
              </NText>
            </div>
          </template>

          <template v-else-if="event.type === 'handoff'">
            <NText depth="3">{{ event.summary }}</NText>
            <NText depth="3">
              {{
                t('trace.handoffSummary', {
                  remaining: event.remainingCount,
                  next: event.nextStepCount,
                })
              }}
            </NText>
          </template>

          <template v-else-if="event.type === 'compaction'">
            <NText depth="3">
              tokens {{ event.beforeTokens }} → ~{{ event.afterTokensEstimate }}
            </NText>
            <pre v-if="event.summaryMessage" class="trace-pre">{{
              event.summaryMessage.content
            }}</pre>
          </template>

          <template v-else-if="event.type === 'model_call'">
            <NText depth="3">
              {{ event.operation }} · {{ event.identity.baseUrl }}
            </NText>
            <NText v-if="event.firstTokenMs !== undefined" depth="3">
              {{ t('trace.firstToken', { ms: event.firstTokenMs }) }}
            </NText>
            <pre v-if="event.usage" class="trace-pre">{{
              JSON.stringify(event.usage, null, 2)
            }}</pre>
            <pre v-if="event.error" class="trace-pre trace-pre-error">{{ event.error }}</pre>
          </template>

          <template v-else-if="event.type === 'turn_end' && event.error">
            <pre class="trace-pre trace-pre-error">{{ event.error }}</pre>
          </template>

          <template v-else-if="event.type === 'tool_call'">
            <NText depth="3" class="trace-section-label">
              <NIcon :component="CreateOutline" /> {{ t('trace.params') }}
            </NText>
            <pre class="trace-pre">{{ event.args }}</pre>
            <NText depth="3" class="trace-section-label">{{ t('trace.result') }}</NText>
            <pre class="trace-pre">{{ event.resultSnippet }}</pre>
            <template
              v-if="
                event.diffSnippet !== undefined ||
                event.before !== undefined ||
                event.after !== undefined
              "
            >
              <NText depth="3" class="trace-section-label">{{ t('trace.fileChanges') }}</NText>
              <FileWriteDiff
                :before="event.before"
                :after="event.after"
                :diff="event.diffSnippet"
                :created="event.created"
              />
            </template>
          </template>
        </div>
      </ElCollapseItem>
    </ElCollapse>
  </div>
</template>
