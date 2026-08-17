<script setup lang="ts">
import { CopyOutline, RefreshOutline } from '@vicons/ionicons5';
import {
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElDescriptions,
  ElDescriptionsItem,
  ElEmpty,
  ElMessage,
  ElScrollbar,
  ElTabPane,
  ElTabs,
  ElTag
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import { NIcon } from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed, nextTick, ref, watch } from 'vue';
import type { StoredMessage, StoredMessageRole } from '../../agent/messages';
import { formatSessionTime, loadChatSessionsIndex, sortChatSessions } from '../../config/chatSessions';
import type { ChatSessionMeta } from '../../config/constants';
import {
  loadOlderPreservingScroll,
  useTailWindow,
} from '../../composables/useTailWindow';
import {
  loadSessionDebugDetail,
  type SessionDebugDetail,
} from '../../platform/debug/sessionDebug';
import type { TraceToolCallEvent } from '../../platform/trace';
import type { SessionEvent } from '../../session/eventLog';
import { useAgentStore } from '../../stores/agent';
import FileWriteDiff from '../Chat/FileWriteDiff.vue';

type DetailTab = 'overview' | 'llm' | 'timeline';

const props = defineProps<{
  visible: boolean;
}>();

const message = ElMessage;
const { chat, activeChatId } = storeToRefs(useAgentStore());

const sessions = ref<ChatSessionMeta[]>([]);
const sessionsReady = ref(false);
const selectedId = ref<string | null>(null);
const loading = ref(false);
const detail = ref<SessionDebugDetail | null>(null);
const loadError = ref<string | null>(null);
const detailTab = ref<DetailTab>('overview');
const timelineExpanded = ref<string[]>([]);
const detailScrollRef = ref<{ wrapRef?: HTMLElement } | null>(null);
const loadingOlder = ref(false);

const DEBUG_TIMELINE_PAGE = 50;
const DEBUG_LLM_PAGE = 40;
/** 审批/流式时 sectionVersion 会连跳；节流避免反复读整份 events.jsonl 把面板打空 */
const DETAIL_RELOAD_DEBOUNCE_MS = 350;

let detailLoadSeq = 0;
let detailReloadTimer: number | undefined;

async function reloadSessions() {
  const index = await loadChatSessionsIndex();
  sessions.value = sortChatSessions(index.sessions);
  sessionsReady.value = true;
}

function resolveSelectedMeta(): ChatSessionMeta | null {
  const id = selectedId.value;
  if (!id) return null;
  return sessions.value.find((s) => s.id === id) ?? null;
}

async function loadDetailForSelection(options?: { clearOnMissing?: boolean }) {
  const id = selectedId.value;
  if (!id) {
    detail.value = null;
    loadError.value = null;
    return;
  }
  if (!sessionsReady.value) {
    loading.value = true;
    return;
  }
  const meta = resolveSelectedMeta();
  if (!meta) {
    // 会话列表已就绪但仍找不到：才清空；列表未齐时绝不把已有 detail 抹掉
    if (options?.clearOnMissing !== false) {
      detail.value = null;
    }
    loading.value = false;
    return;
  }

  const seq = ++detailLoadSeq;
  loading.value = true;
  loadError.value = null;
  try {
    const next = await loadSessionDebugDetail(
      meta,
      chat.value,
      activeChatId.value,
    );
    if (seq !== detailLoadSeq) return;
    detail.value = next;
  } catch (error) {
    if (seq !== detailLoadSeq) return;
    loadError.value = error instanceof Error ? error.message : String(error);
    // 保留上一份 detail，避免审批抖动时整页变空白
  } finally {
    if (seq === detailLoadSeq) loading.value = false;
  }
}

function scheduleDetailReload() {
  if (detailReloadTimer !== undefined) {
    window.clearTimeout(detailReloadTimer);
  }
  detailReloadTimer = window.setTimeout(() => {
    detailReloadTimer = undefined;
    void loadDetailForSelection({ clearOnMissing: false });
  }, DETAIL_RELOAD_DEBOUNCE_MS);
}

watch(
  () => props.visible,
  (open) => {
    if (!open) return;
    if (!selectedId.value && activeChatId.value) {
      selectedId.value = activeChatId.value;
    }
    void reloadSessions().then(() => {
      void loadDetailForSelection();
    });
  },
  { immediate: true },
);

watch(selectedId, () => {
  void loadDetailForSelection();
});

watch(
  [chat, activeChatId, () => chat.value?.viewState.sectionVersion],
  () => {
    if (!props.visible || !selectedId.value) return;
    scheduleDetailReload();
  },
);

function selectSession(session: ChatSessionMeta) {
  selectedId.value = session.id;
}

