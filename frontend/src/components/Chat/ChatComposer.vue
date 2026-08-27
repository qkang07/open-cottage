<script setup lang="ts">
import {
  CheckmarkOutline,
  ChevronDownOutline,
  CloseOutline,
  ImageOutline,
  KeyOutline,
  PauseCircleOutline,
  RefreshOutline,
  SendOutline,
  } from '@vicons/ionicons5';
import type { Editor } from '@tiptap/core';
import { useEditor } from '@tiptap/vue-3';
import {
  ElButton,
  ElDialog,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElPopover,
  ElMessage,
  ElSwitch,
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import CottageSelect from '@/ui/CottageSelect.vue';
import {
  NIcon,
  NSpin,
  NText
} from '@/ui/element-plus-primitives';
import type { SelectOption } from '@/ui/element-plus-types';
import { storeToRefs } from 'pinia';
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { setActiveChatReferencesForSend } from '../../chat/activeReferences';
import {
  type ChatAttachment,
  extractImagesFromClipboard,
  extractImagesFromDrop,
  fileToAttachment,
  isVisionEnabled,
} from '../../chat/attachments';
import { composeUserMessage } from '../../chat/composeUserMessage';
import {
  ImageUrlImportError,
  importImageFromUrl,
} from '../../chat/imageUrlImport';
import type { ComposedUserMessage } from '../../chat/userMessageFormat';
import {
  COTTAGE_FILE_DRAG_TYPE,
  formatReferenceLabel,
  newReferenceId,
} from '../../chat/fileReferences';
import {
  OPTIONAL_TOOL_GROUPS,
  type OptionalToolGroupId,
} from '../../agent/toolCatalog';
import {
  BUILTIN_PACKS,
  builtinPackByGroupId,
  isBuiltinPackAvailable,
} from '../../platform/packs/builtins';
import { workspace } from '../../workspace/FileSystemWorkspace';
import type { WorkspaceFileNode } from '../../workspace/types';
import type {
  CottageConfig,
  LlmModelConfig,
  ModelPreset,
  SearchSource,
} from '../../config/constants';
import {
  configRevision,
  clearSessionActiveImagePresetId,
  clearSessionActivePresetId,
  getActiveModelPreset,
  getCottageConfig,
  getLlmConfig,
  getSessionActiveImagePresetId,
  getSessionActivePresetId,
  setSessionActiveImagePresetId,
  setSessionActivePresetId,
} from '../../config/store';
import {
  loadLayeredCottageConfigWithOptions,
  saveLayeredCottageConfig,
} from '../../config/cottageStorage';
import {
  fetchProviderModels,
  getCachedProviderModels,
  pickDefaultReasoningEffort,
} from '../../config/modelCatalog';
import {
  resolveCottageModelCapabilities,
  supportsThinkingControl as modelSupportsThinkingControl,
  supportsVisionInput,
} from '../../config/modelCapabilities';
import type { LlmModelOption } from '../../config/llmProviders';
import { getSecretForProvider, loadProviderSecrets } from '../../config/secrets';
import { useAgentStore } from '../../stores/agent';
import { useChatReferenceStore } from '../../stores/chatReference';
import { useWorkspaceStore } from '../../stores/workspace';
import { useCottageServiceStore } from '../../stores/cottageService';
import {
  presetHasApiKey,
  providerConnectionExists,
  resolveActiveApiKey,
} from '../../config/llmKeyStatus';
import {
  getWorkspaceLastModelPresetId,
  getWorkspaceLastImageModelPresetId,
  setWorkspaceLastImageModelPresetId,
  setWorkspaceLastModelPresetId,
} from '../../workspace/modelPreference';
import ComposerAttachBanner from './ComposerAttachBanner.vue';
import FileMentionMenu from './FileMentionMenu.vue';
import ChatEditor from './tiptap/ChatEditor.vue';
import { createChatEditorExtensions } from './tiptap/editorConfig';
import {
  insertFileReferenceNode,
} from './tiptap/insertFileReference';
import { extractMessageFromEditor } from './tiptap/serialize';
const chatEditorExtensions = createChatEditorExtensions();
const props = withDefaults(
  defineProps<{
    disabled: boolean;
    busy: boolean;
    taskRunning: boolean;
    mounting?: boolean;
    /** 页面级模型状态：用于把配置引导贴在实际输入框上。 */
    setupState?: 'ok' | 'no-model' | 'missing-key' | null;
    /** Agent 已判定可配置但仍未挂载成功 */
    notReady?: boolean;
    notReadyMessage?: string | null;
    mountRetrying?: boolean;
    enabledToolGroups: OptionalToolGroupId[];
    searchSource: SearchSource | null;
    availableSearchSources: SearchSource[];
    contextTokens: number;
    contextTokensCalibrated: boolean;
    contextWindow: number;
    contextTokensPercent: number;
    attachments?: ChatAttachment[];
  }>(),
  {
    mounting: false,
    setupState: null,
    notReady: false,
    notReadyMessage: null,
    mountRetrying: false,
    attachments: () => [],
  },
);
const emit = defineEmits<{
  send: [message: ComposedUserMessage];
  stop: [];
  toggleToolGroup: [groupId: OptionalToolGroupId, enabled: boolean];
  setSearchSource: [source: SearchSource];
  addAttachments: [attachments: ChatAttachment[]];
  removeAttachment: [id: string];
  openSettings: [];
  retryMount: [];
}>();
type MentionState = {
  start: number;
  end: number;
  query: string;
};
type MentionEntry = {
  path: string;
  entryType: 'file' | 'directory';
};
const { t } = useI18n();
const message = ElMessage;
const sending = ref(false);
const switchingModel = ref(false);
const mention = ref<MentionState | null>(null);
const mentionIndex = ref(0);
const mentionAnchorRef = ref<HTMLElement | null>(null);
const mentionMenuStyle = ref<Record<string, string>>({});
const dragOver = ref(false);

const showPlaceholder = ref(true);
const editorRef = shallowRef<Editor | null>(null);
const mentionRef = shallowRef<MentionState | null>(null);
const mentionIndexRef = ref(0);
const filteredMentionEntriesRef = shallowRef<MentionEntry[]>([]);
const workspaceStore = useWorkspaceStore();
const agentStore = useAgentStore();
const chatReferenceStore = useChatReferenceStore();
const cottageServiceStore = useCottageServiceStore();
const { snapshot, selectedPath, activeWorkspaceId } = storeToRefs(workspaceStore);
const { pendingReferences } = storeToRefs(chatReferenceStore);
const { secrets: secretsRef, secretsVersion } = storeToRefs(agentStore);
const { planMode } = storeToRefs(agentStore);
const { status: cottageStatus, capabilities: cottageCapabilities } =
  storeToRefs(cottageServiceStore);

const cottageAvailability = computed(() => ({
  connected: cottageStatus.value === 'connected',
  capabilities: cottageCapabilities.value,
}));

/** 工具分组是否满足 Cottage Service 依赖（无依赖则恒为 true） */
function isToolGroupCottageReady(groupId: OptionalToolGroupId): boolean {
  const pack = builtinPackByGroupId(groupId);
  if (!pack) return true;
  return isBuiltinPackAvailable(pack, cottageAvailability.value);
}

function canToggleToolGroup(groupId: OptionalToolGroupId): boolean {
  if (props.disabled || props.busy) return false;
  return isToolGroupCottageReady(groupId);
}

function isToolGroupEffectivelyEnabled(groupId: OptionalToolGroupId): boolean {
  return (
    props.enabledToolGroups.includes(groupId) && isToolGroupCottageReady(groupId)
  );
}

function handleToggleToolGroup(groupId: OptionalToolGroupId, enabled: boolean) {
  if (!isToolGroupCottageReady(groupId)) {
    message.warning(t('settings.packRequiresCottageService'));
    return;
  }
  emit('toggleToolGroup', groupId, enabled);
}

/** 切换对话 / 计划模式（热切换后续回合配置，对话进行中禁用） */
function handleSetMode(mode: 'chat' | 'plan') {
  if (planMode.value === (mode === 'plan')) return;
  if (props.busy) {
    message.warning(t('chat.modeSwitchBusy'));
    return;
  }
  void agentStore.setChatMode(mode).catch((error) => {
    message.warning(error instanceof Error ? error.message : String(error));
  });
}
const config = computed(() => {
  void configRevision.value;
  return getCottageConfig();
});

/** 过滤掉在设置页面被禁用的内置能力包对应的工具分组 */
const visibleToolGroups = computed(() => {
  const disabledIds = new Set(config.value.packs?.disabledBuiltinPacks ?? []);
  // 构建 groupId → packId 映射
  const groupIdToPackId = new Map<string, string>();
  for (const pack of BUILTIN_PACKS) {
    groupIdToPackId.set(pack.groupId, pack.id);
  }
  return OPTIONAL_TOOL_GROUPS.filter((group) => {
    const packId = groupIdToPackId.get(group.id);
    if (!packId) return true; // 没有对应内置包的分组始终展示
    return !disabledIds.has(packId);
  });
});

/** 搜索来源显示名；第三方优先展示已选 provider 名 */
function searchSourceLabel(source: SearchSource): string {
  if (source === 'native') return t('chat.searchSourceNative');
  if (source === 'cottageService') return t('chat.searchSourceCottage');
  const provider = config.value.webSearch?.thirdPartyProvider;
  return provider
    ? t('chat.searchSourceThirdPartyNamed', { name: provider })
    : t('chat.searchSourceThirdParty');
}
const presetOptions = ref<Array<{ value: string; label: string }>>([]);
const activePresetValue = ref<string | null>(null);
const imagePresetOptions = ref<Array<{ value: string; label: string }>>([]);
const activeImagePresetValue = ref<string | null>(null);

const imageGenerationEnabled = computed(() =>
  isToolGroupEffectivelyEnabled('imagegen'),
);

function resolveLayerActivePresetId(
  layerConfig: CottageConfig | null | undefined,
  presets: ModelPreset[],
): string | undefined {
  const activeId = layerConfig?.activePresetId;
  if (activeId && presets.some((p) => p.id === activeId)) return activeId;
  return presets[0]?.id;
}

async function reloadLayeredPresetOptions() {
  const layered = await loadLayeredCottageConfigWithOptions({ syncStore: false });
  const domainPresets = layered.layers.domain?.modelPresets ?? [];
  let secrets = secretsRef.value ?? {};
  if (secretsVersion.value === 0) {
    secrets = await loadProviderSecrets();
  }
  // 输入框仅展示已配置 Key（或走免 Key 代理）的模型
  const selectable = domainPresets.filter((p) => presetHasApiKey(p, secrets));
  const options = selectable.map((p) => ({
    value: p.id,
    label: p.name || p.config.model,
  }));
  presetOptions.value = options;

  const domainActiveId = resolveLayerActivePresetId(
    layered.layers.domain,
    domainPresets,
  );
  const sessionId = getSessionActivePresetId();
  // 会话内的显式选择优先，不能被配置或密钥刷新时读取到的旧工作区偏好覆盖。
  if (sessionId && domainPresets.some((p) => p.id === sessionId)) {
    activePresetValue.value = sessionId;
    return;
  }

  // 新会话复用工作区上次成功切换的模型；它与 domain 默认模型相互独立。
  const workspaceLastId = getWorkspaceLastModelPresetId(activeWorkspaceId.value);
  if (workspaceLastId && options.some((opt) => opt.value === workspaceLastId)) {
    activePresetValue.value = workspaceLastId;
    setSessionActivePresetId(workspaceLastId);
    return;
  }
  const current = activePresetValue.value;
  if (current && options.some((opt) => opt.value === current)) {
    return;
  }

  // 默认模型是工作区偏好的兜底；若它已不完整，则使用第一个可用模型。
  const defaultId = config.value.activePresetId ?? domainActiveId;
  if (defaultId && options.some((opt) => opt.value === defaultId)) {
    activePresetValue.value = defaultId;
    return;
  }
  activePresetValue.value = options[0]?.value ?? null;
}

async function reloadImagePresetOptions() {
  const presets = config.value.imageGen?.modelPresets ?? [];
  let secrets = secretsRef.value ?? {};
  if (secretsVersion.value === 0) {
    secrets = await loadProviderSecrets();
  }
  const selectable = presets.filter((preset) =>
    providerConnectionExists(preset.provider, preset.connectionId, secrets) &&
    Boolean(getSecretForProvider(secrets, preset.provider, preset.connectionId)?.apiKey?.trim()),
  );
  imagePresetOptions.value = selectable.map((preset) => ({
    value: preset.id,
    label: preset.name || preset.model,
  }));

  const workspaceLastId = getWorkspaceLastImageModelPresetId(activeWorkspaceId.value);
  const sessionId = getSessionActiveImagePresetId();
  const defaultId = config.value.imageGen?.activePresetId;
  const nextId = [workspaceLastId, sessionId, defaultId, selectable[0]?.id]
    .find((id) => id && selectable.some((preset) => preset.id === id));
  activeImagePresetValue.value = nextId ?? null;
  if (nextId) setSessionActiveImagePresetId(nextId);
}

const hasModelConfigured = computed(() => {
  return props.setupState === 'ok' || presetOptions.value.length > 0;
});
const activePresetConfig = computed(() => {
  void configRevision.value;
  return getActiveModelPreset() ?? null;
});
const hasApiKeyConfigured = computed(() => {
  void secretsVersion.value;
  void configRevision.value;
  if (props.setupState) return props.setupState !== 'missing-key';
  if (!hasModelConfigured.value) return true;
  const preset = activePresetConfig.value;
  const cfg = preset?.config ?? getLlmConfig();
  if (!cfg) return true;
  return Boolean(resolveActiveApiKey(cfg, preset?.id, secretsRef.value ?? {}));
});
const configurationIssue = computed<'no-model' | 'missing-key' | null>(() => {
  if (props.setupState === 'ok') return null;
  if (props.setupState) return props.setupState;
  if (!hasModelConfigured.value) return 'no-model';
  if (!hasApiKeyConfigured.value) return 'missing-key';
  return null;
});
const activeModelLabel = computed(() => {
  const val = activePresetValue.value;
  if (!val) return '';
  const fromOptions = presetOptions.value.find((opt) => opt.value === val)?.label;
  if (fromOptions) return fromOptions;
  return (
    activePresetConfig.value?.name ||
    activePresetConfig.value?.config.model ||
    ''
  );
});

/** 当前模型目录元数据（用于思考开关等能力判定） */
const activeModelMeta = ref<LlmModelOption | null>(null);
const loadingModelMeta = ref(false);

const activeModelCapabilities = computed(() => {
  const config = activePresetConfig.value?.config ?? getLlmConfig();
  return config
    ? resolveCottageModelCapabilities(config, activeModelMeta.value)
    : null;
});

const supportsThinkingControl = computed(() =>
  activeModelCapabilities.value
    ? modelSupportsThinkingControl(activeModelCapabilities.value)
    : false,
);
const reasoningEffortValues = computed(
  () => activeModelCapabilities.value?.reasoningEffortValues ?? [],
);
const supportsReasoningEffort = computed(
  () => reasoningEffortValues.value.length > 0,
);
const thinkingEnabled = computed(
  () => activePresetConfig.value?.config.thinkingEnabled !== false,
);
const reasoningEffort = computed(
  () => activePresetConfig.value?.config.reasoningEffort ?? null,
);
const reasoningEffortOptions = computed<SelectOption[]>(() =>
  reasoningEffortValues.value
    .filter((v) => v !== 'none')
    .map((value) => ({
      value,
      label: t(`settings.reasoningEffortLevel.${value}`),
    })),
);

/** vision 功能开关（配置层） */
const visionFeatureOn = computed(() => {
  void configRevision.value;
  return isVisionEnabled();
});
/** 能力门控开启且当前模型未明确声明支持图片输入 */
const modelLacksVision = computed(() => {
  void configRevision.value;
  if (getCottageConfig().vision?.requireModelCapability === false) return false;
  return !activeModelCapabilities.value ||
    !supportsVisionInput(activeModelCapabilities.value);
});
const visionEnabled = computed(
  () => visionFeatureOn.value && !modelLacksVision.value,
);

// ─── 图片附件（手动上传 / 图片链接） ──────────────────────────────────────
const imageFileInputRef = ref<HTMLInputElement | null>(null);
const imageUrlDialogVisible = ref(false);
const imageUrlInput = ref('');
const imageUrlImporting = ref(false);

function handleImageMenuCommand(cmd: string | number | object) {
  if (modelLacksVision.value) {
    message.warning(t('chat.visionModelUnsupported'));
    return;
  }
  if (cmd === 'upload') {
    imageFileInputRef.value?.click();
  } else if (cmd === 'url') {
    imageUrlInput.value = '';
    imageUrlDialogVisible.value = true;
  }
}

async function handleImageFilesSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []).filter((f) =>
    f.type.startsWith('image/'),
  );
  input.value = '';
  if (!files.length) return;
  if (modelLacksVision.value) {
    message.warning(t('chat.visionModelUnsupported'));
    return;
  }
  const newAttachments = await Promise.all(files.map(fileToAttachment));
  emit('addAttachments', newAttachments);
}

