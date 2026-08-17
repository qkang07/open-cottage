<script setup lang="ts">
import { ElAlert, ElButton } from 'element-plus';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CottageAgent } from '../../agent/CottageAgent';
import type { CottageMessage } from '../../agent/messages';
import { pendingAskRevision } from '../../agent/askUserTool';
import { isAskUserTool } from '../../agent/toolNames';
import { pendingPlanApprovalRevision } from '../../platform/plan';
import {
  loadOlderPreservingScroll,
  useTailWindow,
} from '../../composables/useTailWindow';
import MessageView from './MessageView.vue';

/** 距底部不超过该像素时才跟随自动滚底 */
const BOTTOM_THRESHOLD_PX = 80;
const CHAT_PAGE_SIZE = 40;

const { t } = useI18n();
const props = defineProps<{
  chat: CottageAgent | null;
  /** Agent 无法挂载时，用已保存的会话记录维持只读展示。 */
  messages?: CottageMessage[];
  sessionId?: string | null;
  taskRunning: boolean;
}>();
const bottomRef = ref<HTMLDivElement | null>(null);
/** section 级刷新计数，驱动 MessageView 重读 section 内字段（streaming text、tool result） */
const sectionVersion = computed(() => props.chat?.viewState.sectionVersion ?? 0);
/**
 * props.chat.viewState.messages 是 shallowReactive 数组，
 * Vue 自动追踪 push/splice/length 变化，无需手动 renderVersion hack。
 */
const messagesView = computed(() => props.chat?.viewState.messages ?? props.messages ?? []);
const messageCount = computed(() => messagesView.value.length);

const {
  visibleItems,
  hasOlder,
  hiddenOlderCount,
  resetToTail,
  loadOlder,
  pinTailIfNeeded,
} = useTailWindow(() => messagesView.value, {
  pageSize: CHAT_PAGE_SIZE,
  maxWhenPinned: CHAT_PAGE_SIZE * 2,
});

/** 用户是否贴近底部；离开阈值后暂停自动滚底，回到阈值内再恢复 */
const stickToBottom = ref(true);
const loadingOlder = ref(false);
let scrollParent: HTMLElement | null = null;

function getScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function isNearBottom(container: HTMLElement): boolean {
  const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distance <= BOTTOM_THRESHOLD_PX;
}

function updateStickToBottom() {
  if (!scrollParent) return;
  stickToBottom.value = isNearBottom(scrollParent);
}

async function tryLoadOlder() {
  if (loadingOlder.value || !hasOlder.value) return;
  loadingOlder.value = true;
  try {
    await loadOlderPreservingScroll(scrollParent, loadOlder, nextTick);
  } finally {
    loadingOlder.value = false;
  }
}

async function onScroll() {
  updateStickToBottom();
  await tryLoadOlder();
}

function scrollToBottom(behavior: ScrollBehavior, force = false) {
  if (!force && !stickToBottom.value) return;
  bottomRef.value?.scrollIntoView({ behavior, block: 'end' });
}

onMounted(() => {
  scrollParent = getScrollParent(bottomRef.value);
  scrollParent?.addEventListener('scroll', onScroll, { passive: true });
  stickToBottom.value = true;
  resetToTail();
  scrollToBottom('smooth', true);
});

onUnmounted(() => {
  scrollParent?.removeEventListener('scroll', onScroll);
  scrollParent = null;
});

watch(
  () => props.chat?.getSessionId?.() ?? props.sessionId ?? null,
  () => {
    stickToBottom.value = true;
    resetToTail();
    void nextTick(() => scrollToBottom('auto', true));
  },
);

watch(messageCount, () => {
  pinTailIfNeeded(stickToBottom.value);
  scrollToBottom('smooth');
});
watch(sectionVersion, () => {
  if (!props.chat?.busy) return;
  // 流式更新时用 instant 滚动，避免 smooth 与高度变化互相拉扯
  scrollToBottom('auto');
});
watch(pendingAskRevision, () => {
  scrollToBottom('smooth');
});
watch(pendingPlanApprovalRevision, () => {
  scrollToBottom('smooth');
});
// props.chat 为非响应式裸对象，须每次渲染时实时读取，故用函数而非 computed
const liveIndex = () =>
  props.chat?.busy ? messagesView.value.length - 1 : -1;

function isLive(absoluteIndex: number): boolean {
  return absoluteIndex === liveIndex();
}

/**
 * 工具交互会原地改写 section 字段，而消息数组是 shallow-reactive。
 * askUser/工具审批卡片即使已不是最后一条流式消息，也必须收到 section 刷新信号。
 */
function needsSectionRefresh(message: CottageMessage, absoluteIndex: number): boolean {
  if (isLive(absoluteIndex)) return true;
  return message.sections.some(
    (section) =>
      section.type === 'call' &&
      (isAskUserTool(section.name) || section.interaction !== undefined),
  );
}
</script>
<template>
  <ElAlert
    v-if="taskRunning"
    type="info"
    :title="t('chat.taskAutoRunning')"
    style="margin-bottom: 12px"
  >
    {{ t('chat.taskAutoRunningHint') }}
  </ElAlert>
  <div v-if="hasOlder" class="chat-load-older">
    <ElButton
      text
      size="small"
      :loading="loadingOlder"
      @click="tryLoadOlder"
    >
      {{ t('chat.loadOlder', { n: hiddenOlderCount }) }}
    </ElButton>
  </div>
  <MessageView
    v-for="(message, offset) in visibleItems"
    :key="message.id"
    :message="message"
    :live="isLive(hiddenOlderCount + offset)"
    :version="
      needsSectionRefresh(message, hiddenOlderCount + offset)
        ? sectionVersion
        : 0
    "
    :session-id="chat?.getSessionId() ?? sessionId ?? ''"
  />
  <div ref="bottomRef" />
</template>

<style scoped>
.chat-load-older {
  display: flex;
  justify-content: center;
  padding: 4px 0 10px;
}
</style>