async function refreshDetail() {
  await loadDetailForSelection();
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    message.success('已复制到剪贴板');
  } catch {
    message.error('复制失败');
  }
}

/** 时间线：消息 + 执行事件；跳过 runtime（噪声大） */
const timelineEvents = computed(() =>
  (detail.value?.events ?? []).filter((event) => event.type !== 'runtime'),
);

const {
  visibleItems: visibleTimelineEvents,
  hasOlder: hasOlderTimeline,
  hiddenOlderCount: hiddenOlderTimelineCount,
  resetToTail: resetTimelineTail,
  loadOlder: loadOlderTimeline,
} = useTailWindow(timelineEvents, {
  pageSize: DEBUG_TIMELINE_PAGE,
  maxWhenPinned: DEBUG_TIMELINE_PAGE * 2,
});

const llmHistoryItems = computed(() => detail.value?.llmHistory ?? []);

const {
  visibleItems: visibleLlmHistory,
  hasOlder: hasOlderLlm,
  hiddenOlderCount: hiddenOlderLlmCount,
  resetToTail: resetLlmTail,
  loadOlder: loadOlderLlm,
} = useTailWindow(llmHistoryItems, {
  pageSize: DEBUG_LLM_PAGE,
  maxWhenPinned: DEBUG_LLM_PAGE * 2,
});

watch(selectedId, () => {
  timelineExpanded.value = [];
  detailTab.value = 'overview';
});

watch(detail, () => {
  resetTimelineTail();
  resetLlmTail();
});

async function tryLoadOlderTimeline() {
  if (loadingOlder.value || !hasOlderTimeline.value) return;
  if (detailTab.value !== 'timeline') return;
  loadingOlder.value = true;
  try {
    const inst = detailScrollRef.value as {
      wrapRef?: HTMLElement | { value?: HTMLElement | null };
    } | null;
    const raw = inst?.wrapRef;
    const wrap =
      raw instanceof HTMLElement
        ? raw
        : raw && typeof raw === 'object' && 'value' in raw
          ? (raw.value ?? null)
          : null;
    await loadOlderPreservingScroll(wrap, loadOlderTimeline, nextTick);
  } finally {
    loadingOlder.value = false;
  }
}

async function onTimelineScroll(payload: { scrollTop?: number }) {
  if ((payload.scrollTop ?? 0) > 96) return;
  await tryLoadOlderTimeline();
}

const timelineJson = computed(() =>
  JSON.stringify(timelineEvents.value, null, 2),
);

const llmHistoryJson = computed(() =>
  detail.value ? JSON.stringify(detail.value.llmHistory, null, 2) : '',
);

const collapsedSections = ref<string[]>([]);

const messageRoleMeta: Record<
  StoredMessageRole,
  { label: string; tagType: 'primary' | 'success' | 'warning' | 'info' }
> = {
  system: { label: '系统', tagType: 'info' },
  user: { label: '用户', tagType: 'primary' },
  assistant: { label: '助手', tagType: 'success' },
  tool: { label: '工具结果', tagType: 'warning' },
};

function roleMeta(role: StoredMessageRole) {
  return messageRoleMeta[role];
}

function messageContent(entry: StoredMessage): string {
  return entry.role === 'user' && entry.userText
    ? entry.userText
    : entry.content;
}

function formattedToolArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, null, 2);
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function eventKey(event: SessionEvent, index: number): string {
  if (event.type === 'tool_call') return `tool-${event.id}`;
  if (event.type === 'message') {
    return `msg-${event.message.id ?? index}-${event.at}`;
  }
  if (event.type === 'draft') return `draft-${event.at}`;
  return `${event.type}-${index}-${event.at}`;
}

function timelineLabel(event: SessionEvent): string {
  switch (event.type) {
    case 'message':
      return `消息 · ${roleMeta(event.message.role).label}`;
    case 'draft':
      return '草稿 · 助手';
    case 'tool_interaction': {
      const kind =
        event.interaction.kind === 'ask_user'
          ? '提问'
          : event.interaction.approvalKind === 'doom_loop'
            ? '循环审批'
            : '工具审批';
      return `${kind} · ${event.interaction.status}`;
    }
    case 'turn_start':
      return `轮次开始 · ${event.mode}`;
    case 'turn_end':
      return `轮次结束 · ${event.endReason}`;
    case 'model_call':
      return `模型请求 · ${event.identity.provider}/${event.identity.model} · ${event.durationMs}ms`;
    case 'tool_call':
      return `工具 · ${event.name}`;
    case 'plan':
      return `执行计划 · ${event.goal || '（无目标）'}`;
    case 'verify':
      return `验收 · ${event.verdict}`;
    case 'handoff':
      return '任务交接';
    case 'compaction':
      return `上下文压缩 · 覆盖 ${event.droppedCount} · 保留 ${event.keptCount}`;
    default:
      return (event as SessionEvent).type;
  }
}