async function handleImportImageUrls() {
  if (modelLacksVision.value) {
    message.warning(t('chat.visionModelUnsupported'));
    return;
  }
  const urls = imageUrlInput.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!urls.length) return;
  imageUrlImporting.value = true;
  try {
    const imported: ChatAttachment[] = [];
    for (const url of urls) {
      try {
        imported.push(
          await importImageFromUrl(url, {
            serviceBaseUrl: cottageServiceStore.connectedBaseUrl,
          }),
        );
      } catch (error) {
        if (
          error instanceof ImageUrlImportError &&
          error.reason === 'cors_no_service'
        ) {
          message.error(t('chat.imageUrlCorsNoService'));
        } else {
          message.error(
            t('chat.imageUrlImportFailed', {
              detail: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
    }
    if (imported.length) {
      emit('addAttachments', imported);
      imageUrlDialogVisible.value = false;
    }
  } finally {
    imageUrlImporting.value = false;
  }
}

let modelMetaRequestId = 0;

async function refreshActiveModelMeta() {
  const requestId = ++modelMetaRequestId;
  const preset = activePresetConfig.value;
  if (!preset) {
    activeModelMeta.value = null;
    loadingModelMeta.value = false;
    return;
  }
  const { provider, model } = preset.config;
  const cached = getCachedProviderModels(provider, true, preset.config.baseUrl);
  const fromCache = cached?.find((m) => m.id === model) ?? null;
  // 切换模型后先清空上一模型的能力，目录未就绪时按保守策略禁用图片。
  activeModelMeta.value = fromCache;

  loadingModelMeta.value = true;
  try {
    const secrets = await loadProviderSecrets();
    const presetSecret = secrets.presetApiKeys?.[preset.id];
    const globalSecret = secrets[provider];
    const result = await fetchProviderModels({
      providerId: provider,
      apiKey:
        preset.config.apiKey ||
        presetSecret?.apiKey ||
        globalSecret?.apiKey ||
        undefined,
      configBaseUrl: preset.config.baseUrl,
      secretBaseUrl: presetSecret?.baseUrl || globalSecret?.baseUrl,
    });
    if (requestId === modelMetaRequestId) {
      activeModelMeta.value =
        result.models.find((m) => m.id === model) ?? fromCache;
    }
  } catch {
    if (requestId === modelMetaRequestId && !activeModelMeta.value) {
      activeModelMeta.value = fromCache;
    }
  } finally {
    if (requestId === modelMetaRequestId) loadingModelMeta.value = false;
  }
}

watch(
  () =>
    [
      activePresetConfig.value?.id,
      activePresetConfig.value?.config.model,
      activePresetConfig.value?.config.provider,
      configRevision.value,
    ] as const,
  () => {
    void refreshActiveModelMeta();
  },
  { immediate: true },
);

async function persistActivePresetConfigPatch(
  patch: Partial<
    Pick<LlmModelConfig, 'thinkingEnabled' | 'reasoningEffort'>
  >,
) {
  const preset = activePresetConfig.value;
  if (!preset) return;
  if (props.busy || switchingModel.value) {
    message.warning(t('chat.switchModelBusy'));
    return;
  }

  const layered = await loadLayeredCottageConfigWithOptions({ syncStore: false });
  const domainPresets = layered.layers.domain?.modelPresets ?? [];
  if (!domainPresets.some((p) => p.id === preset.id)) {
    message.error(t('chat.thinkingUpdateFailed'));
    return;
  }

  const nextPresets: ModelPreset[] = domainPresets.map((p) => {
    if (p.id !== preset.id) return p;
    const nextConfig: LlmModelConfig = {
      ...p.config,
      ...patch,
    };
    if (patch.thinkingEnabled === false) {
      // 关闭思考时清掉 effort，避免下次开启残留无效档
      delete nextConfig.reasoningEffort;
    } else if (
      patch.thinkingEnabled === true &&
      !nextConfig.reasoningEffort &&
      supportsReasoningEffort.value
    ) {
      nextConfig.reasoningEffort = pickDefaultReasoningEffort(
        reasoningEffortValues.value,
      );
    }
    return { ...p, config: nextConfig };
  });
  const nextActive = nextPresets.find((p) => p.id === preset.id);
  // 只更新预设内容，保留 domain 层默认模型，避免右下角当前选择写回「设置默认」
  const domainActiveId = layered.layers.domain?.activePresetId;
  const preservedDefaultId =
    domainActiveId && nextPresets.some((p) => p.id === domainActiveId)
      ? domainActiveId
      : nextPresets[0]?.id;
  const defaultPreset = nextPresets.find((p) => p.id === preservedDefaultId);
  await saveLayeredCottageConfig(
    {
      modelPresets: nextPresets,
      activePresetId: preservedDefaultId,
      llm: defaultPreset?.config,
    },
    { level: 'domain' },
  );
  // 若改的是当前会话模型，确保会话选择仍指向它（热重载后生效）
  if (nextActive) {
    setSessionActivePresetId(nextActive.id);
  }
  await agentStore.reloadSecrets({ remount: true, hot: true });
}

async function handleToggleThinking(enabled: boolean) {
  try {
    await persistActivePresetConfigPatch({ thinkingEnabled: enabled });
    message.success(
      enabled ? t('chat.thinkingEnabledToast') : t('chat.thinkingDisabledToast'),
    );
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function handleReasoningEffortChange(
  value: string | number | null | undefined,
) {
  const effort = typeof value === 'string' && value.trim() ? value.trim() : null;
  try {
    await persistActivePresetConfigPatch({
      thinkingEnabled: true,
      reasoningEffort: effort || undefined,
    });
    message.success(t('chat.reasoningEffortUpdated'));
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

const placeholder = computed(() => {
  if (props.taskRunning) return t('chat.placeholderTaskRunning');
  return t('chat.placeholder');
});
const contextTokensText = computed(() => {
  const n = props.contextTokens;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
});
const contextWindowText = computed(() => {
  const n = props.contextWindow;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
});
const CONTEXT_RING_RADIUS = 9;
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;
const contextRingOffset = computed(() => {
  const pct = Math.min(Math.max(props.contextTokensPercent, 0), 100);
  return CONTEXT_RING_CIRCUMFERENCE * (1 - pct / 100);
});
const contextRingClass = computed(() => {
  if (props.contextTokensPercent >= 90) return 'chat-context-ring--high';
  if (props.contextTokensPercent >= 70) return 'chat-context-ring--medium';
  return '';
});
const contextTooltipText = computed(() => {
  return (
    t('chat.contextTokens', {
      used: contextTokensText.value,
      window: contextWindowText.value,
      percent: props.contextTokensPercent,
    }) + (props.contextTokensCalibrated ? '' : t('chat.contextEstimated'))
  );
});
function collectDirectoryPaths(nodes: WorkspaceFileNode[] | undefined): string[] {
  if (!nodes?.length) return [];
  const dirs: string[] = [];
  const walk = (items: WorkspaceFileNode[]) => {
    for (const node of items) {
      if (!node.isLeaf) {
        dirs.push(node.key);
        walk(node.children ?? []);
      }
    }
  };
  walk(nodes);
  return dirs;
}
const workspaceMentionEntries = computed<MentionEntry[]>(() => {
  const files = (snapshot.value?.files ?? []).map((path) => ({
    path,
    entryType: 'file' as const,
  }));
  // snapshot.directories 已是扁平目录路径数组，等价于递归 tree 收集的结果，
  // 避免在 computed 里每次递归整棵树
  const dirs = (snapshot.value?.directories ?? collectDirectoryPaths(snapshot.value?.tree)).map((path) => ({
    path,
    entryType: 'directory' as const,
  }));
  return [...files, ...dirs];
});
const filteredMentionEntries = computed(() => {
  const q = (mention.value?.query ?? '').trim().toLowerCase();
  const sorted = [...workspaceMentionEntries.value].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  if (!q) return sorted.slice(0, 12);
  return sorted
    .filter((entry) => entry.path.toLowerCase().includes(q))
    .slice(0, 12);
});
watch(mention, (m) => {
  mentionRef.value = m;
  if (m) {
    void nextTick(updateMentionMenuPosition);
  } else {
    mentionMenuStyle.value = {};
  }
});
watch(mentionIndex, (i) => {
  mentionIndexRef.value = i;
});
watch(filteredMentionEntries, (entries) => {
  filteredMentionEntriesRef.value = entries;
}, { immediate: true });
function syncMention(ed: Editor) {
  mention.value = findMentionAtCursor(ed);
  mentionIndex.value = 0;
}

function updateMentionMenuPosition() {
  const anchor = mentionAnchorRef.value;
  if (!mention.value || !anchor) return;

  const rect = anchor.getBoundingClientRect();
  const viewportPadding = 8;
  const gap = 4;
  const availableAbove = Math.max(0, rect.top - gap - viewportPadding);
  const availableBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPadding);
  const placeBelow = availableBelow > availableAbove;
  const left = Math.max(
    viewportPadding,
    Math.min(rect.left, window.innerWidth - viewportPadding),
  );
  const width = Math.max(0, Math.min(rect.width, window.innerWidth - left - viewportPadding));

  mentionMenuStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    right: 'auto',
    width: `${width}px`,
    maxHeight: `${Math.min(220, placeBelow ? availableBelow : availableAbove)}px`,
    margin: '0',
    zIndex: '1000',
    ...(placeBelow
      ? { top: `${rect.bottom + gap}px`, bottom: 'auto' }
      : { top: 'auto', bottom: `${window.innerHeight - rect.top + gap}px` }),
  };
}

function handleMentionViewportChange() {
  if (mention.value) updateMentionMenuPosition();
}
function findMentionAtCursor(editor: Editor): MentionState | null {
  const { from } = editor.state.selection;
  const textBefore = editor.state.doc.textBetween(0, from, '\n');
  const atIndex = textBefore.lastIndexOf('@');
  if (atIndex < 0) return null;
  const query = textBefore.slice(atIndex + 1);
  if (/[\s\n]/.test(query)) return null;
  let textOffset = 0;
  let mentionStart: number | null = null;
  editor.state.doc.nodesBetween(0, from, (node, pos) => {
    if (mentionStart !== null) return false;
    if (node.isText && node.text) {
      const nodeStartOffset = textOffset;
      const nodeEndOffset = textOffset + node.text.length;
      if (nodeStartOffset <= atIndex && atIndex < nodeEndOffset) {
        mentionStart = pos + (atIndex - nodeStartOffset);
        return false;
      }
      textOffset += node.text.length;
    }
  });
  if (mentionStart === null) return null;
  return { start: mentionStart, end: from, query };
}
function applyMentionSelection(entry: MentionEntry) {
  const ed = editorRef.value;
  const m = mentionRef.value;
  if (!ed || !m) return;
  const path = entry.path;
  const label = formatReferenceLabel({ id: '', path, entryType: entry.entryType });
  const refId = newReferenceId();
  // 不依赖光标位置：从 @ 起尽可能吞掉与所选路径匹配的前缀，避免胶囊夹在路径中间
  const textAfterAt = ed.state.doc.textBetween(
    m.start + 1,
    ed.state.doc.content.size,
    '\n',
  );
  let matched = 0;
  while (
    matched < path.length &&
    matched < textAfterAt.length &&
    path[matched] === textAfterAt[matched]
  ) {
    matched += 1;
  }
  // 至少覆盖 @query（到光标）；若路径在光标后还有续写则继续吞掉
  const replaceTo = Math.max(m.end, m.start + 1 + matched);
  ed.chain()
    .focus()
    .deleteRange({ from: m.start, to: replaceTo })
    .run();
  insertFileReferenceNode(
    ed,
    {
      id: refId,
      path,
      label,
      entryType: entry.entryType,
      anchor: null,
    },
    { fallback: 'selection' },
  );
  chatReferenceStore.addReference({ path, entryType: entry.entryType });
  mention.value = null;
}
async function send() {
  const ed = editorRef.value;
  if (props.busy || switchingModel.value || !ed) return;
  if (configurationIssue.value === 'no-model') {
    message.warning(t('chat.needModelToast'));
    return;
  }
  if (configurationIssue.value === 'missing-key') {
    message.warning(t('chat.needApiKeyToast'));
    emit('openSettings');
    return;
  }
  const { text, refs: editorRefs } = extractMessageFromEditor(ed);
  const trimmed = text.trim();
  const allRefs = [...pendingReferences.value, ...editorRefs];
  const seen = new Set<string>();
  const uniqueRefs = allRefs.filter((r) => {
    const key = `${r.path}\0${r.entryType ?? 'file'}\0${JSON.stringify(r.anchor ?? '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!trimmed && !uniqueRefs.length && !selectedPath.value && !props.attachments.length) return;
  if (props.attachments.length && modelLacksVision.value) {
    message.warning(t('chat.visionModelUnsupported'));
    return;
  }
  sending.value = true;
  try {
    const composed = await composeUserMessage(
      trimmed,
      uniqueRefs,
      async (path) => {
        const { content } = await workspace.readFile(path);
        return content;
      },
      {
        activeFilePath: selectedPath.value,
        listFilesUnderPath: (path) => workspace.listFiles(path),
      },
    );
    if (!composed.llmContent.trim() && !props.attachments.length) return;
    const presetId = activePresetConfig.value?.id;
    if (presetId) {
      setWorkspaceLastModelPresetId(activeWorkspaceId.value, presetId);
    }
    setActiveChatReferencesForSend(uniqueRefs);
    ed.commands.clearContent();
    chatReferenceStore.clearReferences();
    mention.value = null;
    emit(
      'send',
      props.attachments.length
        ? { ...composed, attachments: [...props.attachments] }
        : composed,
    );
  } finally {
    sending.value = false;
  }
}
const editor = useEditor({
  extensions: chatEditorExtensions,
  autofocus: false,
  editorProps: {
    handleKeyDown(_view, event) {
      const m = mentionRef.value;
      const entries = filteredMentionEntriesRef.value;
      const idx = mentionIndexRef.value;
      if (m && entries.length) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          mentionIndex.value = Math.min(idx + 1, entries.length - 1);
          return true;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          mentionIndex.value = Math.max(idx - 1, 0);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          const entry = entries[idx];
          if (entry) applyMentionSelection(entry);
          return true;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          mention.value = null;
          return true;
        }
      }
      if (!event.shiftKey && event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        void send();
        return true;
      }
      return false;
    },
  },
  onUpdate: ({ editor: ed }) => {
    syncMention(ed);
    updatePlaceholder(ed);
  },
  onSelectionUpdate: ({ editor: ed }) => {
    syncMention(ed);
  },
});
function updatePlaceholder(ed: Editor) {
  showPlaceholder.value = ed.isEmpty;
}
watch(
  editor,
  (ed) => {
    editorRef.value = ed ?? null;
    if (ed) updatePlaceholder(ed);
  },
  { immediate: true },
);
watch(
  () => [props.disabled, sending.value, configurationIssue.value] as const,
  ([disabled, isSending, issue]) => {
    editor.value?.setEditable(!disabled && !isSending && !issue);
  },
  { immediate: true },
);
onMounted(() => {
  chatReferenceStore.registerFocusComposer(() => {
    editorRef.value?.commands.focus('end');
  });
  window.addEventListener('resize', handleMentionViewportChange);
  window.addEventListener('scroll', handleMentionViewportChange, true);
});
onBeforeUnmount(() => {
  chatReferenceStore.registerFocusComposer(null);
  window.removeEventListener('resize', handleMentionViewportChange);
  window.removeEventListener('scroll', handleMentionViewportChange, true);
});
watch(
  () => [editor.value, pendingReferences.value] as const,
  ([ed, refs]) => {
    if (!ed || !refs.length) return;
    const existingPaths = new Set<string>();
    ed.state.doc.descendants((node) => {
      if (node.type.name === 'fileReference') {
        existingPaths.add(node.attrs.path);
      }
    });
    const toInsert = refs.filter((r) => !existingPaths.has(r.path));
    if (!toInsert.length) return;
    for (const ref of toInsert) {
      insertFileReferenceNode(
        ed,
        {
          id: ref.id,
          path: ref.path,
          label: formatReferenceLabel(ref),
          entryType: ref.entryType ?? 'file',
          anchor: ref.anchor ?? null,
        },
        { fallback: 'end' },
      );
    }
  },
  { deep: true },
);
watch(
  activeWorkspaceId,
  () => {
    // A page-level selection must not leak into another workspace.
    clearSessionActivePresetId();
    clearSessionActiveImagePresetId();
    void reloadLayeredPresetOptions();
    void reloadImagePresetOptions();
  },
);
watch(
  () => [configRevision.value, secretsVersion.value] as const,
  () => {
    void reloadLayeredPresetOptions();
    void reloadImagePresetOptions();
  },
  { immediate: true },
);
async function handleSwitchPreset(
  presetValue: string | number | null | undefined,
) {
  if (!presetValue || typeof presetValue !== 'string') return;
  if (props.busy || switchingModel.value) {
    message.warning(t('chat.switchModelBusy'));
    void reloadLayeredPresetOptions();
    return;
  }
  const presetId = presetValue;
  if (presetId === getSessionActivePresetId()) return;
  const previousPresetId = getSessionActivePresetId();
  const previousPresetValue = activePresetValue.value;
  switchingModel.value = true;
  activePresetValue.value = presetId;
  // 仅切换本页会话模型，不改设置里的默认模型
  setSessionActivePresetId(presetId);
  try {
    await agentStore.reloadSecrets({ remount: true, hot: true });
    setWorkspaceLastModelPresetId(activeWorkspaceId.value, presetId);
    message.success(t('chat.modelSwitched'));
  } catch (error) {
    // applyRuntime 在最后一步原子替换 driver；失败时恢复到仍在运行的旧模型。
    setSessionActivePresetId(previousPresetId ?? previousPresetValue ?? undefined);
    activePresetValue.value = previousPresetValue;
    message.error(error instanceof Error ? error.message : String(error));
    await reloadLayeredPresetOptions();
  } finally {
    switchingModel.value = false;
  }
}

function handleSwitchImagePreset(presetValue: string | number | null | undefined) {
  if (!presetValue || typeof presetValue !== 'string') return;
  if (props.busy || switchingModel.value) {
    message.warning(t('chat.switchModelBusy'));
    return;
  }
  activeImagePresetValue.value = presetValue;
  setSessionActiveImagePresetId(presetValue);
  setWorkspaceLastImageModelPresetId(activeWorkspaceId.value, presetValue);
  message.success(t('chat.imageModelSwitched'));
}
async function handleDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  if (props.disabled || !editorRef.value) return;
  if (visionFeatureOn.value) {
    const imageFiles = extractImagesFromDrop(e.dataTransfer!);
    if (imageFiles.length) {
      if (modelLacksVision.value) {
        message.warning(t('chat.visionModelUnsupported'));
        return;
      }
      const newAttachments = await Promise.all(imageFiles.map(fileToAttachment));
      emit('addAttachments', newAttachments);
      return;
    }
  }
  const path =
    e.dataTransfer?.getData(COTTAGE_FILE_DRAG_TYPE) ||
    e.dataTransfer?.getData('text/plain');
  if (!path || path.includes('\n')) return;
  const trimmedPath = path.trim();
  const coords = editorRef.value.view.posAtCoords({
    left: e.clientX,
    top: e.clientY,
  });
  const pos = coords?.pos ?? editorRef.value.state.selection.from;
  const refId = newReferenceId();
  // 若正文已有该路径，整段换成胶囊；否则插到落点（避免夹在路径中间）
  insertFileReferenceNode(
    editorRef.value,
    {
      id: refId,
      path: trimmedPath,
      entryType: 'file',
      anchor: null,
    },
    { at: pos },
  );
  chatReferenceStore.addReference({ path: trimmedPath, entryType: 'file' });
  chatReferenceStore.focusComposer();
}
async function handlePaste(e: ClipboardEvent) {
  if (!visionFeatureOn.value || props.disabled) return;
  const imageFiles = extractImagesFromClipboard(e.clipboardData!);
  if (imageFiles.length) {
    e.preventDefault();
    if (modelLacksVision.value) {
      message.warning(t('chat.visionModelUnsupported'));
      return;
    }
    const newAttachments = await Promise.all(imageFiles.map(fileToAttachment));
    emit('addAttachments', newAttachments);
  }
}
function handleDragOver(e: DragEvent) {
  if (props.disabled) return;
  if (
    e.dataTransfer?.types.includes(COTTAGE_FILE_DRAG_TYPE) ||
    e.dataTransfer?.types.includes('text/plain')
  ) {
    e.preventDefault();
    dragOver.value = true;
  }
}
const editorHasContent = computed(() => editor.value ? !editor.value.isEmpty : false);
const canSend = computed(
  () =>
    !configurationIssue.value &&
    !props.disabled &&
    !sending.value &&
    !switchingModel.value &&
    (editorHasContent.value ||
      pendingReferences.value.length > 0 ||
      props.attachments.length > 0 ||
      Boolean(selectedPath.value)),
);
</script>
<template>
  <div
    :class="dragOver ? 'chat-input chat-input-drag-over' : 'chat-input'"
    @dragover="handleDragOver"
    @dragleave="dragOver = false"
    @drop="handleDrop"
    @paste="handlePaste"
  >
    <div class="chat-composer-main">
      <div v-if="attachments.length > 0" class="chat-attachment-thumbnails">
        <div v-for="att in attachments" :key="att.id" class="chat-attachment-thumb">
          <img
            :src="att.data"
            :alt="att.filename"
            style="width: 48px; height: 48px; object-fit: cover; border-radius: var(--cottage-radius-control)"
          />
          <CottageTooltip :content="t('common.remove')" placement="top">
            <button
              class="chat-attachment-remove"
              type="button"
              @click="emit('removeAttachment', att.id)"
            >
              <NIcon :component="CloseOutline" :size="10" />
            </button>
          </CottageTooltip>
        </div>
      </div>
      <div ref="mentionAnchorRef" class="chat-composer-input-wrap">
        <ComposerAttachBanner
          v-if="configurationIssue"
          :tone="configurationIssue === 'missing-key' ? 'warning' : 'primary'"
        >
          <template #icon>
            <NIcon :component="KeyOutline" />
          </template>
          <span class="chat-composer-setup-copy">
            <strong>{{ t('chat.setupGuideTitle') }}</strong>
            <span>{{ configurationIssue === 'missing-key' ? t('chat.setupGuideNoKey') : t('chat.setupGuideNoModel') }}</span>
          </span>
          <template #action>
            <ElButton
              class="chat-composer-setup-action"
              type="primary"
              @click="emit('openSettings')"
            >
              {{ t('chat.setupGuideAction') }}
            </ElButton>
          </template>
        </ComposerAttachBanner>
        <ComposerAttachBanner v-else-if="mounting" tone="neutral">
          <template #icon>
            <NSpin size="small" />
          </template>
          {{ t('chat.chatInitializing') }}
        </ComposerAttachBanner>
        <ComposerAttachBanner v-else-if="notReady" tone="warning">
          <template #icon>
            <NIcon :component="RefreshOutline" />
          </template>
          <span class="chat-composer-not-ready-text">
            <strong>{{ t('chat.agentNotReadyTitle') }}</strong>
            {{ notReadyMessage || t('chat.agentNotReadyBody') }}
          </span>
          <template #action>
            <ElButton
              size="small"
              type="primary"
              :loading="mountRetrying"
              @click="emit('retryMount')"
            >
              {{ t('chat.retryMount') }}
            </ElButton>
          </template>
        </ComposerAttachBanner>
        <Teleport to="body">
          <FileMentionMenu
            v-if="mention"
            :entries="filteredMentionEntries"
            :active-index="mentionIndex"
            :menu-style="mentionMenuStyle"
            @select="applyMentionSelection"
            @hover-index="mentionIndex = $event"
          />
        </Teleport>
        <div
          class="chat-composer-input-box"
          :class="{
            'is-disabled':
              disabled ||
              configurationIssue ||
              mounting ||
              notReady,
          }"
        >
          <div class="chat-composer-editor-wrap">
            <ChatEditor :editor="editor" class-name="chat-composer-editor" />
            <div v-if="showPlaceholder" class="chat-composer-placeholder">
              {{ placeholder }}
            </div>
          </div>
          <div class="chat-composer-toolbar">
            <CottageTooltip :content="t('chat.modeSwitchHint')" placement="top" delay="normal">
              <ElDropdown
                trigger="click"
                :disabled="disabled || busy"
                @command="(cmd) => handleSetMode(String(cmd) as 'chat' | 'plan')"
              >
                <ElButton
                  class="chat-mode-trigger"
                  text
                  :disabled="disabled || busy"
                >
                  <span class="chat-mode-trigger-label">
                    {{ planMode ? t('chat.modeSpec') : t('chat.modeChat') }}
                  </span>
                  <NIcon
                    :component="ChevronDownOutline"
                    class="chat-mode-trigger-caret"
                  />
                </ElButton>
                <template #dropdown>
                  <ElDropdownMenu>
                    <ElDropdownItem
                      command="chat"
                      :disabled="!planMode"
                    >
                      {{ t('chat.modeChat') }}
                    </ElDropdownItem>
                    <ElDropdownItem
                      command="plan"
                      :disabled="planMode"
                    >
                      {{ t('chat.modeSpec') }}
                    </ElDropdownItem>
                  </ElDropdownMenu>
                </template>
              </ElDropdown>
            </CottageTooltip>
            <CottageTooltip
              v-if="visionEnabled"
              :content="t('chat.addImage')"
              placement="top"
              delay="normal"
            >
              <ElDropdown
                trigger="click"
                :disabled="disabled || busy"
                @command="handleImageMenuCommand"
              >
                <ElButton
                  class="chat-composer-image-trigger"
                  text
                  :disabled="disabled || busy"
                >
                  <NIcon :component="ImageOutline" />
                </ElButton>
                <template #dropdown>
                  <ElDropdownMenu>
                    <ElDropdownItem command="upload">
                      {{ t('chat.uploadImage') }}
                    </ElDropdownItem>
                    <ElDropdownItem command="url">
                      {{ t('chat.imageUrlMenu') }}
                    </ElDropdownItem>
                  </ElDropdownMenu>
                </template>
              </ElDropdown>
            </CottageTooltip>
            <input
              ref="imageFileInputRef"
              type="file"
              accept="image/*"
              multiple
              style="display: none"
              @change="handleImageFilesSelected"
            />
            <div class="chat-composer-toolbar-model">
              <ElPopover
                v-if="hasModelConfigured"
                trigger="click"
                placement="top-start"
                :width="320"
                popper-class="chat-model-cap-popper"
              >
                <template #reference>
                  <ElButton
                    class="chat-model-cap-trigger"
                    :disabled="disabled || switchingModel"
                    :loading="switchingModel"
                  >
                    <span class="chat-model-cap-trigger-label">
                      <NIcon
                        v-if="!hasApiKeyConfigured"
                        :component="KeyOutline"
                        class="chat-model-cap-key-warn"
                      />
                      <span class="chat-model-cap-trigger-name">
                        {{ activeModelLabel || t('chat.modelAndCapabilities') }}
                      </span>
                      <span
                        v-if="supportsThinkingControl && thinkingEnabled"
                        class="chat-model-cap-thinking-badge"
                      >{{ t('chat.thinkingOnBadge') }}</span>
                    </span>
                    <NIcon
                      :component="ChevronDownOutline"
                      class="chat-model-cap-trigger-caret"
                    />
                  </ElButton>
                </template>
                <div class="chat-model-cap-panel">
                  <div class="chat-model-cap-section">
                    <NText depth="3" class="chat-model-cap-section-title">{{ t('chat.modelSection') }}</NText>
                    <div
                      v-if="presetOptions.length > 0"
                      class="chat-model-cap-models"
                    >
                      <button
                        v-for="opt in presetOptions"
                        :key="opt.value"
                        type="button"
                        class="chat-model-cap-model-item"
                        :class="{
                          'is-active': activePresetValue === opt.value,
                        }"
                        :disabled="disabled || busy || switchingModel"
                        @click="handleSwitchPreset(opt.value)"
                      >
                        <span class="chat-model-cap-model-name">
                          {{ opt.label }}
                        </span>
                        <NIcon
                          v-if="activePresetValue === opt.value"
                          :component="CheckmarkOutline"
                          class="chat-model-cap-model-check"
                        />
                      </button>
                    </div>
                    <NText v-else depth="3" class="chat-optional-tools-hint">
                      {{ t('chat.manageModelsInSettings') }}
                    </NText>
                  </div>
                  <div
                    v-if="supportsThinkingControl"
                    class="chat-model-cap-section"
                  >
                    <NText depth="3" class="chat-model-cap-section-title">
                      {{ t('chat.thinkingSection') }}
                    </NText>
                    <div class="chat-thinking-row">
                      <span class="chat-thinking-label">{{ t('chat.thinkingToggle') }}</span>
                      <ElSwitch
                        :model-value="thinkingEnabled"
                        :disabled="disabled || busy || switchingModel || loadingModelMeta"
                        @change="(v) => void handleToggleThinking(Boolean(v))"
                      />
                    </div>
                    <div
                      v-if="thinkingEnabled && supportsReasoningEffort"
                      class="chat-thinking-effort"
                    >
                      <NText depth="3" class="chat-thinking-effort-label">
                        {{ t('settings.reasoningEffort') }}
                      </NText>
                      <CottageSelect
                        :model-value="reasoningEffort"
                        :options="reasoningEffortOptions"
                        :disabled="disabled || busy || switchingModel"
                        :placeholder="t('settings.reasoningEffortPlaceholder')"
                        @change="handleReasoningEffortChange"
                      />
                    </div>
                  </div>
                  <div
                    v-if="imageGenerationEnabled"
                    class="chat-model-cap-section"
                  >
                    <NText depth="3" class="chat-model-cap-section-title">
                      {{ t('chat.imageModelSection') }}
                    </NText>
                    <div
                      v-if="imagePresetOptions.length > 0"
                      class="chat-model-cap-models"
                    >
                      <button
                        v-for="opt in imagePresetOptions"
                        :key="opt.value"
                        type="button"
                        class="chat-model-cap-model-item"
                        :class="{ 'is-active': activeImagePresetValue === opt.value }"
                        :disabled="disabled || busy || switchingModel"
                        @click="handleSwitchImagePreset(opt.value)"
                      >
                        <span class="chat-model-cap-model-name">{{ opt.label }}</span>
                        <NIcon
                          v-if="activeImagePresetValue === opt.value"
                          :component="CheckmarkOutline"
                          class="chat-model-cap-model-check"
                        />
                      </button>
                    </div>
                    <NText v-else depth="3" class="chat-optional-tools-hint">
                      {{ t('chat.manageImageModelsInSettings') }}
                    </NText>
                  </div>
                  <div class="chat-model-cap-section">
                    <NText depth="3" class="chat-model-cap-section-title">{{ t('chat.capabilitiesSection') }}</NText>
                    <div class="chat-model-cap-cards">
                      <div
                        v-for="group in visibleToolGroups"
                        :key="group.id"
                        class="chat-model-cap-card-wrap"
                      >
                        <CottageTooltip
                          :content="
                            !isToolGroupCottageReady(group.id)
                              ? t('settings.packRequiresCottageService')
                              : t(`chat.toolGroupDesc.${group.id}`)
                          "
                          placement="top"
                          delay="normal"
                        >
                          <button
                            type="button"
                            class="chat-model-cap-card"
                            :class="{
                              'is-active': isToolGroupEffectivelyEnabled(group.id),
                            }"
                            :disabled="switchingModel || !canToggleToolGroup(group.id)"
                            @click="
                              handleToggleToolGroup(
                                group.id,
                                !isToolGroupEffectivelyEnabled(group.id),
                              )
                            "
                          >
                            <span class="chat-model-cap-card-name">
                              {{ t(`chat.toolGroup.${group.id}`) }}
                            </span>
                            <NIcon
                              v-if="isToolGroupEffectivelyEnabled(group.id)"
                              :component="CheckmarkOutline"
                              class="chat-model-cap-card-check"
                            />
                          </button>
                        </CottageTooltip>
                      </div>
                    </div>
                  </div>
                  <div class="chat-model-cap-section">
                    <NText depth="3" class="chat-model-cap-section-title">{{ t('chat.searchSourceSection') }}</NText>
                    <div
                      v-if="availableSearchSources.length > 0"
                      class="chat-model-cap-models"
                    >
                      <button
                        v-for="source in availableSearchSources"
                        :key="source"
                        type="button"
                        class="chat-model-cap-model-item"
                        :class="{ 'is-active': searchSource === source }"
                        :disabled="disabled || busy || switchingModel"
                        @click="emit('setSearchSource', source)"
                      >
                        <span class="chat-model-cap-model-name">
                          {{ searchSourceLabel(source) }}
                        </span>
                        <NIcon
                          v-if="searchSource === source"
                          :component="CheckmarkOutline"
                          class="chat-model-cap-model-check"
                        />
                      </button>
                    </div>
                    <NText v-else depth="3" class="chat-optional-tools-hint">
                      {{ t('chat.noSearchSourceHint') }}
                    </NText>
                  </div>
                </div>
              </ElPopover>
              <CottageTooltip
                v-else
                :content="t('chat.placeholderNeedModel')"
                placement="top"
                delay="instant"
              >
                <NText
                  depth="3"
                  class="chat-model-unconfigured"
                >
                  {{ t('chat.setupModelFirst') }}
                </NText>
              </CottageTooltip>
            </div>
            <CottageTooltip
              v-if="contextTokens > 0"
              placement="top"
              :content="contextTooltipText"
              delay="instant"
            >
              <div
                class="chat-context-ring"
                :class="contextRingClass"
                role="progressbar"
                :aria-valuenow="contextTokensPercent"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle class="chat-context-ring-track" cx="12" cy="12" :r="CONTEXT_RING_RADIUS" />
                  <circle
                    class="chat-context-ring-fill"
                    cx="12"
                    cy="12"
                    :r="CONTEXT_RING_RADIUS"
                    :stroke-dasharray="CONTEXT_RING_CIRCUMFERENCE"
                    :stroke-dashoffset="contextRingOffset"
                  />
                </svg>
              </div>
            </CottageTooltip>
            <ElButton
              type="primary"
              class="chat-composer-send"
              :disabled="disabled || (!busy && !canSend)"
              :loading="(sending || switchingModel) && !busy"
              @click="busy ? emit('stop') : send()"
            >
              <template #icon>
                <NIcon :component="busy ? PauseCircleOutline : SendOutline" />
              </template>
              {{ busy ? t('chat.stop') : t('chat.send') }}
            </ElButton>
          </div>
        </div>
      </div>
    </div>
    <ElDialog
      v-model="imageUrlDialogVisible"
      :title="t('chat.imageUrlDialogTitle')"
      width="480px"
      append-to-body
    >
      <ElInput
        v-model="imageUrlInput"
        type="textarea"
        :rows="4"
        :placeholder="t('chat.imageUrlPlaceholder')"
        :disabled="imageUrlImporting"
      />
      <template #footer>
        <ElButton
          :disabled="imageUrlImporting"
          @click="imageUrlDialogVisible = false"
        >
          {{ t('common.cancel') }}
        </ElButton>
        <ElButton
          type="primary"
          :loading="imageUrlImporting"
          @click="handleImportImageUrls"
        >
          {{ t('common.confirm') }}
        </ElButton>
      </template>
    </ElDialog>
  </div>
</template>
