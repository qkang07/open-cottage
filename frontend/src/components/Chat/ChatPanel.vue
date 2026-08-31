<script setup lang="ts">
import {
  AddOutline,
  ChatbubbleOutline,
  CloseOutline,
  DocumentOutline,
  DocumentTextOutline,
  FolderOpenOutline,
  LayersOutline,
  Pin,
  PinOutline,
  SearchOutline,
  TimeOutline,
  TrashOutline,
  } from '@vicons/ionicons5';
import {
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElInput,
  ElMessage,
  ElMessageBox
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NEllipsis,
  NIcon,
  NSpin,
  NText
} from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  collectMessageChangedFiles,
  type MessageChangedFile,
} from '../../chat/messageChangedFiles';
import type { AgentStatus } from '../../agent/CottageAgent';
import type { OptionalToolGroupId } from '../../agent/toolCatalog';
import type { SearchSource } from '../../config/constants';
import type { CottageAgent } from '../../agent/CottageAgent';
import {
  createAssistantMessage,
  createUserMessage,
  type CottageMessage,
  type StoredMessage,
} from '../../agent/messages';
import { isPendingInteraction } from '../../chat/toolCallInteraction';
import type { ComposedUserMessage } from '../../chat/userMessageFormat';
import type { ChatAttachment } from '../../chat/attachments';
import { formatSessionTime, loadSessionSnapshot } from '../../config/chatSessions';
import {
  configRevision,
  getActiveModelPreset,
  getLlmConfig,
} from '../../config/store';
import {
  isApiKeyRequiredForConfig,
  presetHasApiKey,
  presetHasProviderConnection,
} from '../../config/llmKeyStatus';
import {
  normalizeProviderId,
} from '../../config/constants';
import { getSecretForProvider } from '../../config/secrets';
import { useAgentStore } from '../../stores/agent';
import { useAiChangedFilesStore } from '../../stores/aiChangedFiles';
import { useDebugPanelStore } from '../../stores/debugPanel';
import { useExplorerModeStore } from '../../stores/explorerMode';
import { useNewEntryDialogStore } from '../../stores/newEntryDialog';
import { useSidebarCollapseStore } from '../../stores/sidebarCollapse';
import { useTaskStore } from '../../stores/task';
import { useThemeStore } from '../../stores/theme';
import { useWorkspaceStore } from '../../stores/workspace';
import {
  getPendingStagedApproval,
  pendingStagedApprovalRevision,
} from '../../platform/staging';
import ChatComposer from './ChatComposer.vue';
import ChatMessageList from './ChatMessageList.vue';
import StagedReviewBanner from './StagedReviewBanner.vue';
import { getPendingAsk, resolvePendingAsk } from '../../agent/askUserTool';
import { isAskUserTool } from '../../agent/toolNames';
import AgentStatusBar from './AgentStatusBar.vue';

type ActiveModelStatus =
  | { kind: 'ok' }
  | { kind: 'no-model' }
  | { kind: 'missing-key'; provider: string };