function toolStatusTag(
  status: TraceToolCallEvent['status'],
): { type: 'success' | 'danger' | 'warning' | 'info'; label: string } {
  switch (status) {
    case 'ok':
      return { type: 'success', label: '成功' };
    case 'blocked_policy':
      return { type: 'warning', label: '策略阻止' };
    case 'blocked_plan':
      return { type: 'warning', label: '计划阻止' };
    case 'duplicate':
      return { type: 'warning', label: '重复阻止' };
    case 'doom_loop':
      return { type: 'warning', label: '循环检测' };
    case 'error':
      return { type: 'danger', label: '出错' };
    case 'aborted':
      return { type: 'info', label: '已中止' };
    case 'unknown_tool':
      return { type: 'danger', label: '未知工具' };
    default:
      return { type: 'info', label: String(status) };
  }
}
</script>

<template>
  <div class="chat-debug-tab">
    <aside class="chat-debug-tab__sidebar">
      <div class="chat-debug-tab__sidebar-header">
        <span>历史会话 ({{ sessions.length }})</span>
      </div>
      <ElScrollbar class="chat-debug-tab__session-list">
        <ElEmpty
          v-if="sessions.length === 0"
          description="暂无会话"
          :image-size="48"
        />
        <button
          v-for="session in sessions"
          :key="session.id"
          type="button"
          class="chat-debug-tab__session-item"
          :class="{ 'is-active': selectedId === session.id }"
          @click="selectSession(session)"
        >
          <div class="chat-debug-tab__session-title">{{ session.title }}</div>
          <div class="chat-debug-tab__session-meta">
            <span>{{ formatSessionTime(session.updatedAt) }}</span>
            <ElTag
              v-if="session.id === activeChatId"
              size="small"
              type="success"
              effect="plain"
            >
              当前
            </ElTag>
          </div>
        </button>
      </ElScrollbar>
    </aside>

    <section class="chat-debug-tab__detail">
      <ElEmpty
        v-if="!selectedId"
        description="选择左侧会话查看底层信息"
      />
      <div
        v-else-if="!detail && loading"
        class="chat-debug-tab__detail-placeholder"
      >
        正在加载会话底层信息…
      </div>
      <ElEmpty
        v-else-if="!detail"
        :description="loadError || '未找到该会话的底层信息'"
      />
      <template v-else>
        <div class="chat-debug-tab__detail-toolbar">
          <div class="chat-debug-tab__detail-title">
            {{ detail.meta.title }}
            <ElTag v-if="detail.isActive" size="small" type="success">活跃</ElTag>
          </div>
          <ElButton text :loading="loading" @click="refreshDetail">
            <template #icon>
              <NIcon :component="RefreshOutline" />
            </template>
            刷新
          </ElButton>
        </div>
        <p v-if="loadError" class="chat-debug-tab__note">
          刷新失败：{{ loadError }}（仍显示上一份数据）
        </p>

        <ElTabs v-model="detailTab" class="chat-debug-tab__tabs">
          <ElTabPane name="overview" label="概览" lazy>
            <ElScrollbar class="chat-debug-tab__pane-scroll">
              <div class="chat-debug-tab__pane-inner">
                <div class="chat-debug-tab__section">
                  <div class="chat-debug-tab__section-title">基本信息</div>
                  <ElDescriptions :column="1" border size="small">
                    <ElDescriptionsItem label="会话 ID">
                      <code class="chat-debug-tab__code">{{ detail.meta.id }}</code>
                    </ElDescriptionsItem>
                    <ElDescriptionsItem label="创建时间">
                      {{ formatSessionTime(detail.meta.createdAt) }}
                    </ElDescriptionsItem>
                    <ElDescriptionsItem label="最后更新">
                      {{ formatSessionTime(detail.meta.updatedAt) }}
                    </ElDescriptionsItem>
                    <ElDescriptionsItem label="时间线事件数">
                      {{ timelineEvents.length }}
                    </ElDescriptionsItem>
                    <ElDescriptionsItem label="模型上下文消息数">
                      {{ detail.llmMessageCount }}
                    </ElDescriptionsItem>
                    <ElDescriptionsItem label="模型">
                      {{ detail.modelLabel }}
                    </ElDescriptionsItem>
                    <ElDescriptionsItem
                      v-if="detail.modelConfig"
                      label="温度 / MaxTokens"
                    >
                      {{ detail.modelConfig.temperature ?? '-' }} /
                      {{ detail.modelConfig.maxTokens ?? '默认' }}
                    </ElDescriptionsItem>
                    <ElDescriptionsItem
                      v-if="detail.runtimeCapturedAt"
                      label="配置快照时间"
                    >
                      {{ formatSessionTime(detail.runtimeCapturedAt) }}
                    </ElDescriptionsItem>
                  </ElDescriptions>
                  <p v-if="detail.configNote" class="chat-debug-tab__note">
                    {{ detail.configNote }}
                  </p>
                </div>

                <ElCollapse
                  v-model="collapsedSections"
                  class="chat-debug-tab__collapse"
                >
                  <ElCollapseItem name="system">
                    <template #title>
                      <span class="chat-debug-tab__collapse-title">系统提示词</span>
                    </template>
                    <div class="chat-debug-tab__collapse-toolbar">
                      <ElButton
                        text
                        size="small"
                        @click.stop="copyText(detail.systemPrompt)"
                      >
                        <template #icon>
                          <NIcon :component="CopyOutline" />
                        </template>
                        复制
                      </ElButton>
                    </div>
                    <pre class="chat-debug-tab__pre">{{ detail.systemPrompt }}</pre>
                  </ElCollapseItem>

                  <ElCollapseItem name="tools">
                    <template #title>
                      <span class="chat-debug-tab__collapse-title">
                        工具列表 ({{ detail.tools.length }})
                      </span>
                    </template>
                    <ul class="chat-debug-tab__tool-list">
                      <li
                        v-for="tool in detail.tools"
                        :key="tool.name"
                        class="chat-debug-tab__tool-row"
                      >
                        <code class="chat-debug-tab__tool-name">{{ tool.name }}</code>
                        <CottageTooltip
                          v-if="tool.description"
                          :content="tool.description"
                          placement="top"
                          delay="lazy"
                        >
                          <span class="chat-debug-tab__tool-desc">
                            {{ tool.description }}
                          </span>
                        </CottageTooltip>
                      </li>
                    </ul>
                  </ElCollapseItem>
                </ElCollapse>
              </div>
            </ElScrollbar>
          </ElTabPane>

          <ElTabPane name="llm" lazy>
            <template #label>
              模型上下文
              <span class="chat-debug-tab__tab-count">{{ detail.llmMessageCount }}</span>
            </template>
            <ElScrollbar class="chat-debug-tab__pane-scroll">
              <div class="chat-debug-tab__pane-inner">
                <div class="chat-debug-tab__section-header">
                  <span class="chat-debug-tab__section-title">
                    压缩后发给 AI 的投影
                  </span>
                  <ElButton text size="small" @click="copyText(llmHistoryJson)">
                    <template #icon>
                      <NIcon :component="CopyOutline" />
                    </template>
                    复制 JSON
                  </ElButton>
                </div>
                <ElEmpty
                  v-if="detail.llmHistory.length === 0"
                  description="尚无模型上下文"
                  :image-size="48"
                />
                <template v-else>
                  <div v-if="hasOlderLlm" class="chat-debug-tab__load-older">
                    <ElButton text size="small" @click="loadOlderLlm">
                      加载更早（还有 {{ hiddenOlderLlmCount }} 条）
                    </ElButton>
                  </div>
                  <ol class="chat-debug-tab__message-list">
                    <li
                      v-for="(entry, index) in visibleLlmHistory"
                      :key="`llm-${entry.id ?? hiddenOlderLlmCount + index}`"
                      class="chat-debug-tab__message-item"
                      :class="`chat-debug-tab__message-item--${entry.role}`"
                    >
                      <div class="chat-debug-tab__message-marker">
                        {{ hiddenOlderLlmCount + index + 1 }}
                      </div>
                      <article class="chat-debug-tab__message-card">
                        <header class="chat-debug-tab__message-header">
                          <ElTag
                            :type="roleMeta(entry.role).tagType"
                            size="small"
                            effect="plain"
                          >
                            {{ roleMeta(entry.role).label }}
                          </ElTag>
                          <div class="chat-debug-tab__message-flags">
                            <ElTag
                              v-if="entry.toolCalls?.length"
                              size="small"
                              type="warning"
                            >
                              {{ entry.toolCalls.length }} 次工具调用
                            </ElTag>
                            <ElTag
                              v-if="entry.toolCallId"
                              size="small"
                              type="info"
                            >
                              tool 结果
                            </ElTag>
                            <ElTag
                              v-if="entry.compaction"
                              size="small"
                              type="warning"
                            >摘要</ElTag>
                            <ElTag
                              v-if="entry.synthetic"
                              size="small"
                              type="info"
                            >合成</ElTag>
                          </div>
                        </header>
                        <pre
                          v-if="messageContent(entry)"
                          class="chat-debug-tab__message-content"
                        >{{ messageContent(entry) }}</pre>
                        <p
                          v-else-if="entry.toolCalls?.length"
                          class="chat-debug-tab__message-empty"
                        >
                          正文为空（本轮仅含工具调用，发给模型时 content 即为空字符串）
                        </p>
                        <details
                          v-if="
                            entry.reasoningContent &&
                            entry.reasoningContent.trim()
                          "
                          class="chat-debug-tab__message-details"
                        >
                          <summary>推理内容</summary>
                          <pre class="chat-debug-tab__message-content">{{
                            entry.reasoningContent
                          }}</pre>
                        </details>
                        <div
                          v-if="entry.toolCalls?.length"
                          class="chat-debug-tab__tool-calls"
                        >
                          <div
                            v-for="call in entry.toolCalls"
                            :key="call.id"
                            class="chat-debug-tab__tool-call"
                          >
                            <div class="chat-debug-tab__tool-call-header">
                              <code>{{ call.name }}</code>
                              <span>{{ call.id }}</span>
                            </div>
                            <details open>
                              <summary>调用参数</summary>
                              <pre class="chat-debug-tab__message-content">{{
                                formattedToolArgs(call.args)
                              }}</pre>
                            </details>
                          </div>
                        </div>
                        <div
                          v-if="entry.toolCallId"
                          class="chat-debug-tab__tool-result-id"
                        >
                          对应调用：<code>{{ entry.toolCallId }}</code>
                          <span v-if="entry.name"> · {{ entry.name }}</span>
                        </div>
                      </article>
                    </li>
                  </ol>
                </template>
              </div>
            </ElScrollbar>
          </ElTabPane>

          <ElTabPane name="timeline" lazy>
            <template #label>
              全链路时间线
              <span class="chat-debug-tab__tab-count">{{ timelineEvents.length }}</span>
            </template>
            <ElScrollbar
              ref="detailScrollRef"
              class="chat-debug-tab__pane-scroll"
              @scroll="onTimelineScroll"
            >
              <div class="chat-debug-tab__pane-inner">
                <div class="chat-debug-tab__section-header">
                  <span class="chat-debug-tab__section-title">
                    消息 + 执行事件
                  </span>
                  <ElButton text size="small" @click="copyText(timelineJson)">
                    <template #icon>
                      <NIcon :component="CopyOutline" />
                    </template>
                    复制 JSON
                  </ElButton>
                </div>

                <ElEmpty
                  v-if="timelineEvents.length === 0"
                  description="暂无事件"
                  :image-size="48"
                />
                <template v-else>
                  <div v-if="hasOlderTimeline" class="chat-debug-tab__load-older">
                    <ElButton
                      text
                      size="small"
                      :loading="loadingOlder"
                      @click="tryLoadOlderTimeline"
                    >
                      加载更早（还有 {{ hiddenOlderTimelineCount }} 条）
                    </ElButton>
                  </div>
                  <ElCollapse
                    v-model="timelineExpanded"
                    class="chat-debug-tab__timeline"
                  >
                    <ElCollapseItem
                      v-for="(event, index) in visibleTimelineEvents"
                      :key="eventKey(event, hiddenOlderTimelineCount + index)"
                      :name="eventKey(event, hiddenOlderTimelineCount + index)"
                      :class="`chat-debug-tab__timeline-item chat-debug-tab__timeline-item--${event.type}`"
                    >
                      <template #title>
                        <span class="chat-debug-tab__timeline-title">
                          <span class="chat-debug-tab__timeline-index">{{
                            hiddenOlderTimelineCount + index + 1
                          }}</span>
                          <span class="chat-debug-tab__timeline-label">{{
                            timelineLabel(event)
                          }}</span>
                          <span class="chat-debug-tab__timeline-time">{{
                            formatTime(event.at)
                          }}</span>
                          <template v-if="event.type === 'message'">
                            <ElTag
                              size="small"
                              effect="plain"
                              :type="roleMeta(event.message.role).tagType"
                            >
                              {{ roleMeta(event.message.role).label }}
                            </ElTag>
                            <ElTag
                              v-if="event.message.synthetic"
                              size="small"
                              type="info"
                            >合成</ElTag>
                            <ElTag
                              v-if="event.message.interrupted"
                              size="small"
                              type="danger"
                            >中断</ElTag>
                          </template>
                          <template v-else-if="event.type === 'draft'">
                            <ElTag size="small" type="warning">未落盘</ElTag>
                          </template>
                          <template v-else-if="event.type === 'tool_call'">
                            <ElTag
                              size="small"
                              :type="toolStatusTag(event.status).type"
                            >
                              {{ toolStatusTag(event.status).label }}
                            </ElTag>
                            <ElTag
                              v-if="event.durationMs !== undefined"
                              size="small"
                              type="info"
                            >
                              {{ event.durationMs }}ms
                            </ElTag>
                          </template>
                          <ElTag
                            v-else-if="event.type === 'compaction'"
                            size="small"
                            type="warning"
                          >
                            compaction
                          </ElTag>
                        </span>
                      </template>

                      <div class="chat-debug-tab__timeline-body">
                        <template
                          v-if="event.type === 'message' || event.type === 'draft'"
                        >
                          <pre
                            v-if="messageContent(event.message)"
                            class="chat-debug-tab__message-content"
                          >{{ messageContent(event.message) }}</pre>
                          <details
                            v-if="
                              event.type === 'message' &&
                              event.message.role === 'user' &&
                              event.message.userText &&
                              event.message.userText !== event.message.content
                            "
                            class="chat-debug-tab__message-details"
                          >
                            <summary>发送给模型的原始内容</summary>
                            <pre class="chat-debug-tab__message-content">{{
                              event.message.content
                            }}</pre>
                          </details>
                          <details
                            v-if="event.message.reasoningContent"
                            class="chat-debug-tab__message-details"
                          >
                            <summary>推理内容</summary>
                            <pre class="chat-debug-tab__message-content">{{
                              event.message.reasoningContent
                            }}</pre>
                          </details>
                          <div
                            v-if="event.message.toolCalls?.length"
                            class="chat-debug-tab__tool-calls"
                          >
                            <div
                              v-for="call in event.message.toolCalls"
                              :key="call.id"
                              class="chat-debug-tab__tool-call"
                            >
                              <div class="chat-debug-tab__tool-call-header">
                                <code>{{ call.name }}</code>
                                <span>{{ call.id }}</span>
                              </div>
                              <details>
                                <summary>调用参数</summary>
                                <pre class="chat-debug-tab__message-content">{{
                                  formattedToolArgs(call.args)
                                }}</pre>
                              </details>
                            </div>
                          </div>
                          <div
                            v-if="event.message.toolCallId"
                            class="chat-debug-tab__tool-result-id"
                          >
                            对应调用：<code>{{ event.message.toolCallId }}</code>
                          </div>
                        </template>

                        <template v-else-if="event.type === 'tool_interaction'">
                          <pre class="chat-debug-tab__pre">{{
                            JSON.stringify(
                              {
                                callId: event.callId,
                                interaction: event.interaction,
                              },
                              null,
                              2,
                            )
                          }}</pre>
                        </template>

                        <template v-else-if="event.type === 'tool_call'">
                          <div class="chat-debug-tab__section-label">参数</div>
                          <pre class="chat-debug-tab__pre">{{ event.args }}</pre>
                          <div class="chat-debug-tab__section-label">结果</div>
                          <pre class="chat-debug-tab__pre">{{
                            event.resultSnippet
                          }}</pre>
                          <template
                            v-if="
                              event.diffSnippet !== undefined ||
                              event.before !== undefined ||
                              event.after !== undefined
                            "
                          >
                            <div class="chat-debug-tab__section-label">文件变更</div>
                            <FileWriteDiff
                              :before="event.before"
                              :after="event.after"
                              :diff="event.diffSnippet"
                              :created="event.created"
                            />
                          </template>
                        </template>

                        <template v-else-if="event.type === 'plan'">
                          <pre class="chat-debug-tab__pre">条目数：{{ event.itemCount }}</pre>
                          <pre
                            v-if="event.budget"
                            class="chat-debug-tab__pre"
                          >{{ JSON.stringify(event.budget, null, 2) }}</pre>
                        </template>

                        <template v-else-if="event.type === 'verify'">
                          <pre class="chat-debug-tab__pre">{{
                            `${event.verdict} · ${event.checkCount} 项检查 · 清单 ${event.manifestPathCount} 路径${
                              event.uncovered.length
                                ? `\n未覆盖：\n${event.uncovered.map((i) => `· ${i}`).join('\n')}`
                                : ''
                            }`
                          }}</pre>
                        </template>

                        <template v-else-if="event.type === 'handoff'">
                          <pre class="chat-debug-tab__pre">{{ event.summary }}</pre>
                          <pre class="chat-debug-tab__pre">{{
                            `未完成 ${event.remainingCount} 项 · 建议下一步 ${event.nextStepCount} 项`
                          }}</pre>
                        </template>

                        <template v-else-if="event.type === 'compaction'">
                          <pre class="chat-debug-tab__pre">{{
                            `tokens ${event.beforeTokens} → ~${event.afterTokensEstimate}\ncovered: ${(event.coveredMessageIds ?? []).length} ids`
                          }}</pre>
                          <pre
                            v-if="event.summaryMessage"
                            class="chat-debug-tab__pre"
                          >{{ event.summaryMessage.content }}</pre>
                        </template>

                        <template v-else-if="event.type === 'turn_end' && event.error">
                          <pre
                            class="chat-debug-tab__pre chat-debug-tab__pre--error"
                          >{{ event.error }}</pre>
                        </template>

                        <template v-else-if="event.type === 'turn_start'">
                          <pre class="chat-debug-tab__pre">{{
                            `mode=${event.mode} · promptChars=${event.promptChars}`
                          }}</pre>
                        </template>
                      </div>
                    </ElCollapseItem>
                  </ElCollapse>
                </template>
              </div>
            </ElScrollbar>
          </ElTabPane>
        </ElTabs>
      </template>
    </section>
  </div>
