<script setup lang="ts">
import { ElAlert, ElButton } from 'element-plus';
import { computed, nextTick, onMounted, onUnmounted, ref, watch, type ComponentPublicInstance } from 'vue';
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
const TURN_NAVIGATION_THRESHOLD = 6;

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

type ConversationTurn = {
  messageId: string;
  messageIndex: number;
  number: number;
  label: string;
};

const conversationTurns = computed<ConversationTurn[]>(() => {
  let number = 0;
  return messagesView.value.flatMap((message, messageIndex) => {
    if (message.role !== 'user') return [];
    number += 1;
    const label = message.userText?.replace(/\s+/g, ' ').trim()
      || t('chat.turnNavigationUntitled');
    return [{
      messageId: message.id,
      messageIndex,
      number,
      label: label.slice(0, 80),
    }];
  });
});
const showTurnNavigation = computed(
  () => conversationTurns.value.length >= TURN_NAVIGATION_THRESHOLD,
);
const activeTurnMessageId = ref<string | null>(null);
const messageElementRefs = new Map<string, HTMLElement>();

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

function updateActiveTurn() {
  if (!scrollParent || !conversationTurns.value.length) return;
  const containerTop = scrollParent.getBoundingClientRect().top;
  const anchorOffset = 72;
  let closestBefore: ConversationTurn | null = null;
  let firstAfter: ConversationTurn | null = null;
  for (const turn of conversationTurns.value) {
    const element = messageElementRefs.get(turn.messageId);
    if (!element) continue;
    const top = element.getBoundingClientRect().top - containerTop;
    if (top <= anchorOffset) {
      closestBefore = turn;
    } else if (!firstAfter) {
      firstAfter = turn;
    }
  }
  activeTurnMessageId.value = closestBefore?.messageId ?? firstAfter?.messageId ?? null;
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
  updateActiveTurn();
  await tryLoadOlder();
}

function setMessageElement(messageId: string, element: Element | ComponentPublicInstance | null) {
  if (element instanceof HTMLElement) {
    messageElementRefs.set(messageId, element);
    return;
  }
  messageElementRefs.delete(messageId);
}

async function navigateToTurn(turn: ConversationTurn) {
  while (hiddenOlderCount.value > turn.messageIndex) {
    if (loadOlder() <= 0) break;
  }
  await nextTick();
  const target = messageElementRefs.get(turn.messageId);
  if (!target) return;
  activeTurnMessageId.value = turn.messageId;
  stickToBottom.value = false;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  void nextTick(updateActiveTurn);
});

onUnmounted(() => {
  scrollParent?.removeEventListener('scroll', onScroll);
  scrollParent = null;
  messageElementRefs.clear();
});

watch(
  () => props.chat?.getSessionId?.() ?? props.sessionId ?? null,
  () => {
    stickToBottom.value = true;
    activeTurnMessageId.value = null;
    resetToTail();
    void nextTick(() => {
      scrollToBottom('auto', true);
      updateActiveTurn();
    });
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
  <div
    :class="[
      'chat-message-list',
      showTurnNavigation ? 'chat-message-list-with-turn-navigation' : '',
    ]"
  >
    <nav
      v-if="showTurnNavigation"
      class="chat-turn-navigation"
      :aria-label="t('chat.turnNavigation')"
    >
      <div class="chat-turn-navigation-panel">
        <button
          v-for="turn in conversationTurns"
          :key="turn.messageId"
          type="button"
          :class="[
            'chat-turn-navigation-item',
            turn.messageId === activeTurnMessageId ? 'chat-turn-navigation-item-active' : '',
          ]"
          :aria-current="turn.messageId === activeTurnMessageId ? 'step' : undefined"
          :aria-label="t('chat.turnNavigationItem', { turn: turn.number, title: turn.label })"
          :title="t('chat.turnNavigationItem', { turn: turn.number, title: turn.label })"
          @click="navigateToTurn(turn)"
        >
          <span class="chat-turn-navigation-dot" aria-hidden="true" />
          <span>{{ turn.number }}</span>
        </button>
      </div>
    </nav>
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
    <div
      v-for="(message, offset) in visibleItems"
      :key="message.id"
      :ref="(element) => setMessageElement(message.id, element)"
      class="chat-message-anchor"
    >
      <MessageView
        :message="message"
        :live="isLive(hiddenOlderCount + offset)"
        :version="
          needsSectionRefresh(message, hiddenOlderCount + offset)
            ? sectionVersion
            : 0
        "
        :session-id="chat?.getSessionId() ?? sessionId ?? ''"
      />
    </div>
    <div ref="bottomRef" />
  </div>
</template>

<style scoped>
.chat-message-list {
  position: relative;
}

.chat-message-list-with-turn-navigation {
  padding-right: 42px;
}

.chat-turn-navigation {
  position: sticky;
  top: 8px;
  z-index: 6;
  height: 0;
  margin-left: auto;
}

.chat-turn-navigation-panel {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 32px;
  max-height: min(68dvh, 540px);
  overflow-y: auto;
  padding: 4px 2px;
  border: 1px solid var(--cottage-border);
  border-radius: var(--cottage-radius-md);
  background: color-mix(in srgb, var(--cottage-surface) 92%, transparent);
  box-shadow: var(--cottage-shadow-card);
}

.chat-turn-navigation-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 24px;
  padding: 2px;
  border: 0;
  border-radius: var(--cottage-radius-sm);
  background: transparent;
  color: var(--cottage-ink-muted);
  font: inherit;
  font-size: var(--cottage-font-xs);
  cursor: pointer;
}

.chat-turn-navigation-item:hover,
.chat-turn-navigation-item:focus-visible {
  outline: none;
  background: var(--cottage-accent-bg);
  color: var(--cottage-ink);
}

.chat-turn-navigation-item-active {
  background: var(--cottage-accent-bg);
  color: var(--cottage-accent);
  font-weight: 700;
}

.chat-turn-navigation-dot {
  width: 4px;
  height: 4px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--cottage-border-strong);
}

.chat-turn-navigation-item-active .chat-turn-navigation-dot {
  background: var(--cottage-accent);
}

.chat-message-anchor {
  scroll-margin-top: 8px;
}

.chat-load-older {
  display: flex;
  justify-content: center;
  padding: 4px 0 10px;
}
</style>