function collectChangedFilesFromChat(chat: CottageAgent): MessageChangedFile[] {
  const seen = new Map<string, MessageChangedFile>();
  for (const message of chat.messages) {
    for (const file of collectMessageChangedFiles(message, { includeResetState: true })) {
      const existing = seen.get(file.path);
      if (!existing) {
        seen.set(file.path, file);
        continue;
      }
      existing.changeId = file.changeId;
      if (file.kind === 'deleted') existing.kind = 'deleted';
    }
  }
  return [...seen.values()];
}
const { t } = useI18n();
const message = ElMessage;
const agentStore = useAgentStore();
const taskStore = useTaskStore();
const workspaceStore = useWorkspaceStore();
const explorerModeStore = useExplorerModeStore();
const sidebarStore = useSidebarCollapseStore();
const debugPanelStore = useDebugPanelStore();
const newEntryStore = useNewEntryDialogStore();
const themeStore = useThemeStore();
const {
  chat,
  chatSessions,
  activeChatId,
  enabledToolGroups,
  searchSource,
  availableSearchSources,
  lastMountError,
  chatMounting,
  sessionRuntimeStatus,
} = storeToRefs(agentStore);
const { runningTaskId } = storeToRefs(taskStore);
const { snapshot, selectedPath } = storeToRefs(workspaceStore);
const { explorerMode } = storeToRefs(explorerModeStore);
const { isDark } = storeToRefs(themeStore);
const {
  secrets,
  secretsVersion,
} = storeToRefs(agentStore);
const emit = defineEmits<{
  (e: 'openSettings'): void;
}>();
const activeModelStatus = computed<ActiveModelStatus>(() => {
  // 依赖响应式引用，密钥或配置变化时重算
  void secretsVersion.value;
  void configRevision.value;
  const llmConfig = getLlmConfig();
  if (!llmConfig) return { kind: 'no-model' };
  const provider = normalizeProviderId(llmConfig.provider);
  const preset = getActiveModelPreset();
  if (preset && !presetHasProviderConnection(preset, secrets.value)) {
    return { kind: 'no-model' };
  }
  const providerSecret = getSecretForProvider(
    secrets.value,
    provider,
    llmConfig.connectionId,
  );
  // 无预设的旧配置仍可直接携带 Key / Base URL；除此之外必须有对应提供商连接。
  if (
    !preset &&
    !providerSecret &&
    !llmConfig.apiKey?.trim() &&
    !llmConfig.baseUrl?.trim()
  ) {
    return { kind: 'no-model' };
  }
  const secretBaseUrl =
    (preset ? secrets.value.presetApiKeys?.[preset.id]?.baseUrl : undefined) ||
    providerSecret?.baseUrl;
  if (!isApiKeyRequiredForConfig(llmConfig, secretBaseUrl)) return { kind: 'ok' };
  const hasKey = preset
    ? presetHasApiKey(preset, secrets.value)
    : Boolean(
        llmConfig.apiKey?.trim() ||
          providerSecret?.apiKey?.trim(),
      );
  return hasKey ? { kind: 'ok' } : { kind: 'missing-key', provider };
});
const historyOpen = ref(false);
const historyQuery = ref('');
function projectHistoryForReadonlyView(history: readonly StoredMessage[]): CottageMessage[] {
  const messages: CottageMessage[] = [];
  let currentAssistant: CottageMessage | null = null;

  for (const stored of history) {
    if (stored.role === 'system') continue;
    if (stored.role === 'user') {
      currentAssistant = null;
      const userMessage = createUserMessage({
        llmContent: stored.content,
        userText: stored.userText ?? stored.content,
        fileReferences: stored.fileReferences,
        activeFilePath: stored.activeFilePath,
        attachments: stored.attachments,
      });
      if (stored.id) userMessage.id = stored.id;
      messages.push(userMessage);
      continue;
    }
    if (stored.role === 'assistant') {
      if (!currentAssistant) {
        currentAssistant = createAssistantMessage();
        if (stored.id) currentAssistant.id = stored.id;
        messages.push(currentAssistant);
      }
      if (stored.reasoningContent?.trim()) {
        currentAssistant.sections.push({ type: 'think', text: stored.reasoningContent });
      }
      if (stored.content) currentAssistant.sections.push({ type: 'content', text: stored.content });
      for (const call of stored.toolCalls ?? []) {
        currentAssistant.sections.push({
          type: 'call',
          id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.args, null, 2),
          interaction: call.interaction,
          running: isPendingInteraction(call.interaction),
        });
      }
      if (stored.error) currentAssistant.error = stored.error;
      if (stored.completedAt) currentAssistant.completedAt = stored.completedAt;
      continue;
    }
    const call = messages
      .flatMap((message) => message.sections)
      .find(
        (section) => section.type === 'call' && section.id === stored.toolCallId,
      ) ?? currentAssistant?.sections.find(
        (section) => section.type === 'call' && !section.result,
      );
    if (call?.type === 'call') {
      call.result = stored.content;
      call.running = false;
      call.before = stored.writePreview?.before;
      call.after = stored.writePreview?.after;
      call.created = stored.writePreview?.created;

      // 与运行时投影保持一致：已回答的 askUser 独立成可见卡片，
      // 不依赖后续用户/助手消息的分组边界。
      if (isAskUserTool(call.name)) {
        const sourceIndex = messages.findIndex((message) =>
          message.sections.includes(call),
        );
        if (sourceIndex >= 0) {
          const source = messages[sourceIndex]!;
          const sectionIndex = source.sections.indexOf(call);
          if (sectionIndex >= 0) source.sections.splice(sectionIndex, 1);

          const askMessage = createAssistantMessage();
          askMessage.sections.push(call);
          const insertAt = source.sections.length > 0 ? sourceIndex + 1 : sourceIndex;
          if (source.sections.length === 0 && !source.error) {
            messages.splice(sourceIndex, 1, askMessage);
          } else {
            messages.splice(insertAt, 0, askMessage);
          }
          currentAssistant = askMessage;
        }
      }
    }
  }
  return messages;
}
const historyPreview = ref<{ sessionId: string; messages: CottageMessage[] } | null>(null);
const historyMessages = computed(() =>
  !chat.value && historyPreview.value?.sessionId === activeChatId.value
    ? historyPreview.value.messages
    : [],
);
watch(
  activeChatId,
  (sessionId) => {
    historyPreview.value = null;
    if (!sessionId) return;
    void loadSessionSnapshot(sessionId)
      .then((snapshot) => {
        if (activeChatId.value === sessionId) {
          historyPreview.value = {
            sessionId,
            messages: projectHistoryForReadonlyView(snapshot.history),
          };
        }
      })
      .catch((error) => {
        console.warn('[Chat] 读取历史会话失败，已跳过只读展示：', error);
      });
  },
  { immediate: true },
);
const chatBusy = computed(() => chat.value?.viewState.busy ?? false);
const agentStatus = computed<AgentStatus>(
  () => chat.value?.viewState.status ?? { phase: 'idle' },
);
const chatMessageCount = computed(
  () => chat.value?.viewState.messages.length ?? historyMessages.value.length,
);
const contextTokens = computed(() => chat.value?.viewState.contextTokens ?? 0);
const contextTokensCalibrated = computed(
  () => chat.value?.viewState.contextTokensCalibrated ?? false,
);
const contextWindow = computed(() => chat.value?.viewState.contextWindow ?? 0);
const contextTokensPercent = computed(
  () => chat.value?.viewState.contextTokensPercent ?? 0,
);
const modifiedFileEntries = computed(() => {
  const c = chat.value;
  if (!c) return [];
  void c.viewState.sectionVersion;
  return collectChangedFilesFromChat(c);
});
const modifiedFiles = computed(() =>
  modifiedFileEntries.value.map((f) => f.path),
);
// 同步到 AI 改动标记 store，供文件管理器角标展示
const aiChangedFilesStore = useAiChangedFilesStore();
const aiChangedScopeId = computed(
  () => chat.value?.getSessionId() ?? activeChatId.value ?? null,
);
watch(
  [modifiedFileEntries, aiChangedScopeId],
  ([entries, sessionId]) => {
    aiChangedFilesStore.sync(entries, sessionId ?? null);
  },
  { immediate: true },
);
const modifiedFilesExpanded = ref<string[]>([]);
const stopBeforeSendInProgress = ref(false);
const mountRetrying = ref(false);
/** 待发送的图片附件（粘贴/拖拽/上传/链接导入） */
const pendingAttachments = ref<ChatAttachment[]>([]);
function handleAddAttachments(attachments: ChatAttachment[]) {
  pendingAttachments.value = [...pendingAttachments.value, ...attachments];
}
function handleRemoveAttachment(id: string) {
  pendingAttachments.value = pendingAttachments.value.filter(
    (att) => att.id !== id,
  );
}
const activeSession = computed(() =>
  chatSessions.value.find((s) => s.id === activeChatId.value),
);
type SessionStatusKind = 'running' | 'interrupted' | null;
function sessionStatusKind(sessionId: string): SessionStatusKind {
  const status = sessionRuntimeStatus.value[sessionId];
  if (!status) return null;
  if (status.busy) return 'running';
  if (status.inFlight) return 'interrupted';
  return null;
}
const backgroundBusyCount = computed(() =>
  Object.entries(sessionRuntimeStatus.value).filter(
    ([id, status]) => status.busy && id !== activeChatId.value,
  ).length,
);
const filteredChatSessions = computed(() => {
  const query = historyQuery.value.trim().toLocaleLowerCase();
  if (!query) return chatSessions.value;
  return chatSessions.value.filter((item) =>
    item.title.toLocaleLowerCase().includes(query),
  );
});
const taskRunning = computed(() => Boolean(runningTaskId.value));
const chatLoading = computed(
  () =>
    Boolean(snapshot.value) &&
    activeModelStatus.value.kind === 'ok' &&
    !chat.value &&
    chatMounting.value,
);
const chatNotReady = computed(
  () =>
    Boolean(snapshot.value) &&
    activeModelStatus.value.kind === 'ok' &&
    !chat.value &&
    !chatMounting.value,
);
/** 无消息或设置/未就绪提示时：将提示与输入框作为一组垂直居中 */
const chatComposerCentered = computed(() => {
  if (!snapshot.value) return false;
  if (chatMessageCount.value > 0) return false;
  if (activeModelStatus.value.kind !== 'ok') return true;
  if (chatLoading.value || chatNotReady.value) return true;
  if (chat.value && !chatBusy.value) return true;
  return false;
});
/** 空白工作区：欢迎面板与聊天合并（无文件预览 / 非资源管理器 / 无暂存审批） */
const hasPendingStagedReview = computed(() => {
  void pendingStagedApprovalRevision.value;
  const sessionId = chat.value?.getSessionId() ?? activeChatId.value ?? null;
  return Boolean(
    getPendingStagedApproval(sessionId)?.store.pendingEntriesList().length,
  );
});
const showChatWelcome = computed(
  () =>
    Boolean(snapshot.value) &&
    !selectedPath.value &&
    !explorerMode.value &&
    !hasPendingStagedReview.value &&
    chatMessageCount.value === 0 &&
    !chatBusy.value,
);
const workspaceName = computed(() => snapshot.value?.rootName ?? null);
interface QuickAction {
  key: string;
  title: string;
  desc: string;
  icon: typeof FolderOpenOutline;
  disabled: boolean;
  run: () => void;
}
const quickActions = computed<QuickAction[]>(() => [
  {
    key: 'browse',
    title: t('preview.actionBrowse'),
    desc: t('preview.actionBrowseDesc'),
    icon: FolderOpenOutline,
    disabled: !snapshot.value,
    run: () => explorerModeStore.openExplorer(),
  },
  {
    key: 'search',
    title: t('preview.actionSearch'),
    desc: t('preview.actionSearchDesc'),
    icon: SearchOutline,
    disabled: !snapshot.value,
    run: () => sidebarStore.expandSidebar('search'),
  },
  {
    key: 'index',
    title: t('preview.actionIndex'),
    desc: t('preview.actionIndexDesc'),
    icon: LayersOutline,
    disabled: !snapshot.value,
    run: () => debugPanelStore.show('index'),
  },
  {
    key: 'newFile',
    title: t('preview.actionNewFile'),
    desc: t('preview.actionNewFileDesc'),
    icon: DocumentTextOutline,
    disabled: !snapshot.value,
    run: () => newEntryStore.open({ mode: 'file', dir: '', lockDir: false }),
  },
]);
const inputDisabled = computed(
  () =>
    taskRunning.value ||
    !snapshot.value ||
    chatLoading.value ||
    chatNotReady.value,
);
async function waitForChatIdle(instance: CottageAgent, timeoutMs = 4000): Promise<boolean> {
  if (!instance.busy) return true;
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      timer = null;
      cleanup(false);
    }, timeoutMs);
    const stopWatch = watch(
      () => instance.viewState.busy,
      (busy) => {
        if (!busy) cleanup(true);
      },
    );
    const cleanup = (idle: boolean) => {
      if (done) return;
      done = true;
      stopWatch();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(idle);
    };
  });
}
async function handleSend(msg: ComposedUserMessage) {
  if (!snapshot.value) {
    message.warning(t('common.openWorkspaceFolderFirst'));
    return;
  }
  let currentChat = chat.value;
  if (!currentChat) {
    await agentStore.ensureChatMounted();
    currentChat = chat.value;
  }
  if (!currentChat) {
    if (!getLlmConfig()) {
      message.warning(t('chat.needModelToast'));
    } else if (agentStore.lastMountError) {
      message.warning(agentStore.lastMountError);
    } else {
      message.warning(t('chat.chatNotReady'));
    }
    return;
  }
  if (taskRunning.value) {
    message.info(t('chat.taskRunningPauseFirst'));
    return;
  }
  const pendingAsk = getPendingAsk(currentChat.getSessionId());
  if (pendingAsk) {
    const answer = msg.llmContent.trim();
    if (!answer) {
      message.info(t('chat.enterAnswerFirst'));
      return;
    }
    resolvePendingAsk(answer, currentChat.getSessionId());
    return;
  }
  const pendingAskCall = currentChat
    .getPendingInteractionCalls()
    .find((c) => c.interaction.kind === 'ask_user');
  if (pendingAskCall) {
    const answer = msg.llmContent.trim();
    if (!answer) {
      message.info(t('chat.enterAnswerFirst'));
      return;
    }
    void currentChat.resolveInteraction(pendingAskCall.callId, {
      kind: 'ask_user',
      chosen: answer,
    });
    return;
  }
  const orchestrator = agentStore.orchestrator;
  if (
    orchestrator &&
    orchestrator.state.status === 'paused' &&
    orchestrator.humanQuestion
  ) {
    agentStore.answerOrchestrationHuman(msg.llmContent.trim());
    return;
  }
  if (currentChat.busy) {
    if (stopBeforeSendInProgress.value) {
      message.info(t('chat.stoppingPrev'));
      return;
    }
    stopBeforeSendInProgress.value = true;
    currentChat.abort();
    const idle = await waitForChatIdle(currentChat);
    stopBeforeSendInProgress.value = false;
    if (!idle) {
      message.warning(t('chat.stopRetryLater'));
      return;
    }
    if (chat.value !== currentChat) return;
  }
  const contentToSend = msg.llmContent.trim();
  if (!contentToSend && !msg.attachments?.length) return;
  try {
    const request = currentChat.next(msg);
    pendingAttachments.value = [];
    await request;
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}
function handleNewChat() {
  void agentStore.createNewChat().then(() => {
    if (!chat.value) {
      message.warning(lastMountError.value ?? t('chat.chatNotReady'));
    }
  });
  historyOpen.value = false;
}
async function handleRetryMount() {
  mountRetrying.value = true;
  try {
    await agentStore.retryChatMount();
    if (!chat.value) {
      message.warning(lastMountError.value ?? t('chat.chatStillNotReady'));
    }
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    mountRetrying.value = false;
  }
}
function handleSwitchChat(sessionId: string) {
  void agentStore.switchChat(sessionId);
  historyOpen.value = false;
}
function handleTogglePin(sessionId: string, event: Event) {
  event.stopPropagation();
  void agentStore.togglePinChat(sessionId).catch((error) => {
    message.error(error instanceof Error ? error.message : String(error));
  });
}
function handleDeleteSession(sessionId: string, title: string, event: Event) {
  event.stopPropagation();
  void ElMessageBox.confirm(
    t('chat.confirmDeleteSessionBody', { title }),
    t('chat.confirmDeleteSessionTitle'),
    {
      type: 'warning',
      confirmButtonText: t('common.delete'),
      cancelButtonText: t('common.cancel'),
    },
  )
    .then(async () => {
      try {
        await agentStore.deleteChat(sessionId);
        message.success(t('chat.sessionDeleted'));
      } catch (error) {
        message.error(error instanceof Error ? error.message : String(error));
      }
    })
    .catch(() => undefined);
}
function handleToggleToolGroup(groupId: OptionalToolGroupId, enabled: boolean) {
  const next = enabled
    ? [...new Set([...enabledToolGroups.value, groupId])]
    : enabledToolGroups.value.filter((id) => id !== groupId);
  void agentStore.setEnabledToolGroups(next).catch((error) => {
    message.error(error instanceof Error ? error.message : String(error));
  });
}
function handleSetSearchSource(source: SearchSource) {
  void agentStore.setSearchSource(source).catch((error) => {
    message.error(error instanceof Error ? error.message : String(error));
  });
}
</script>
<template>
  <div
    class="panel chat-panel"
    :class="{
      'chat-panel-centered': chatComposerCentered && !showChatWelcome,
      'chat-panel-welcome': showChatWelcome,
    }"
  >
    <div class="panel-header chat-panel-header">
      <div class="chat-panel-title">
        <NIcon :component="ChatbubbleOutline" class="chat-panel-title-icon" />
        <NEllipsis class="chat-panel-heading" :tooltip="true" style="font-weight: 600">
          {{ activeSession?.title ?? t('chat.newChat') }}
        </NEllipsis>
      </div>
      <div class="cottage-button-row">
        <CottageTooltip :content="t('chat.newChat')" placement="top">
          <ElButton
            class="cottage-new-chat-btn"
            type="primary"
            :disabled="!snapshot"
            @click="handleNewChat"
          >
            <template #icon>
              <NIcon :component="AddOutline" />
            </template>
            {{ t('chat.newChat') }}
          </ElButton>
        </CottageTooltip>
        <CottageTooltip
          :content="backgroundBusyCount > 0 ? t('chat.backgroundBusy', { count: backgroundBusyCount }) : t('chat.history')"
          placement="top"
        >
          <ElButton
            class="cottage-history-btn"
            plain
            :disabled="!snapshot"
            @click="historyOpen = true"
          >
            <template #icon>
              <NIcon :component="TimeOutline" />
            </template>
            {{ t('chat.history') }}
            <span v-if="backgroundBusyCount > 0" class="cottage-history-dot" />
          </ElButton>
        </CottageTooltip>
      </div>
    </div>
    <div v-show="showChatWelcome" class="chat-welcome-hero">
      <span class="chat-welcome-badge">
        <img
          :src="isDark ? '/logo-dark.svg' : '/logo-light.svg'"
          alt="Open Cottage"
          class="chat-welcome-logo"
        />
      </span>
      <h2 class="chat-welcome-title">
        {{
          workspaceName
            ? t('preview.welcomeBack', { name: workspaceName })
            : t('preview.welcomeCottage')
        }}
      </h2>
      <p class="chat-welcome-subtitle">
        {{
          workspaceName
            ? t('preview.hintWithWorkspace')
            : t('preview.hintNoWorkspace')
        }}
      </p>
    </div>
    <div
      v-show="!showChatWelcome"
      class="panel-body chat-messages"
    >
      <StagedReviewBanner v-if="snapshot" />
      <NText v-if="!snapshot" depth="3">
        {{ t('chat.needWorkspaceHint') }}
      </NText>
      <template v-else>
        <ChatMessageList
          v-if="chat || historyMessages.length > 0"
          :chat="chat"
          :messages="historyMessages"
          :session-id="activeChatId"
          :task-running="taskRunning"
        />
      </template>
    </div>
    <div class="chat-composer-dock">
      <div
        v-show="!showChatWelcome && chat && modifiedFiles.length > 0"
        class="chat-modified-files-wrap"
      >
        <ElCollapse
          v-model="modifiedFilesExpanded"
          class="chat-modified-files-collapse"
        >
          <ElCollapseItem name="modified-files">
            <template #title>
              <span class="chat-modified-files-label">
                <NIcon :component="DocumentOutline" />
                <span>{{ t('chat.modifiedFiles') }}</span>
                <NText depth="3">{{ modifiedFiles.length }}</NText>
              </span>
            </template>
            <div class="chat-modified-files-list">
              <CottageTooltip
                v-for="path in modifiedFiles"
                :key="path"
                :content="path"
                placement="top"
                delay="lazy"
              >
                <button
                  type="button"
                  :class="
                    path === selectedPath
                      ? 'chat-modified-files-item chat-modified-files-item-active'
                      : 'chat-modified-files-item'
                  "
                  @click="workspaceStore.selectFile(path)"
                >
                  {{ path }}
                </button>
              </CottageTooltip>
            </div>
          </ElCollapseItem>
        </ElCollapse>
      </div>
      <AgentStatusBar
        v-if="!showChatWelcome && chatBusy && agentStatus.phase !== 'idle'"
        :status="agentStatus"
      />
      <ChatComposer
        :disabled="inputDisabled"
        :busy="chatBusy"
        :task-running="taskRunning"
        :mounting="chatLoading"
        :not-ready="chatNotReady"
        :not-ready-message="lastMountError"
        :setup-state="activeModelStatus.kind"
        :mount-retrying="mountRetrying"
        :enabled-tool-groups="enabledToolGroups"
        :search-source="searchSource"
        :available-search-sources="availableSearchSources"
        :context-tokens="contextTokens"
        :context-tokens-calibrated="contextTokensCalibrated"
        :context-window="contextWindow"
        :context-tokens-percent="contextTokensPercent"
        :attachments="pendingAttachments"
        @send="handleSend"
        @stop="chat?.abort?.()"
        @toggle-tool-group="handleToggleToolGroup"
        @set-search-source="handleSetSearchSource"
        @add-attachments="handleAddAttachments"
        @remove-attachment="handleRemoveAttachment"
        @open-settings="emit('openSettings')"
        @retry-mount="void handleRetryMount()"
      />
    </div>
    <div v-show="showChatWelcome" class="chat-welcome-actions">
      <button
        v-for="action in quickActions"
        :key="action.key"
        type="button"
        class="chat-welcome-card"
        :disabled="action.disabled"
        @click="action.run()"
      >
        <span class="chat-welcome-card-icon">
          <NIcon :component="action.icon" />
        </span>
        <span class="chat-welcome-card-text">
          <span class="chat-welcome-card-title">{{ action.title }}</span>
          <span class="chat-welcome-card-desc">{{ action.desc }}</span>
        </span>
      </button>
    </div>
    <div v-if="historyOpen" class="chat-history-overlay">
      <div class="panel-header chat-history-overlay-header">
        <span class="chat-history-overlay-title">{{ t('chat.history') }}</span>
        <div class="cottage-button-row">
          <CottageTooltip :content="t('chat.newChat')" placement="top">
            <ElButton
              class="cottage-icon-btn"
              text
              :disabled="!snapshot"
              @click="handleNewChat"
            >
              <template #icon>
                <NIcon :component="AddOutline" />
              </template>
            </ElButton>
          </CottageTooltip>
          <CottageTooltip :content="t('common.close')" placement="top">
            <ElButton class="cottage-icon-btn" text @click="historyOpen = false">
              <template #icon>
                <NIcon :component="CloseOutline" />
              </template>
            </ElButton>
          </CottageTooltip>
        </div>
      </div>
      <div class="chat-history-overlay-body">
        <ElInput
          v-if="chatSessions.length > 0"
          v-model="historyQuery"
          class="chat-history-search"
          clearable
          :placeholder="t('chat.searchHistory')"
        >
          <template #prefix><NIcon :component="SearchOutline" /></template>
        </ElInput>
        <NText v-if="chatSessions.length === 0" depth="3">{{ t('chat.noHistory') }}</NText>
        <NText v-else-if="filteredChatSessions.length === 0" depth="3">{{ t('chat.noHistory') }}</NText>
        <NText v-if="historyQuery && filteredChatSessions.length > 0" depth="3" class="chat-history-results">
          {{ t('chat.historyResults', { shown: filteredChatSessions.length, total: chatSessions.length }) }}
        </NText>
        <div v-if="filteredChatSessions.length > 0" class="chat-session-list">
          <div
            v-for="item in filteredChatSessions"
            :key="item.id"
            role="button"
            tabindex="0"
            :class="[
              'chat-session-item',
              item.id === activeChatId ? 'chat-session-item-active' : '',
              item.pinned ? 'chat-session-item-pinned' : '',
            ]"
            @click="handleSwitchChat(item.id)"
            @keydown.enter="handleSwitchChat(item.id)"
            @keydown.space.prevent="handleSwitchChat(item.id)"
          >
            <div class="chat-session-item-row">
              <span class="chat-session-item-title">
                <CottageTooltip
                  v-if="item.pinned"
                  :content="t('chat.unpinSession')"
                  placement="top"
                  delay="lazy"
                >
                  <span class="chat-session-pin-badge">
                    <NIcon :component="Pin" class="chat-session-pin-icon" />
                  </span>
                </CottageTooltip>
                <span class="chat-session-item-title-text">{{ item.title }}</span>
              </span>
              <div class="chat-session-item-actions" @click.stop>
                <CottageTooltip
                  :content="item.pinned ? t('chat.unpinSession') : t('chat.pinSession')"
                  placement="top"
                >
                  <ElButton
                    class="cottage-icon-btn chat-session-action-btn"
                    :class="{ 'chat-session-action-btn-pinned': item.pinned }"
                    text
                    size="small"
                    @click="handleTogglePin(item.id, $event)"
                  >
                    <template #icon>
                      <NIcon :component="item.pinned ? Pin : PinOutline" />
                    </template>
                  </ElButton>
                </CottageTooltip>
                <CottageTooltip :content="t('chat.deleteSession')" placement="top">
                  <ElButton
                    class="cottage-icon-btn chat-session-action-btn"
                    text
                    size="small"
                    @click="handleDeleteSession(item.id, item.title, $event)"
                  >
                    <template #icon>
                      <NIcon :component="TrashOutline" />
                    </template>
                  </ElButton>
                </CottageTooltip>
              </div>
            </div>
            <span
              v-if="sessionStatusKind(item.id) === 'running'"
              class="chat-session-badge chat-session-badge-running"
            >
              <NSpin size="small" />
              {{ t('chat.sessionRunning') }}
            </span>
            <span
              v-else-if="sessionStatusKind(item.id) === 'interrupted'"
              class="chat-session-badge chat-session-badge-interrupted"
            >
              {{ t('chat.sessionInterrupted') }}
            </span>
            <span class="chat-session-item-time">
              {{ formatSessionTime(item.updatedAt) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