</template>

<style scoped>
.chat-debug-tab {
  display: flex;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--cottage-border);
  border-radius: var(--cottage-radius-control);
  overflow: hidden;
  background: var(--cottage-surface);
}

.chat-debug-tab__sidebar {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-blank);
}

.chat-debug-tab__sidebar-header {
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cottage-muted);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.chat-debug-tab__session-list {
  flex: 1;
}

.chat-debug-tab__session-item {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}

.chat-debug-tab__session-item:hover {
  background: var(--el-fill-color-light);
}

.chat-debug-tab__session-item.is-active {
  background: var(--el-color-primary-light-9);
}

.chat-debug-tab__session-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-debug-tab__session-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--cottage-muted);
}

.chat-debug-tab__detail {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--cottage-surface-sunken);
}

.chat-debug-tab__detail-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 24px;
  color: var(--cottage-muted);
  font-size: 13px;
}

.chat-debug-tab__detail-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-blank);
}

.chat-debug-tab__detail-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}

.chat-debug-tab__tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-debug-tab__tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 14px;
  background: var(--el-fill-color-blank);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.chat-debug-tab__tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}

.chat-debug-tab__tabs :deep(.el-tabs__item) {
  height: 36px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--cottage-muted);
}

.chat-debug-tab__tabs :deep(.el-tabs__item.is-active) {
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.chat-debug-tab__tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

.chat-debug-tab__tabs :deep(.el-tab-pane) {
  height: 100%;
}

.chat-debug-tab__tab-count {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.chat-debug-tab__tabs :deep(.el-tabs__item.is-active) .chat-debug-tab__tab-count {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.chat-debug-tab__pane-scroll {
  height: 100%;
}

.chat-debug-tab__pane-inner {
  padding: 12px 14px 20px;
}

.chat-debug-tab__section {
  margin-bottom: 16px;
}

.chat-debug-tab__section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.chat-debug-tab__section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--cottage-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 8px;
}

.chat-debug-tab__section-header .chat-debug-tab__section-title {
  margin-bottom: 0;
}

.chat-debug-tab__note {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-color-warning);
}

.chat-debug-tab__code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  word-break: break-all;
}

.chat-debug-tab__pre {
  margin: 0;
  padding: 12px 14px;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--cottage-radius-control);
  font-size: 12px;
  line-height: 1.6;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--el-text-color-primary);
}

.chat-debug-tab__pre--json {
  max-height: 360px;
  overflow: auto;
}

.chat-debug-tab__message-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.chat-debug-tab__message-item {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}

.chat-debug-tab__message-marker {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-top: 8px;
  border-radius: 50%;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
}

.chat-debug-tab__message-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-left: 3px solid var(--el-color-info);
  border-radius: var(--cottage-radius-control);
  background: var(--el-fill-color-blank);
}

.chat-debug-tab__message-item--user .chat-debug-tab__message-card {
  border-left-color: var(--el-color-primary);
}

.chat-debug-tab__message-item--assistant .chat-debug-tab__message-card {
  border-left-color: var(--el-color-success);
}

.chat-debug-tab__message-item--tool .chat-debug-tab__message-card {
  border-left-color: var(--el-color-warning);
}

.chat-debug-tab__message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--el-border-color-extra-light);
  background: var(--el-fill-color-lighter);
}

.chat-debug-tab__message-flags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
}

.chat-debug-tab__message-content {
  max-height: 280px;
  margin: 0;
  padding: 9px 10px;
  overflow: auto;
  background: transparent;
  color: var(--el-text-color-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.chat-debug-tab__message-empty {
  margin: 0;
  padding: 9px 10px;
  color: var(--cottage-muted);
  font-size: 12px;
  line-height: 1.5;
}

.chat-debug-tab__message-details {
  border-top: 1px solid var(--el-border-color-extra-light);
}

.chat-debug-tab__message-details summary,
.chat-debug-tab__tool-call summary {
  padding: 7px 10px;
  color: var(--el-color-primary);
  font-size: 12px;
  cursor: pointer;
}

.chat-debug-tab__message-context,
.chat-debug-tab__tool-result-id {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 7px 10px;
  border-top: 1px solid var(--el-border-color-extra-light);
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.chat-debug-tab__tool-calls {
  display: grid;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--el-border-color-extra-light);
  background: var(--el-fill-color-light);
}

.chat-debug-tab__tool-call {
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background: var(--el-fill-color-blank);
}

.chat-debug-tab__tool-call-header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.chat-debug-tab__tool-call-header code {
  color: var(--el-color-warning-dark-2);
  font-size: 12px;
  font-weight: 600;
}

.chat-debug-tab__tool-call-header span,
.chat-debug-tab__tool-call-id {
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-debug-tab__tool-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--cottage-radius-control);
  background: var(--el-fill-color-blank);
  font-size: 12px;
}

.chat-debug-tab__tool-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 3px 10px;
  line-height: 1.45;
  border-bottom: 1px solid var(--el-border-color-extra-light);
}

.chat-debug-tab__tool-row:last-child {
  border-bottom: none;
}

.chat-debug-tab__tool-row:nth-child(even) {
  background: var(--el-fill-color-lighter);
}

.chat-debug-tab__tool-name {
  flex: 0 0 148px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  color: var(--el-color-primary);
  word-break: break-all;
}

.chat-debug-tab__tool-desc {
  flex: 1;
  min-width: 0;
  color: var(--el-text-color-secondary);
}

.chat-debug-tab__collapse {
  margin-bottom: 16px;
  border: none;
}

.chat-debug-tab__collapse :deep(.el-collapse-item__header) {
  height: 36px;
  line-height: 36px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cottage-muted);
  background: transparent;
  border-bottom: 1px solid var(--cottage-border);
}

.chat-debug-tab__collapse :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.chat-debug-tab__collapse-title {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.chat-debug-tab__collapse-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 6px;
}

.chat-debug-tab__load-older {
  display: flex;
  justify-content: center;
  padding: 4px 0 10px;
}

.chat-debug-tab__timeline {
  border: none;
}

.chat-debug-tab__timeline :deep(.el-collapse-item) {
  margin-bottom: 8px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--cottage-radius-control);
  overflow: hidden;
  background: var(--el-fill-color-blank);
}

.chat-debug-tab__timeline :deep(.el-collapse-item__header) {
  height: auto;
  min-height: 40px;
  line-height: 1.4;
  padding: 8px 12px;
  border-bottom: none;
  background: var(--el-fill-color-lighter);
}

.chat-debug-tab__timeline :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.chat-debug-tab__timeline :deep(.el-collapse-item__content) {
  padding: 0;
}

.chat-debug-tab__timeline-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  min-width: 0;
  padding-right: 8px;
}

.chat-debug-tab__timeline-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--el-fill-color);
  color: var(--el-text-color-secondary);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.chat-debug-tab__timeline-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.chat-debug-tab__timeline-time {
  font-size: 11px;
  color: var(--cottage-muted);
  font-variant-numeric: tabular-nums;
}

.chat-debug-tab__timeline-body {
  padding: 10px 12px 12px;
  border-top: 1px solid var(--el-border-color-extra-light);
}

.chat-debug-tab__section-label {
  margin: 8px 0 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--cottage-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.chat-debug-tab__section-label:first-child {
  margin-top: 0;
}

.chat-debug-tab__pre--error {
  color: var(--el-color-danger);
  border-color: var(--el-color-danger-light-5);
}

.chat-debug-tab__timeline-item--message :deep(.el-collapse-item__header) {
  border-left: 3px solid var(--el-color-primary);
}

.chat-debug-tab__timeline-item--tool_call :deep(.el-collapse-item__header) {
  border-left: 3px solid var(--el-color-warning);
}

.chat-debug-tab__timeline-item--compaction :deep(.el-collapse-item__header) {
  border-left: 3px solid var(--el-color-warning);
}

.chat-debug-tab__timeline-item--turn_start :deep(.el-collapse-item__header),
.chat-debug-tab__timeline-item--turn_end :deep(.el-collapse-item__header) {
  border-left: 3px solid var(--el-color-info);
}
</style>
