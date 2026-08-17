<script setup lang="ts">
import {
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElInput,
  ElMessage,
  ElTag
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NSpace,
  NSpin,
  NText
} from '@/ui/element-plus-primitives';
import { RefreshOutline, AlertCircleOutline, CopyOutline, CheckmarkOutline, GitBranchOutline, CreateOutline, DocumentOutline } from '@vicons/ionicons5';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { CottageMessage, CottageSection } from '../../agent/messages';
import { containsThinkingTag, splitCottageThinking } from '../../agent/cottageThinking';
import {
  extractPartialJsonString,
  isFileWriteToolName,
  parseStreamingFileWriteArgs,
} from '../../agent/parseStreamingToolArgs';
import {
  collectMessageChangedFiles,
  type ChangedFileKind,
} from '../../chat/messageChangedFiles';
import {
  parseAskUserArgs,
} from '../../agent/askUserTool';
import {
  cancelPendingPlanApproval,
  getPendingPlanApproval,
  pendingPlanApprovalRevision,
  resolvePendingPlanApproval,
} from '../../platform/plan';
import { parseMcpToolName } from '../../mcp/toolAdapter';
import { toolLocaleAlias, toolRisk } from '../../agent/toolDescriptions';
import { isAskUserTool } from '../../agent/toolNames';
import type { CapabilityRiskLevel } from '../../platform/capabilities/types';
import { bindMarkdownCopyButtons } from './markdownRender';
import StreamingMarkdown from './StreamingMarkdown.vue';
import UserMessageContent from './UserMessageContent.vue';
import OrchestrationCard from '../Orchestrator/OrchestrationCard.vue';
import SpecCard from '../Spec/SpecCard.vue';
import PlanCard from '../Plan/PlanCard.vue';
import FileWriteDiff from './FileWriteDiff.vue';
import DeliverableCard from './DeliverableCard.vue';
import DeliverableCanvasCard from './DeliverableCanvasCard.vue';
import RunScriptCard from './RunScriptCard.vue';
import ImageGenCard from './ImageGenCard.vue';
import AskUserPrompt from './AskUserPrompt.vue';
import ChatComponentCard from './ChatComponentCard.vue';
import { useAgentStore } from '../../stores/agent';
import { useWorkspaceStore } from '../../stores/workspace';
import { formatSessionTime } from '../../config/chatSessions';
import { composeUserMessage } from '../../chat/composeUserMessage';
import type { ChatFileReference } from '../../chat/fileReferences';
import { parseUserMessageDisplay } from '../../chat/userMessageFormat';
import { workspace } from '../../workspace/FileSystemWorkspace';
const { t } = useI18n();
const agentStore = useAgentStore();
const props = defineProps<{
  message: CottageMessage;
  live?: boolean;
  /** 父级流式更新序号，用于触发对就地突变 sections 的重渲染 */
  version?: number;
  /** 当前消息所属会话；用于按会话读取审批闸门，避免切历史后弹窗丢失 */
  sessionId?: string | null;
}>();
type CallSection = Extract<CottageSection, { type: 'call' }>;
type SubmitExecutionPlanItem = {
  requirement: string;
  actions?: string[];
  confidence?: number;
};
type SubmitExecutionPlanBudget = {
  maxFiles?: number;
  maxApiCalls?: number;
  maxTurns?: number;
};
type SubmitExecutionPlanArgs = {
  goal: string;
  domain?: string;
  items: SubmitExecutionPlanItem[];
  budget?: SubmitExecutionPlanBudget;
};
type SubmitExecutionPlanResult = {
  ok?: boolean;
  goal?: string;
  itemCount?: number;
  budget?: SubmitExecutionPlanBudget | null;
  reason?: string;
};
type PlanStepStatus = 'pending' | 'running' | 'done';
type JsonRecord = Record<string, unknown>;
type ToolDisplayFormatter = {
  params?: (args: JsonRecord | null) => string[];
  result?: (result: unknown, args: JsonRecord | null) => string[];
};
type ToolDisplayView = {
  paramLines: string[];
  resultLines: string[];
  rawParams: string | null;
  rawResult: string | null;
};
type SubmitPlanView = {
  args: SubmitExecutionPlanArgs | null;
  result: SubmitExecutionPlanResult | null;
  itemStatuses: PlanStepStatus[];
  completedCount: number;
  hasRunning: boolean;
};
type DeliverablePathEntry = { path: string; description?: string };
type TaskCompleteArgs = {
  paths?: Array<string | DeliverablePathEntry>;
  summary?: string;
};
type TaskCompleteResult = { ok?: boolean; pathCount?: number };
const normalizeDeliverablePaths = (
  raw: TaskCompleteArgs['paths'],
): DeliverablePathEntry[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (typeof item === 'string') return { path: item };
      if (item && typeof item === 'object' && typeof item.path === 'string') {
        return { path: item.path, description: item.description };
      }
      return null;
    })
    .filter((item): item is DeliverablePathEntry => item !== null);
};
const parseTaskCompleteArgs = (section: CallSection): TaskCompleteArgs | null => {
  if (!section.arguments?.trim()) return null;
  try {
    const parsed = JSON.parse(section.arguments) as TaskCompleteArgs;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};
const parseTaskCompleteResult = (section: CallSection): TaskCompleteResult | null => {
  if (!section.result?.trim()) return null;
  try {
    const parsed = JSON.parse(section.result) as TaskCompleteResult;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};
type DeliverableView = {
  paths: DeliverablePathEntry[];
  summary: string | null;
  completed: boolean;
};
const buildDeliverableView = (section: CallSection): DeliverableView => {
  const args = parseTaskCompleteArgs(section);
  const result = parseTaskCompleteResult(section);
  return {
    paths: normalizeDeliverablePaths(args?.paths),
    summary: args?.summary?.trim() || null,
    completed: Boolean(result?.ok),
  };
};
const deliverableViews = computed<Record<string, DeliverableView>>(() => {
  void props.version;
  const map: Record<string, DeliverableView> = {};
  for (const section of props.message.sections) {
    if (section.type !== 'call' || section.name !== 'taskComplete') continue;
    map[section.id] = buildDeliverableView(section);
  }
  return map;
});
const getDeliverableView = (section: CallSection): DeliverableView =>
  deliverableViews.value[section.id] ?? { paths: [], summary: null, completed: false };

type CanvasDeliverableView = {
  canvas: import('../../task/types').TaskCanvasPayload | null;
  summary: string | null;
  completed: boolean;
};

const parseCanvasDeliverableArgs = (
  section: CallSection,
): import('../../task/types').TaskCanvasPayload | null => {
  if (!section.arguments?.trim()) return null;
  try {
    const parsed = JSON.parse(section.arguments) as { canvas?: unknown };
    const canvas = parsed?.canvas;
    if (!canvas || typeof canvas !== 'object' || !('kind' in canvas)) return null;
    return canvas as import('../../task/types').TaskCanvasPayload;
  } catch {
    return null;
  }
};

const parseCanvasDeliverableResult = (section: CallSection): boolean => {
  if (!section.result?.trim()) return false;
  try {
    const parsed = JSON.parse(section.result) as { ok?: boolean };
    return parsed?.ok === true;
  } catch {
    return false;
  }
};

const buildCanvasDeliverableView = (section: CallSection): CanvasDeliverableView => {
  const args = parseCanvasDeliverableArgs(section);
  return {
    canvas: args,
    summary:
      (() => {
        try {
          const parsed = JSON.parse(section.arguments ?? '{}') as { summary?: string };
          return parsed.summary?.trim() || null;
        } catch {
          return null;
        }
      })(),
    completed: parseCanvasDeliverableResult(section),
  };
};

const canvasDeliverableViews = computed<Record<string, CanvasDeliverableView>>(() => {
  void props.version;
  const map: Record<string, CanvasDeliverableView> = {};
  for (const section of props.message.sections) {
    if (section.type !== 'call' || section.name !== 'submitDeliverableCanvas') continue;
    map[section.id] = buildCanvasDeliverableView(section);
  }
  return map;
});

const getCanvasDeliverableView = (section: CallSection): CanvasDeliverableView =>
  canvasDeliverableViews.value[section.id] ?? {
    canvas: null,
    summary: null,
    completed: false,
  };

type RunScriptView = {
  code: string;
  resultText: string | null;
  logs: string[];
  streamingLogText: string | null;
};

const formatScriptValue = (value: unknown): string => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const isRunScriptResultRecord = (
  value: unknown,
): value is { result?: unknown; logs?: unknown } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as JsonRecord;
  return 'result' in record || 'logs' in record;
};

const buildRunScriptView = (section: CallSection): RunScriptView => {
  const args = parseJsonRecord(section.arguments);
  let code =
    args && typeof args.code === 'string' ? args.code : '';
  if (!code && section.arguments) {
    code = extractPartialJsonString(section.arguments, 'code') ?? '';
  }

  let resultText: string | null = null;
  let logs: string[] = [];
  let streamingLogText: string | null = null;

  const raw = section.result?.trim();
  if (raw) {
    const parsed = parseJsonValue(raw);
    if (isRunScriptResultRecord(parsed)) {
      if (Array.isArray(parsed.logs)) {
        logs = parsed.logs.map((line) =>
          typeof line === 'string' ? line : formatScriptValue(line),
        );
      }
      if ('result' in parsed) {
        resultText = formatScriptValue(parsed.result);
      }
    } else if (section.running) {
      streamingLogText = section.result ?? null;
    } else {
      resultText = raw;
    }
  }

  return { code, resultText, logs, streamingLogText };
};

const runScriptViews = computed<Record<string, RunScriptView>>(() => {
  void props.version;
  const map: Record<string, RunScriptView> = {};
  for (const section of props.message.sections) {
    if (section.type !== 'call' || section.name !== 'runScript') continue;
    map[section.id] = buildRunScriptView(section);
  }
  return map;
});

const getRunScriptView = (section: CallSection): RunScriptView =>
  runScriptViews.value[section.id] ?? {
    code: '',
    resultText: null,
    logs: [],
    streamingLogText: null,
  };

const imageGenToolNames = new Set(['generateImage', 'editImage']);

type ImageGenView = {
  prompt: string | null;
  /** 请求张数（参数 n），占位态用 */
  expectedCount: number;
  /** 已保存到工作区的图片路径（结果 savedTo） */
  paths: string[];
};

const buildImageGenView = (section: CallSection): ImageGenView => {
  const args = parseJsonRecord(section.arguments);
  const prompt = safeString(args?.prompt);
  const expectedCount = typeof args?.n === 'number' ? args.n : 1;
  const paths: string[] = [];
  const result = parseJsonRecord(section.result);
  if (Array.isArray(result?.savedTo)) {
    for (const item of result.savedTo) {
      if (typeof item === 'string' && item.trim()) paths.push(item);
    }
  }
  return { prompt, expectedCount, paths };
};

const imageGenViews = computed<Record<string, ImageGenView>>(() => {
  void props.version;
  const map: Record<string, ImageGenView> = {};
  for (const section of props.message.sections) {
    if (section.type !== 'call' || !imageGenToolNames.has(section.name)) continue;
    map[section.id] = buildImageGenView(section);
  }
  return map;
});

const getImageGenView = (section: CallSection): ImageGenView =>
  imageGenViews.value[section.id] ?? { prompt: null, expectedCount: 1, paths: [] };

/** 执行中或已落盘图片时渲染生图卡片；否则回退通用工具卡片（如配置类错误提示） */
const isImageGenRenderable = (section: CallSection): boolean =>
  Boolean(section.running || section.argsStreaming) ||
  getImageGenView(section).paths.length > 0;

type GroupedCallKind = 'explore' | 'edit';
type GroupedCallEntry = {
  index: number;
  section: CallSection;
};
type GroupedCallMeta = {
  kind: GroupedCallKind;
  label: string;
  calls: GroupedCallEntry[];
  running: boolean;
};
function sectionKey(section: CottageSection, index: number): string {
  if (section.type === 'call') return `call-${section.id}`;
  if (section.type === 'orchestration') {
    return `orch-${section.orchestrationId}`;
  }
  if (section.type === 'spec') {
    return `spec-${section.specId}`;
  }
  if (section.type === 'plan') {
    return `plan-${section.planId}`;
  }
  return `${section.type}-${index}`;
}

function handleResolveToolApproval(callId: string, approved: boolean) {
  const chat = agentStore.chat;
  if (!chat) return;
  void chat.resolveInteraction(callId, {
    kind: 'tool_approval',
    approved,
  });
}

function handleResolveAskUser(callId: string, chosen: string) {
  const chat = agentStore.chat;
  if (!chat) return;
  void chat.resolveInteraction(callId, {
    kind: 'ask_user',
    chosen,
  });
}

function handleCancelAskUser(callId: string) {
  const chat = agentStore.chat;
  if (!chat) return;
  void chat.resolveInteraction(callId, {
    kind: 'ask_user',
    chosen: '（用户取消）',
  });
}

function planApprovalPending(section: CallSection): boolean {
  void pendingPlanApprovalRevision.value;
  if (section.name !== 'submitExecutionPlan') return false;
  if (!section.running) return false;
  return getPendingPlanApproval(props.sessionId) !== null;
}
function approvePlan() {
  resolvePendingPlanApproval('approved', props.sessionId);
}
function adjustPlan() {
  resolvePendingPlanApproval('adjust', props.sessionId);
}
function cancelPlan() {
  cancelPendingPlanApproval(undefined, props.sessionId);
}
function askResult(section: CallSection) {
  const rawInteractionAnswer =
    section.interaction?.kind === 'ask_user'
      ? section.interaction.decision?.chosen
      : undefined;
  const interactionAnswer =
    typeof rawInteractionAnswer === 'string' ? rawInteractionAnswer.trim() : '';
  if (interactionAnswer) return interactionAnswer;
  if (!section.result) return null;
  try {
    const result = JSON.parse(section.result) as { chosen?: string };
    return typeof result.chosen === 'string' && result.chosen.trim()
      ? result.chosen.trim()
      : null;
  } catch {
    return null;
  }
}
function askUserView(section: CallSection) {
  const interaction =
    section.interaction?.kind === 'ask_user' ? section.interaction : null;
  const parsed = parseAskUserArgs(section.arguments);
  const question = interaction?.question ?? parsed?.question ?? null;
  const options = interaction?.options ?? parsed?.options ?? [];
  const interactive =
    Boolean(interaction) &&
    interaction!.status === 'pending' &&
    !section.result;
  let statusText: string | null = null;
  if (!section.result) {
    if (section.argsStreaming) statusText = t('chat.generatingQuestion');
    else if (question && section.running && !interactive) {
      statusText = t('chat.preparingQuestion');
    } else if (!question) statusText = t('chat.waitingTool');
  }
  return { question, options, interactive, statusText };
}
function parseSubmitExecutionPlanArgs(
  section: CallSection,
): SubmitExecutionPlanArgs | null {
  if (!section.arguments?.trim()) return null;
  try {
    const parsed = JSON.parse(section.arguments) as SubmitExecutionPlanArgs;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.goal !== 'string' ||
      !Array.isArray(parsed.items)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function parseSubmitExecutionPlanResult(
  section: CallSection,
): SubmitExecutionPlanResult | null {
  if (!section.result?.trim()) return null;
  try {
    const parsed = JSON.parse(section.result) as SubmitExecutionPlanResult;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}
function formatPlanConfidence(confidence?: number): string | null {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) return null;
  return `${Math.round(Math.max(0, Math.min(1, confidence)) * 100)}%`;
}
function hasPlanBudget(budget?: SubmitExecutionPlanBudget | null): boolean {
  if (!budget) return false;
  return (
    typeof budget.maxFiles === 'number' ||
    typeof budget.maxApiCalls === 'number' ||
    typeof budget.maxTurns === 'number'
  );
}
function buildPlanView(section: CallSection, sectionIndex: number): SubmitPlanView {
  const args = parseSubmitExecutionPlanArgs(section);
  const result = parseSubmitExecutionPlanResult(section);
  if (!args) {
    return {
      args: null,
      result,
      itemStatuses: [],
      completedCount: 0,
      hasRunning: section.running ?? false,
    };
  }
  const followingCalls: CallSection[] = [];
  for (let i = sectionIndex + 1; i < props.message.sections.length; i += 1) {
    const next = props.message.sections[i];
    if (next.type !== 'call') continue;
    if (next.name === 'submitExecutionPlan') break;
    followingCalls.push(next);
  }
  const completedCalls = followingCalls.filter((call) => !call.running).length;
  const completedCount = Math.min(args.items.length, completedCalls);
  const hasRunning =
    (section.running ?? false) ||
    followingCalls.some((call) => Boolean(call.running));
  const itemStatuses = args.items.map((_, index): PlanStepStatus => {
    if (index < completedCount) return 'done';
    if (index === completedCount && hasRunning) return 'running';
    return 'pending';
  });
  return {
    args,
    result,
    itemStatuses,
    completedCount,
    hasRunning,
  };
}
const submitPlanViews = computed<Record<string, SubmitPlanView>>(() => {
  void props.version;
  const views: Record<string, SubmitPlanView> = {};
  for (const [index, section] of props.message.sections.entries()) {
    if (section.type !== 'call' || section.name !== 'submitExecutionPlan') continue;
    views[section.id] = buildPlanView(section, index);
  }
  return views;
});
function getSubmitPlanView(section: CallSection): SubmitPlanView | null {
  return submitPlanViews.value[section.id] ?? null;
}
function planStepSymbol(status: PlanStepStatus): string {
  if (status === 'done') return '✓';
  if (status === 'running') return '◉';
  return '○';
}
function planOverallStatusText(view: SubmitPlanView): string {
  if (view.args && view.completedCount >= view.args.items.length) return t('chat.completed');
  if (view.hasRunning) return t('chat.running');
  return t('chat.pending');
}
function planOverallStatusTagType(view: SubmitPlanView): 'success' | 'warning' | 'info' {
  if (view.args && view.completedCount >= view.args.items.length) return 'success';
  if (view.hasRunning) return 'warning';
  return 'info';
}
const displayToolName = (name: string) => toolLocaleAlias(name);

const RISK_RANK: Record<CapabilityRiskLevel, number> = {
  read: 0,
  write: 1,
  external: 2,
  destructive: 3,
};
const highestOf = (levels: CapabilityRiskLevel[]): CapabilityRiskLevel | null => {
  if (!levels.length) return null;
  return levels.reduce((acc, l) => (RISK_RANK[l] > RISK_RANK[acc] ? l : acc));
};
const callRisk = (section: CallSection): CapabilityRiskLevel | null => {
  const direct = toolRisk(section.name);
  if (direct) return direct;
  const mcpMeta = parseMcpToolName(section.name);
  if (mcpMeta) {
    if (/^(read|get|list|search|find|fetch)/i.test(mcpMeta.toolName)) return 'read';
    if (/^(write|edit|create|delete|rename|patch|mkdir)/i.test(mcpMeta.toolName)) {
      return 'write';
    }
  }
  return null;
};
const groupRisk = (kind: GroupedCallKind): CapabilityRiskLevel | null => {
  const calls = groupedCalls.value[kind].calls;
  return highestOf(
    calls.map((c) => callRisk(c.section)).filter((l): l is CapabilityRiskLevel => l !== null),
  );
};
const RISK_I18N: Record<CapabilityRiskLevel, string> = {
  read: 'settings.riskRead',
  write: 'settings.riskWrite',
  external: 'settings.riskExternal',
  destructive: 'settings.riskDestructive',
};
const riskTagLabel = (risk: CapabilityRiskLevel | null): string | null =>
  risk ? t(RISK_I18N[risk]) : null;
const PREVIEW_LIMIT = 160;
const valuePreview = (value: unknown, limit = PREVIEW_LIMIT): string => {
  if (value == null) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return t('chat.valuePreview.arrayItems', { n: value.length });
  if (typeof value === 'object') {
    const keys = Object.keys(value as JsonRecord);
    return keys.length ? t('chat.valuePreview.objectFields', { n: keys.length }) : t('chat.valuePreview.emptyObject');
  }
  return String(value);
};
const parseJsonRecord = (raw?: string): JsonRecord | null => {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as JsonRecord;
    }
  } catch {
    return null;
  }
  return null;
};
const parseJsonValue = (raw?: string): unknown => {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};
const safeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
};
const fileWriteToolNames = new Set([
  'writeFile',
  'createFile',
  'editFile',
  'patchFile',
  'applyPatch',
  'appendFile',
  'touch',
]);
const exploreToolNames = new Set([
  'readFile',
  'readMany',
  'listFiles',
  'listDirectory',
  'exists',
  'statFile',
  'getDirectorySize',
  'findFiles',
  'searchFiles',
  'diffFiles',
  'loadTools',
  'webSearch',
  'fetchWebPage',
]);
const groupedCallLabels = computed<Record<GroupedCallKind, string>>(() => ({
  explore: t('chat.exploreOps'),
  edit: t('chat.editOps'),
}));
function callGroupKind(section: CallSection): GroupedCallKind | null {
  if (isFileWriteToolName(section.name) || fileWriteToolNames.has(section.name)) {
    return 'edit';
  }
  if (exploreToolNames.has(section.name)) {
    return 'explore';
  }
  const mcpMeta = parseMcpToolName(section.name);
  if (mcpMeta) {
    if (/^(read|get|list|search|find|fetch)/i.test(mcpMeta.toolName)) return 'explore';
    if (/^(write|edit|create|delete|rename|patch|mkdir)/i.test(mcpMeta.toolName)) {
      return 'edit';
    }
  }
  return null;
}
const groupedCalls = computed<Record<GroupedCallKind, GroupedCallMeta>>(() => {
  void props.version;
  const map: Record<GroupedCallKind, GroupedCallMeta> = {
    explore: {
      kind: 'explore',
      label: groupedCallLabels.value.explore,
      calls: [],
      running: false,
    },
    edit: {
      kind: 'edit',
      label: groupedCallLabels.value.edit,
      calls: [],
      running: false,
    },
  };
  for (const [index, section] of props.message.sections.entries()) {
    if (section.type !== 'call') continue;
    const kind = callGroupKind(section);
    if (!kind) continue;
    map[kind].calls.push({ index, section });
    if (section.running) {
      map[kind].running = true;
    }
  }
  return map;
});
const groupedCallLeadIndex = computed<Record<number, GroupedCallKind>>(() => {
  void props.version;
  const lead: Record<number, GroupedCallKind> = {};
  (['explore', 'edit'] as const).forEach((kind) => {
    const calls = groupedCalls.value[kind].calls;
    if (calls.length > 0) {
      lead[calls[0].index] = kind;
    }
  });
  return lead;
});
const groupedCallActiveKeys = ref<Record<GroupedCallKind, string[]>>({
  explore: [],
  edit: [],
});
watch(
  groupedCalls,
  (value) => {
    (['explore', 'edit'] as const).forEach((kind) => {
      if (value[kind].calls.length === 0) {
        groupedCallActiveKeys.value[kind] = [];
        return;
      }
      if (value[kind].running) {
        groupedCallActiveKeys.value[kind] = ['group'];
      }
    });
  },
  { immediate: true },
);
function groupedLeadKindAt(index: number): GroupedCallKind | null {
  return groupedCallLeadIndex.value[index] ?? null;
}
function groupedCallEntries(kind: GroupedCallKind): GroupedCallEntry[] {
  return groupedCalls.value[kind].calls;
}
function groupedCallLatest(kind: GroupedCallKind): CallSection | null {
  const calls = groupedCalls.value[kind].calls;
  if (!calls.length) return null;
  return calls[calls.length - 1].section;
}
/**
 * 判断某个 section 是否会真正渲染出内容。
 *
 * 归组工具调用（探索/编辑）只有「首个 lead」会渲染折叠面板，
 * 同组其余调用不匹配任何 v-if 分支；空的 think / content 段也不产出内容。
 * 若不过滤，这些 section 仍会生成一个空 <div> flex 子项，
 * 叠加 message-sections 的 gap 后形成大段空白。
 *
 * 例外：挂了 tool_approval（策略/循环闸门）的调用必须单独露出卡片，
 * 否则状态栏提示「请在下方对话卡片中确认」时用户看不到确认按钮。
 */
function isRenderableSection(section: CottageSection, index: number): boolean {
  if (section.type === 'think') {
    return Boolean(section.text.trim());
  }
  if (section.type === 'content') {
    return Boolean(section.text) || Boolean(section.streaming);
  }
  if (section.type === 'call' && callGroupKind(section)) {
    if (section.interaction?.kind === 'tool_approval') {
      return true;
    }
    return groupedLeadKindAt(index) !== null;
  }
  return true;
}
/** 把工具结果的 via 字段翻译成可读路由标记 */
function viaRouteLabel(via: unknown): string {
  if (typeof via !== 'string' || !via) return '';
  switch (via) {
    case 'cottage-service':
      return t('chat.toolDisplay.viaCottageService');
    case 'fallback':
      return t('chat.toolDisplay.viaFallback');
    case 'browser':
      return t('chat.toolDisplay.viaBrowser');
    case 'direct':
      return t('chat.toolDisplay.viaDirect');
    case 'cors-proxy':
      return t('chat.toolDisplay.viaCorsProxy');
    default:
      return '';
  }
}
const toolDisplayFormatters: Record<string, ToolDisplayFormatter> = {
  webSearch: {
    params: (args) => {
      const query = safeString(args?.query);
      return query ? [`${t('chat.toolDisplay.query')}：${query}`] : [];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      const query = safeString(record.query);
      const content = safeString(record.content);
      const lines: string[] = [];
      const viaLabel = viaRouteLabel(record.via);
      if (viaLabel) lines.push(viaLabel);
      if (query) lines.push(`${t('chat.toolDisplay.query')}：${query}`);
      if (content) lines.push(`${t('chat.toolDisplay.summary')}：${valuePreview(content)}`);
      return lines;
    },
  },
  fetchWebPage: {
    params: (args) => {
      const url = safeString(args?.url);
      return url ? [`${t('chat.toolDisplay.webPage')}：${url}`] : [];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      const lines: string[] = [];
      const viaLabel = viaRouteLabel(record.via);
      if (viaLabel) lines.push(viaLabel);
      const title = safeString(record.title);
      const url = safeString(record.url);
      const content = safeString(record.content);
      if (title) lines.push(`${t('chat.toolDisplay.pageTitle')}：${title}`);
      if (url) lines.push(`${t('chat.toolDisplay.source')}：${url}`);
      if (content) lines.push(`${t('chat.toolDisplay.body')}：${valuePreview(content)}`);
      return lines;
    },
  },
  readFile: {
    params: (args) => {
      const path = safeString(args?.path);
      const lines: string[] = [];
      if (path) lines.push(`${t('chat.toolDisplay.read')}：${path}`);
      if (typeof args?.offset === 'number') lines.push(`offset：${args.offset}`);
      if (typeof args?.limit === 'number') lines.push(`${t('chat.toolDisplay.limit')}：${args.limit}`);
      return lines;
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      const lines: string[] = [];
      const path = safeString(record.path);
      const content = safeString(record.content);
      if (path) lines.push(`${t('chat.toolDisplay.path')}：${path}`);
      if (typeof record.startLine === 'number' && typeof record.endLine === 'number') {
        lines.push(`行：${record.startLine}-${record.endLine}/${record.totalLines ?? '?'}`);
      }
      if (record.truncated === true) lines.push(t('chat.toolDisplay.truncated'));
      if (content) lines.push(`${t('chat.toolDisplay.content')}：${valuePreview(content)}`);
      return lines;
    },
  },
  listFiles: {
    params: (args) => {
      const prefix = safeString(args?.prefix);
      return [prefix ? `${t('chat.toolDisplay.dirPrefix')}：${prefix}` : `${t('chat.toolDisplay.dirPrefix')}：${t('chat.toolDisplay.wsRoot')}`];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const paths = (result as JsonRecord).paths;
      if (Array.isArray(paths)) return [`${t('chat.toolDisplay.fileCount')}：${paths.length}`];
      return [];
    },
  },
  listDirectory: {
    params: (args) => {
      const path = safeString(args?.path);
      return [path ? `${t('chat.toolDisplay.dirPrefix')}：${path}` : `${t('chat.toolDisplay.dirPrefix')}：${t('chat.toolDisplay.wsRoot')}`];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      if (typeof record.count === 'number') return [`${t('chat.toolDisplay.fileCount')}：${record.count}`];
      return [];
    },
  },
  exists: {
    params: (args) => {
      const path = safeString(args?.path);
      return path ? [`${t('chat.toolDisplay.path')}：${path}`] : [];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      const lines: string[] = [];
      if (record.exists === true) lines.push('存在');
      if (record.exists === false) lines.push('不存在');
      const kind = safeString(record.kind);
      if (kind) lines.push(`类型：${kind}`);
      return lines;
    },
  },
  statFile: {
    params: (args) => {
      const path = safeString(args?.path);
      return path ? [`${t('chat.toolDisplay.path')}：${path}`] : [];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      const lines: string[] = [];
      if (record.exists === false) return ['不存在'];
      const kind = safeString(record.kind);
      if (kind) lines.push(`类型：${kind}`);
      if (typeof record.size === 'number') lines.push(`大小：${record.size}`);
      return lines;
    },
  },
  findFiles: {
    params: (args) => {
      const lines: string[] = [];
      const glob = safeString(args?.glob);
      if (glob) lines.push(`${t('chat.toolDisplay.globPattern')}：${glob}`);
      if (typeof args?.limit === 'number') lines.push(`${t('chat.toolDisplay.limit')}：${args.limit}`);
      return lines;
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      const lines: string[] = [];
      if (typeof record.count === 'number') lines.push(`${t('chat.toolDisplay.hits')}：${record.count}`);
      if (record.truncated === true) lines.push(t('chat.toolDisplay.truncated'));
      return lines;
    },
  },
  searchFiles: {
    params: (args) => {
      const lines: string[] = [];
      const query = safeString(args?.query);
      if (query) lines.push(`${t('chat.toolDisplay.query')}：${query}`);
      const path = safeString(args?.path);
      if (path) lines.push(`${t('chat.toolDisplay.dirPrefix')}：${path}`);
      if (args?.isRegex === true) lines.push(`${t('chat.toolDisplay.mode')}：${t('chat.toolDisplay.modeRegex')}`);
      if (Array.isArray(args?.include) && args.include.length) {
        lines.push(`${t('chat.toolDisplay.globPattern')}：${args.include.join(', ')}`);
      }
      if (Array.isArray(args?.extensions) && args.extensions.length) {
        lines.push(`ext：${args.extensions.join(', ')}`);
      }
      return lines;
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      const lines: string[] = [];
      if (typeof record.fileCount === 'number') lines.push(`${t('chat.toolDisplay.hitFiles')}：${record.fileCount}`);
      if (typeof record.matchCount === 'number') lines.push(`${t('chat.toolDisplay.hitItems')}：${record.matchCount}`);
      if (record.truncated === true) lines.push(t('chat.toolDisplay.truncated'));
      return lines;
    },
  },
  readMany: {
    params: (args) => {
      const paths = Array.isArray(args?.paths) ? args.paths.filter((p): p is string => typeof p === 'string') : [];
      return paths.length ? [`${t('chat.toolDisplay.fileCount')}：${paths.length}`] : [];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      const lines: string[] = [];
      if (typeof record.count === 'number') lines.push(`${t('chat.toolDisplay.fileCount')}：${record.count}`);
      if (record.truncated === true) lines.push(t('chat.toolDisplay.truncated'));
      return lines;
    },
  },
  diffFiles: {
    params: (args) => {
      const left = safeString(args?.left);
      const right = safeString(args?.right);
      const lines: string[] = [];
      if (left) lines.push(`${t('chat.toolDisplay.from')}：${left}`);
      if (right) lines.push(`${t('chat.toolDisplay.to')}：${right}`);
      return lines;
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      if (record.identical === true) return ['相同'];
      if (record.truncated === true) return [t('chat.toolDisplay.truncated')];
      return ['有差异'];
    },
  },
  applyPatch: {
    params: (args) => {
      const path = safeString(args?.path);
      return path ? [`${t('chat.toolDisplay.path')}：${path}`] : ['unified diff'];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      if (typeof record.count === 'number') return [`${t('chat.toolDisplay.fileCount')}：${record.count}`];
      return [];
    },
  },
  copy: {
    params: (args) => {
      const from = safeString(args?.from);
      const to = safeString(args?.to);
      const lines: string[] = [];
      if (from) lines.push(`${t('chat.toolDisplay.from')}：${from}`);
      if (to) lines.push(`${t('chat.toolDisplay.to')}：${to}`);
      return lines;
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      if (typeof record.fileCount === 'number') return [`${t('chat.toolDisplay.fileCount')}：${record.fileCount}`];
      return record.copied === true ? ['已复制'] : [];
    },
  },
  move: {
    params: (args) => {
      const from = safeString(args?.from);
      const to = safeString(args?.to);
      const lines: string[] = [];
      if (from) lines.push(`${t('chat.toolDisplay.from')}：${from}`);
      if (to) lines.push(`${t('chat.toolDisplay.to')}：${to}`);
      return lines;
    },
    result: () => ['已移动'],
  },
  appendFile: {
    params: (args) => {
      const path = safeString(args?.path);
      return path ? [`${t('chat.toolDisplay.path')}：${path}`] : [];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      return record.created === true ? ['已创建并追加'] : ['已追加'];
    },
  },
  getDirectorySize: {
    params: (args) => {
      const path = safeString(args?.path);
      return [path ? `${t('chat.toolDisplay.dirPrefix')}：${path}` : `${t('chat.toolDisplay.dirPrefix')}：${t('chat.toolDisplay.wsRoot')}`];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      if (record.exists === false) return ['不存在'];
      const lines: string[] = [];
      if (typeof record.totalBytes === 'number') lines.push(`字节：${record.totalBytes}`);
      if (typeof record.fileCount === 'number') lines.push(`${t('chat.toolDisplay.fileCount')}：${record.fileCount}`);
      return lines;
    },
  },
  rename: {
    params: (args) => {
      const from = safeString(args?.from);
      const to = safeString(args?.to);
      const lines: string[] = [];
      if (from) lines.push(`${t('chat.toolDisplay.from')}：${from}`);
      if (to) lines.push(`${t('chat.toolDisplay.to')}：${to}`);
      return lines;
    },
  },
  deleteFile: { params: (args) => (safeString(args?.path) ? [`${t('chat.toolDisplay.deleteFile')}：${safeString(args?.path)}`] : []) },
  deleteEntry: { params: (args) => (safeString(args?.path) ? [`${t('chat.toolDisplay.deletePath')}：${safeString(args?.path)}`] : []) },
  deleteFiles: {
    params: (args) =>
      Array.isArray(args?.paths)
        ? [`${t('chat.toolDisplay.deletePathCount')}：${args.paths.length}`]
        : safeString(args?.paths)
          ? [`${t('chat.toolDisplay.deletePath')}：${safeString(args?.paths)}`]
          : [],
  },
  deletePaths: {
    params: (args) => (Array.isArray(args?.paths) ? [`${t('chat.toolDisplay.deletePathCount')}：${args.paths.length}`] : []),
  },
  mkdir: { params: (args) => (safeString(args?.path) ? [`${t('chat.toolDisplay.createDir')}：${safeString(args?.path)}`] : []) },
  compress: {
    params: (args) => {
      const lines: string[] = [];
      if (Array.isArray(args?.paths)) lines.push(`${t('chat.toolDisplay.compressItems')}：${args.paths.length}`);
      if (safeString(args?.outputPath)) lines.push(`${t('chat.toolDisplay.output')}：${safeString(args?.outputPath)}`);
      return lines;
    },
  },
  extract: {
    params: (args) => {
      const archive = safeString(args?.archivePath);
      const target = safeString(args?.targetDir);
      const lines: string[] = [];
      if (archive) lines.push(`${t('chat.toolDisplay.archive')}：${archive}`);
      if (target) lines.push(`${t('chat.toolDisplay.targetDir')}：${target}`);
      return lines;
    },
  },
  runScript: {
    params: (args) => {
      const code = safeString(args?.code);
      return code ? [`${t('chat.toolDisplay.script')}：${valuePreview(code, 80)}`] : [];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const record = result as JsonRecord;
      const lines: string[] = [];
      const output = safeString(record.result);
      if (output) lines.push(`${t('chat.toolDisplay.execResult')}：${valuePreview(output, 120)}`);
      if (Array.isArray(record.logs)) lines.push(`${t('chat.toolDisplay.logLines')}：${record.logs.length}`);
      return lines;
    },
  },
  taskSetPlan: {
    params: (args) => {
      const steps = args?.steps;
      return Array.isArray(steps) ? [`${t('chat.toolDisplay.planSteps')}：${steps.length}`] : [];
    },
    result: (result) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) return [];
      const stepCount = (result as JsonRecord).stepCount;
      return typeof stepCount === 'number' ? [`${t('chat.toolDisplay.stepUpdated')}：${stepCount}`] : [];
    },
  },
  taskComplete: {
    params: (args) => {
      const lines: string[] = [];
      if (Array.isArray(args?.paths)) lines.push(`${t('chat.toolDisplay.deliverFiles')}：${args.paths.length}`);
      if (safeString(args?.summary)) lines.push(`${t('chat.toolDisplay.taskSummary')}：${valuePreview(args?.summary, 80)}`);
      return lines;
    },
  },
  taskFail: {
    params: (args) => (safeString(args?.reason) ? [`${t('chat.toolDisplay.failReason')}：${safeString(args?.reason)}`] : []),
  },
};
const summarizeRecord = (record: JsonRecord): string[] =>
  Object.entries(record)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${valuePreview(value)}`)
    .filter((line) => !line.endsWith(': '));
const buildToolDisplayView = (section: CallSection): ToolDisplayView => {
  const args = parseJsonRecord(section.arguments);
  const parsedResult = parseJsonValue(section.result);
  const formatter = toolDisplayFormatters[section.name];
  const mcpMeta = parseMcpToolName(section.name);
  let paramLines: string[] = [];
  let resultLines: string[] = [];
  if (mcpMeta) {
    paramLines.push(`MCP：${mcpMeta.serverId}/${mcpMeta.toolName}`);
  }
  if (formatter?.params) {
    paramLines = [...paramLines, ...formatter.params(args)];
  }
  if (formatter?.result) {
    resultLines = formatter.result(parsedResult, args);
  }
  if (!paramLines.length && args) {
    paramLines = summarizeRecord(args);
  }
  if (!resultLines.length && parsedResult && typeof parsedResult === 'object' && !Array.isArray(parsedResult)) {
    resultLines = summarizeRecord(parsedResult as JsonRecord);
  }
  const rawParams = section.arguments?.trim() && !paramLines.length ? section.arguments : null;
  const rawResult = section.result?.trim() && !resultLines.length ? section.result : null;
  return { paramLines, resultLines, rawParams, rawResult };
};
const toolDisplayViews = computed<Record<string, ToolDisplayView>>(() => {
  void props.version;
  const map: Record<string, ToolDisplayView> = {};
  for (const section of props.message.sections) {
    if (section.type !== 'call') continue;
    if (isAskUserTool(section.name) || section.name === 'submitExecutionPlan') continue;
    if (section.name === 'runScript') continue;
    if (isFileWriteToolName(section.name) || fileWriteToolNames.has(section.name)) continue;
    map[section.id] = buildToolDisplayView(section);
  }
  return map;
});
const getToolDisplayView = (section: CallSection): ToolDisplayView =>
  toolDisplayViews.value[section.id] ?? {
    paramLines: [],
    resultLines: [],
    rawParams: section.arguments?.trim() ? section.arguments : null,
    rawResult: section.result?.trim() ? section.result : null,
  };
const toolHeaderParamPreview = (section: CallSection): string => {
  const view = getToolDisplayView(section);
  if (view.paramLines.length) return view.paramLines.join(' · ');
  const raw = section.arguments?.trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return summarizeRecord(parsed as JsonRecord).join(' · ');
    }
  } catch {
    return raw.replace(/\s+/g, ' ');
  }
  return raw.replace(/\s+/g, ' ');
};
const toolResultPreview = (section: CallSection): string => {
  const view = getToolDisplayView(section);
  if (view.resultLines.length) return view.resultLines.join(' · ');
  if (view.rawResult) return valuePreview(view.rawResult, 120);
  if (!section.result?.trim()) return '';
  const parsed = parseJsonValue(section.result);
  if (parsed != null) return valuePreview(parsed, 120);
  return valuePreview(section.result, 120);
};
const callActiveKeys = ref<Record<number, string[]>>({});
const thinkActiveKeys = ref<Record<number, string[]>>({});
const planItemActiveKeys = ref<Record<string, string[]>>({});
const planItemKey = (index: number) => `item-${index}`;
watch(
  () => [props.message.sections, props.version] as const,
  ([sections]) => {
    for (const [index, section] of sections.entries()) {
      if (section.type === 'call' && !(index in callActiveKeys.value)) {
        callActiveKeys.value = {
          ...callActiveKeys.value,
          [index]: section.running ? ['call'] : [],
        };
      }
      if (section.type === 'think' && !(index in thinkActiveKeys.value)) {
        thinkActiveKeys.value = {
          ...thinkActiveKeys.value,
          [index]: [],
        };
      }
      if (
        section.type === 'call' &&
        section.name === 'submitExecutionPlan' &&
        !(section.id in planItemActiveKeys.value)
      ) {
        planItemActiveKeys.value = {
          ...planItemActiveKeys.value,
          [section.id]: [],
        };
      }
    }
  },
  { immediate: true },
);
const isUser = computed(() => props.message.role === 'user');
const chatBusy = computed(() => {
  const chat = agentStore.chat;
  if (!chat) return true;
  if (props.sessionId && chat.getSessionId() !== props.sessionId) return true;
  return chat.viewState.busy;
});
const retrying = ref(false);
const copying = ref(false);
const copied = ref(false);
const forking = ref(false);
const editing = ref(false);
const editDraft = ref('');
const editTextareaRef = ref<{ textarea?: HTMLTextAreaElement } | null>(null);
let copiedResetTimer: ReturnType<typeof setTimeout> | undefined;

function userMessageDisplayText(): string {
  const llmText =
    props.message.sections.find((s) => s.type === 'content')?.text ?? '';
  return parseUserMessageDisplay(llmText, {
    userText: props.message.userText,
    fileReferences: props.message.fileReferences,
  }).userText;
}

function startEdit() {
  if (!isUser.value || chatBusy.value || retrying.value || editing.value) return;
  if (props.sessionId && agentStore.chat?.getSessionId() !== props.sessionId) {
    return;
  }
  editDraft.value = userMessageDisplayText();
  editing.value = true;
  void nextTick(() => {
    const textarea = editTextareaRef.value?.textarea;
    if (!textarea) return;
    textarea.focus();
    const len = textarea.value.length;
    textarea.setSelectionRange(len, len);
  });
}

function cancelEdit() {
  editing.value = false;
  editDraft.value = '';
}

function refsForEditedText(
  userText: string,
  originalUserText: string,
): ChatFileReference[] {
  const originals = props.message.fileReferences ?? [];
  const idsInEdited = new Set<string>();
  for (const match of userText.matchAll(/\{\{ref:([^|]+)\|([^}]+)\}\}/g)) {
    idsInEdited.add(match[1]!);
  }
  const originalHadInline = /\{\{ref:[^|]+\|[^}]+\}\}/.test(originalUserText);

  const toChat = (ref: (typeof originals)[number]): ChatFileReference | null => {
    if (!ref.path) return null;
    return {
      id: ref.id ?? crypto.randomUUID(),
      path: ref.path,
      entryType: ref.entryType,
      anchor: ref.anchor,
    };
  };

  if (idsInEdited.size === 0) {
    if (originalHadInline) return [];
    return originals
      .map(toChat)
      .filter((r): r is ChatFileReference => r !== null);
  }
  return originals
    .filter((r) => r.id && idsInEdited.has(r.id))
    .map(toChat)
    .filter((r): r is ChatFileReference => r !== null);
}

async function onSubmitEdit() {
  const chat = agentStore.chat;
  if (!chat || chat.busy || retrying.value) return;
  if (props.sessionId && chat.getSessionId() !== props.sessionId) return;

  const llmText =
    props.message.sections.find((s) => s.type === 'content')?.text ?? '';
  const display = parseUserMessageDisplay(llmText, {
    userText: props.message.userText,
    fileReferences: props.message.fileReferences,
    activeFilePath: props.message.activeFilePath,
  });
  const trimmed = editDraft.value.trim();
  const refs = refsForEditedText(editDraft.value, display.userText);
  const activeFilePath =
    props.message.activeFilePath ?? display.activeFilePath;
  if (!trimmed && !refs.length && !activeFilePath) {
    ElMessage.info(t('chat.editMessageEmpty'));
    return;
  }

  retrying.value = true;
  try {
    const composed = await composeUserMessage(
      editDraft.value,
      refs,
      async (path) => {
        const { content } = await workspace.readFile(path);
        return content;
      },
      {
        activeFilePath: activeFilePath ?? null,
        listFilesUnderPath: (path) => workspace.listFiles(path),
      },
    );
    if (!composed.llmContent.trim() && !composed.userText.trim()) {
      ElMessage.info(t('chat.editMessageEmpty'));
      return;
    }
    editing.value = false;
    editDraft.value = '';
    await chat.retryFromUserMessage(props.message.id, composed);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    retrying.value = false;
  }
}

function onEditKeydown(event: Event | KeyboardEvent) {
  if (!(event instanceof KeyboardEvent)) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    cancelEdit();
    return;
  }
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void onSubmitEdit();
  }
}

const isAssistantStreaming = computed(() => {
  void props.version;
  if (isUser.value) return false;
  if (props.live && chatBusy.value) return true;
  return props.message.sections.some((section) => {
    if (section.type === 'content' || section.type === 'think') {
      return Boolean(section.streaming);
    }
    if (section.type === 'call') {
      return Boolean(section.running || section.argsStreaming);
    }
    return false;
  });
});

const showAssistantToolbar = computed(() => {
  void props.version;
  return (
    !isUser.value &&
    props.message.sections.length > 0 &&
    !isAssistantStreaming.value
  );
});

const canForkFromMessage = computed(() => {
  const chat = agentStore.chat;
  if (!chat) return false;
  if (props.sessionId && chat.getSessionId() !== props.sessionId) return false;
  const idx = chat.messages.findIndex((m) => m.id === props.message.id);
  if (idx < 0) return false;
  return chat.messages.slice(0, idx + 1).some((m) => m.role === 'user');
});

const outputCompletedAtLabel = computed(() => {
  void props.version;
  const at = props.message.completedAt;
  if (!at) return '';
  return formatSessionTime(at);
});

const workspaceStore = useWorkspaceStore();

/** 本次回复改动/生成的文件（由工具调用确定性推导，流式中随 section 更新） */
const messageChangedFiles = computed(() => {
  void props.version;
  return collectMessageChangedFiles(props.message);
});

/** 卡片默认只展示前几项，超出可展开 */
const CHANGED_FILES_COLLAPSED_COUNT = 3;
const changedFilesExpanded = ref(false);
const visibleChangedFiles = computed(() => {
  const files = messageChangedFiles.value;
  if (changedFilesExpanded.value || files.length <= CHANGED_FILES_COLLAPSED_COUNT) {
    return files;
  }
  return files.slice(0, CHANGED_FILES_COLLAPSED_COUNT);
});

const changedFileKindLabel = (kind: ChangedFileKind): string => {
  switch (kind) {
    case 'created':
      return t('chat.changedFileCreated');
    case 'generated':
      return t('chat.changedFileGenerated');
    case 'deleted':
      return t('chat.changedFileDeleted');
    default:
      return t('chat.changedFileModified');
  }
};

const selectChangedFile = (path: string) => {
  void workspaceStore.selectFile(path);
};

const assistantOutputText = computed(() => {
  void props.version;
  return props.message.sections
    .filter(
      (section): section is Extract<CottageSection, { type: 'content' }> =>
        section.type === 'content',
    )
    .map((section) => section.text)
    .join('\n\n')
    .trim();
});

async function onCopyAssistantOutput() {
  const text = assistantOutputText.value;
  if (!text) {
    ElMessage.info(t('chat.copyOutputEmpty'));
    return;
  }
  copying.value = true;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
    if (copiedResetTimer) clearTimeout(copiedResetTimer);
    copiedResetTimer = setTimeout(() => {
      copied.value = false;
      copiedResetTimer = undefined;
    }, 1600);
  } catch {
    ElMessage.error(t('chat.copyOutputFailed'));
  } finally {
    copying.value = false;
  }
}

async function onForkFromAssistantMessage() {
  if (chatBusy.value || forking.value) return;
  if (props.sessionId && agentStore.chat?.getSessionId() !== props.sessionId) {
    return;
  }
  forking.value = true;
  try {
    await agentStore.forkChatFromMessage(props.message.id);
    ElMessage.success(t('chat.forkSuccess'));
  } catch (error) {
    ElMessage.error(
      error instanceof Error ? error.message : t('chat.forkFailed'),
    );
  } finally {
    forking.value = false;
  }
}

async function onRetryFromUserMessage() {
  const chat = agentStore.chat;
  if (!chat || chat.busy || retrying.value) return;
  if (props.sessionId && chat.getSessionId() !== props.sessionId) return;
  retrying.value = true;
  try {
    await chat.retryFromUserMessage(props.message.id);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    retrying.value = false;
  }
}

/** 助手消息出错 / 停止后：回溯到上一轮用户消息重试 */
async function onRetryAfterError() {
  const chat = agentStore.chat;
  if (!chat || chat.busy || retrying.value) return;
  if (props.sessionId && chat.getSessionId() !== props.sessionId) return;
  const msgs = chat.messages;
  const idx = msgs.findIndex((m) => m.id === props.message.id);
  if (idx < 0) return;
  let userMessageId: string | undefined;
  for (let i = idx - 1; i >= 0; i--) {
    if (msgs[i]?.role === 'user' && msgs[i]?.id) {
      userMessageId = msgs[i]!.id;
      break;
    }
  }
  if (!userMessageId) {
    ElMessage.error(t('chat.retryTurnNoUser'));
    return;
  }
  retrying.value = true;
  try {
    await chat.retryFromUserMessage(userMessageId);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    retrying.value = false;
  }
}
/**
 * v-for 的响应式数据源。
 *
 * 关键点：props.message.sections 是 Agent 实例上的非响应式裸数组，
 * 流式期间通过 push / 原地修改更新。MessageView 模板对 content/think
 * 这类纯文本分支不会读取任何依赖 props.version 的 computed，
 * 因此当父级递增 version 时，渲染函数没有任何响应式依赖变化，
 * Vue 不会重新执行 render —— 表现为「流式输出不刷新，切换会话再切回才出现」。
 *
 * 这里通过返回新数组引用，并显式依赖 props.version，确保每次流式 tick
 * 都会让 computed 失效，进而触发 MessageView 重新渲染、v-for 重新求值。
 */
const sectionsView = computed<CottageSection[]>(() => {
  void props.version;
  // 兼容旧会话：正文里仍含思考标签时，展示前拆成 think + content
  const out: CottageSection[] = [];
  for (const section of props.message.sections) {
    if (
      section.type === 'content' &&
      containsThinkingTag(section.text)
    ) {
      for (const part of splitCottageThinking(section.text)) {
        if (part.type === 'think' && part.text.trim()) {
          out.push({
            type: 'think',
            text: part.text,
            streaming: section.streaming,
          });
        } else if (part.type === 'content' && part.text) {
          out.push({
            type: 'content',
            text: part.text.replace(/^\n+/, ''),
            streaming: section.streaming,
          });
        }
      }
      continue;
    }
    out.push(section);
  }
  return out;
});
const sectionsRef = ref<HTMLElement | null>(null);
let unbindCopy: (() => void) | null = null;
onMounted(() => {
  if (sectionsRef.value) {
    unbindCopy = bindMarkdownCopyButtons(sectionsRef.value);
  }
});
onUnmounted(() => {
  unbindCopy?.();
  if (copiedResetTimer) clearTimeout(copiedResetTimer);
});
</script>
<template>
  <div :class="`message ${isUser ? 'user' : 'assistant'}`">
    <div class="message-header">
      <div class="message-role">{{ isUser ? t('chat.you') : t('chat.roleAgent') }}</div>
      <div v-if="isUser" class="message-header-actions">
        <CottageTooltip
          v-if="!editing"
          :content="t('chat.editFromMessageHint')"
          placement="top"
          delay="normal"
        >
          <ElButton
            class="message-retry-btn"
            text
            size="small"
            :disabled="chatBusy || retrying"
            @click="startEdit"
          >
            <template #icon>
              <NIcon :component="CreateOutline" />
            </template>
            {{ t('chat.editFromMessage') }}
          </ElButton>
        </CottageTooltip>
        <CottageTooltip
          v-if="!editing"
          :content="t('chat.retryFromMessageHint')"
          placement="top"
          delay="normal"
        >
          <ElButton
            class="message-retry-btn"
            text
            size="small"
            :disabled="chatBusy || retrying"
            :loading="retrying"
            @click="onRetryFromUserMessage"
          >
            <template #icon>
              <NIcon :component="RefreshOutline" />
            </template>
            {{ t('chat.retryFromMessage') }}
          </ElButton>
        </CottageTooltip>
      </div>
    </div>
    <div ref="sectionsRef" class="message-sections">
      <div v-if="isUser && editing" class="user-message-edit">
        <ElInput
          ref="editTextareaRef"
          v-model="editDraft"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 12 }"
          :placeholder="t('chat.editMessagePlaceholder')"
          :disabled="retrying"
          class="user-message-edit-input"
          @keydown="onEditKeydown"
        />
        <div class="user-message-edit-actions">
          <ElButton size="small" :disabled="retrying" @click="cancelEdit">
            {{ t('chat.editMessageCancel') }}
          </ElButton>
          <ElButton
            type="primary"
            size="small"
            :loading="retrying"
            :disabled="chatBusy"
            @click="onSubmitEdit"
          >
            {{ t('chat.editMessageSubmit') }}
          </ElButton>
        </div>
      </div>
      <UserMessageContent
        v-else-if="isUser"
        :message="message"
        :editable="!chatBusy && !retrying"
        @edit="startEdit"
      />
      <template v-else>
        <template v-for="(section, index) in sectionsView" :key="sectionKey(section, index)">
        <div v-if="isRenderableSection(section, index)">
          <template v-if="section.type === 'content' || section.type === 'think'">
            <ElCollapse
              v-if="section.type === 'think' && section.text.trim()"
              v-model="thinkActiveKeys[index]"
              class="think-block"
            >
              <ElCollapseItem name="think">
                <template #title>
                  <span class="think-label">
                    <NSpin v-if="section.streaming" size="small" />
                    <span>{{ t('chat.thinking') }}</span>
                    <NText
                      v-if="section.streaming"
                      depth="3"
                      class="think-status"
                    >
                      {{ t('chat.thinkingInProgress') }}
                    </NText>
                  </span>
                </template>
                <div class="think-body">
                  <pre class="think-text">{{ section.text }}<span
                    v-if="live && section.streaming"
                    class="think-cursor"
                  >▍</span></pre>
                </div>
              </ElCollapseItem>
            </ElCollapse>
            <StreamingMarkdown
              v-else-if="section.type === 'content' && section.text"
              :text="section.text"
              :streaming="Boolean(section.streaming)"
            />
            <NText
              v-if="live && section.type === 'content' && section.streaming"
              depth="3"
              class="stream-cursor"
            >
              ▍
            </NText>
          </template>
          <OrchestrationCard
            v-else-if="section.type === 'orchestration'"
            :state="section.state"
          />
          <SpecCard
            v-else-if="section.type === 'spec'"
            :doc="section.doc"
          />
          <PlanCard
            v-else-if="section.type === 'plan'"
            :definition="section.definition"
            :run="section.run"
          />
          <ChatComponentCard
            v-else-if="
              section.type === 'call' &&
              section.interaction?.kind === 'tool_approval' &&
              section.name !== 'runScript' &&
              !imageGenToolNames.has(section.name)
            "
            :call-id="section.id"
            :tool-name="section.name"
            :interaction="section.interaction"
            @resolve-tool-approval="handleResolveToolApproval"
            @resolve-ask-user="handleResolveAskUser"
            @cancel-ask-user="handleCancelAskUser"
          />
          <DeliverableCard
            v-else-if="section.type === 'call' && section.name === 'taskComplete'"
            :paths="getDeliverableView(section).paths"
            :summary="getDeliverableView(section).summary ?? undefined"
            :completed="getDeliverableView(section).completed"
            :running="section.running"
          />
          <DeliverableCanvasCard
            v-else-if="
              section.type === 'call' &&
              section.name === 'submitDeliverableCanvas' &&
              getCanvasDeliverableView(section).canvas
            "
            :canvas="getCanvasDeliverableView(section).canvas!"
            :summary="getCanvasDeliverableView(section).summary ?? undefined"
            :completed="getCanvasDeliverableView(section).completed"
            :running="section.running"
          />
          <div
            v-else-if="section.type === 'call' && section.name === 'runScript'"
            class="run-script-block"
          >
            <ChatComponentCard
              v-if="section.interaction?.kind === 'tool_approval'"
              :call-id="section.id"
              :tool-name="section.name"
              :interaction="section.interaction"
              @resolve-tool-approval="handleResolveToolApproval"
              @resolve-ask-user="handleResolveAskUser"
              @cancel-ask-user="handleCancelAskUser"
            />
            <RunScriptCard
              v-if="
                section.interaction?.kind !== 'tool_approval' ||
                section.interaction.status !== 'pending'
              "
              :code="getRunScriptView(section).code"
              :result-text="getRunScriptView(section).resultText"
              :logs="getRunScriptView(section).logs"
              :streaming-log-text="getRunScriptView(section).streamingLogText"
              :running="section.running"
              :args-streaming="section.argsStreaming"
            />
          </div>
          <div
            v-else-if="
              section.type === 'call' &&
              imageGenToolNames.has(section.name) &&
              (isImageGenRenderable(section) ||
                section.interaction?.kind === 'tool_approval')
            "
            class="image-gen-block"
          >
            <ChatComponentCard
              v-if="section.interaction?.kind === 'tool_approval'"
              :call-id="section.id"
              :tool-name="section.name"
              :interaction="section.interaction"
              @resolve-tool-approval="handleResolveToolApproval"
              @resolve-ask-user="handleResolveAskUser"
              @cancel-ask-user="handleCancelAskUser"
            />
            <ImageGenCard
              v-if="
                (section.interaction?.kind !== 'tool_approval' ||
                  section.interaction.status !== 'pending') &&
                isImageGenRenderable(section)
              "
              :title="displayToolName(section.name)"
              :prompt="getImageGenView(section).prompt"
              :running="section.running"
              :args-streaming="section.argsStreaming"
              :expected-count="getImageGenView(section).expectedCount"
              :paths="getImageGenView(section).paths"
            />
          </div>
          <div
            v-else-if="section.type === 'call' && section.name === 'submitExecutionPlan'"
            class="plan-tool-card"
          >
            <template v-if="getSubmitPlanView(section)?.args">
              <div class="plan-tool-header">
                <NText strong class="plan-tool-title">
                  {{ t('chat.executionPlan', { goal: getSubmitPlanView(section)!.args!.goal }) }}
                </NText>
                <span class="plan-tool-header-tags">
                  <ElTag
                    v-if="getSubmitPlanView(section)!.args!.domain"
                    size="small"
                    type="info"
                  >
                    {{ getSubmitPlanView(section)!.args!.domain }}
                  </ElTag>
                  <ElTag
                    :type="planOverallStatusTagType(getSubmitPlanView(section)!)"
                    size="small"
                  >
                    {{ planOverallStatusText(getSubmitPlanView(section)!) }}
                  </ElTag>
                </span>
              </div>
              <ElCollapse
                v-model="planItemActiveKeys[section.id]"
                class="plan-tool-item-collapse"
              >
                <ElCollapseItem
                  v-for="(item, itemIndex) in getSubmitPlanView(section)!.args!.items"
                  :key="`${section.id}-plan-item-${itemIndex}`"
                  :name="planItemKey(itemIndex)"
                  class="plan-tool-item-panel"
                >
                  <template #title>
                    <div class="plan-tool-item-title">
                      <span
                        class="plan-tool-todo-dot"
                        :class="`plan-tool-todo-dot-${getSubmitPlanView(section)!.itemStatuses[itemIndex]}`"
                      >
                        {{ planStepSymbol(getSubmitPlanView(section)!.itemStatuses[itemIndex]) }}
                      </span>
                      <span class="plan-tool-item-text">{{ item.requirement }}</span>
                    </div>
                  </template>
                  <div class="plan-tool-item-detail">
                    <ElTag
                      v-if="formatPlanConfidence(item.confidence)"
                      size="small"
                      type="success"
                    >
                      {{ t('chat.confidence', { value: formatPlanConfidence(item.confidence) }) }}
                    </ElTag>
                    <ul
                      v-if="item.actions?.length"
                      class="plan-tool-actions"
                    >
                      <li
                        v-for="(action, actionIndex) in item.actions"
                        :key="`${section.id}-plan-item-${itemIndex}-action-${actionIndex}`"
                      >
                        {{ action }}
                      </li>
                    </ul>
                  </div>
                </ElCollapseItem>
              </ElCollapse>
              <div
                v-if="hasPlanBudget(getSubmitPlanView(section)!.args!.budget)"
                class="plan-tool-budget"
              >
                <NText depth="3" class="plan-tool-budget-label">{{ t('chat.budget') }}</NText>
                <div class="plan-tool-budget-tags">
                  <ElTag
                    v-if="getSubmitPlanView(section)!.args!.budget?.maxFiles !== undefined"
                    size="small"
                  >
                    {{ t('chat.budgetFiles', { n: getSubmitPlanView(section)!.args!.budget!.maxFiles }) }}
                  </ElTag>
                  <ElTag
                    v-if="getSubmitPlanView(section)!.args!.budget?.maxApiCalls !== undefined"
                    size="small"
                  >
                    {{ t('chat.budgetApiCalls', { n: getSubmitPlanView(section)!.args!.budget!.maxApiCalls }) }}
                  </ElTag>
                  <ElTag
                    v-if="getSubmitPlanView(section)!.args!.budget?.maxTurns !== undefined"
                    size="small"
                  >
                    {{ t('chat.budgetTurns', { n: getSubmitPlanView(section)!.args!.budget!.maxTurns }) }}
                  </ElTag>
                </div>
              </div>
            </template>
            <pre
              v-else-if="section.arguments"
              class="tool-args"
            >{{ section.arguments }}</pre>
            <NText v-if="section.running && !planApprovalPending(section)" depth="3">
              {{ t('chat.submittingPlan') }}
            </NText>
            <div
              v-if="planApprovalPending(section)"
              class="plan-tool-approval"
            >
              <NText depth="2" class="plan-tool-approval-hint">
                {{ t('chat.planReady') }}
              </NText>
              <div class="plan-tool-approval-actions">
                <ElButton
                  type="primary"
                  size="small"
                  @click="approvePlan"
                >
                  {{ t('chat.approveAndRun') }}
                </ElButton>
                <ElButton
                  size="small"
                  @click="adjustPlan"
                >
                  {{ t('chat.requestChanges') }}
                </ElButton>
                <ElButton
                  size="small"
                  @click="cancelPlan"
                >
                  {{ t('common.cancel') }}
                </ElButton>
              </div>
            </div>
            <template v-if="getSubmitPlanView(section)?.result">
              <div class="plan-tool-result">
                <ElTag
                  :type="getSubmitPlanView(section)!.result!.ok ? 'success' : 'warning'"
                  size="small"
                >
                  {{ getSubmitPlanView(section)!.result!.ok ? t('chat.planSubmitted') : t('chat.planRejected') }}
                </ElTag>
                <NText
                  v-if="getSubmitPlanView(section)!.result!.itemCount !== undefined"
                  depth="3"
                >
                  {{ t('chat.planItems', { n: getSubmitPlanView(section)!.result!.itemCount }) }}
                </NText>
                <NText
                  v-if="getSubmitPlanView(section)!.result!.reason"
                  depth="3"
                  class="plan-tool-result-reason"
                >
                  {{ getSubmitPlanView(section)!.result!.reason }}
                </NText>
              </div>
            </template>
            <pre
              v-else-if="section.result"
              class="tool-result"
            >{{ section.result }}</pre>
          </div>
          <div
            v-else-if="section.type === 'call' && isAskUserTool(section.name)"
            class="ask-user-card"
          >
            <div class="ask-user-card-header">
              <NText strong>{{ t('chat.askUser') }}</NText>
              <NText v-if="section.running && !section.result" depth="3">
                {{ t('chat.waitingYourAnswer') }}
              </NText>
            </div>
            <pre
              v-if="section.result && !askResult(section)"
              class="tool-result"
            >{{ section.result }}</pre>
            <AskUserPrompt
              v-else-if="
                askUserView(section).question &&
                (askResult(section) || askUserView(section).interactive)
              "
              :question="askUserView(section).question!"
              :options="askUserView(section).options"
              :answered="askResult(section)"
              :status-text="null"
              @submit="(choice) => handleResolveAskUser(section.id, choice)"
              @cancel="handleCancelAskUser(section.id)"
            />
            <NText
              v-else-if="askUserView(section).statusText"
              depth="3"
            >
              {{ askUserView(section).statusText }}
            </NText>
            <NText v-else-if="section.argsStreaming" depth="3">
              {{ t('chat.generatingQuestion') }}
            </NText>
            <NText v-else depth="3">
              {{ t('chat.waitingTool') }}
            </NText>
          </div>
          <ElCollapse
            v-else-if="
              section.type === 'call' &&
              groupedLeadKindAt(index)
            "
            v-model="groupedCallActiveKeys[groupedLeadKindAt(index)!]"
            :class="
              groupedCalls[groupedLeadKindAt(index)!].running
                ? 'tool-call-collapse tool-call-running'
                : 'tool-call-collapse'
            "
            :data-risk="groupRisk(groupedLeadKindAt(index)!) ?? undefined"
          >
            <ElCollapseItem name="group">
              <template #title>
                <span class="tool-call-label">
                  <span
                    v-if="groupRisk(groupedLeadKindAt(index)!)"
                    class="tool-call-risk-bar"
                    :data-risk="groupRisk(groupedLeadKindAt(index)!)"
                  />
                  <span class="tool-call-name">
                    {{ groupedCalls[groupedLeadKindAt(index)!].label }}
                  </span>
                  <span class="tool-call-inline-params">
                    {{ t('chat.timesCount', { n: groupedCalls[groupedLeadKindAt(index)!].calls.length }) }}
                    <template v-if="groupedCallLatest(groupedLeadKindAt(index)!)">
                      {{ t('chat.latestTool', { name: displayToolName(groupedCallLatest(groupedLeadKindAt(index)!)!.name) }) }}
                    </template>
                  </span>
                  <ElTag
                    v-if="riskTagLabel(groupRisk(groupedLeadKindAt(index)!))"
                    size="small"
                    class="tool-call-risk-tag"
                    :data-risk="groupRisk(groupedLeadKindAt(index)!)"
                    effect="plain"
                  >
                    {{ riskTagLabel(groupRisk(groupedLeadKindAt(index)!)) }}
                  </ElTag>
                  <NText
                    v-if="groupedCalls[groupedLeadKindAt(index)!].running"
                    depth="3"
                    class="tool-call-status"
                  >
                    {{ t('chat.running') }}
                  </NText>
                </span>
              </template>
              <div class="tool-call-body">
                <div
                  v-for="entry in groupedCallEntries(groupedLeadKindAt(index)!)"
                  :key="entry.section.id"
                  class="tool-display-lines"
                  style="margin-bottom: 8px"
                >
                  <NText>
                    {{ displayToolName(entry.section.name) }}
                  </NText>
                  <NText
                    v-if="toolHeaderParamPreview(entry.section)"
                    depth="3"
                  >
                    {{ toolHeaderParamPreview(entry.section) }}
                  </NText>
                  <NText
                    v-if="entry.section.running"
                    depth="3"
                  >
                    {{ entry.section.argsStreaming ? t('chat.generatingArgs') : t('chat.running') }}
                  </NText>
                  <NText
                    v-else-if="toolResultPreview(entry.section)"
                    depth="3"
                  >
                    {{ toolResultPreview(entry.section) }}
                  </NText>
                </div>
              </div>
            </ElCollapseItem>
          </ElCollapse>
          <ElCollapse
            v-else-if="
              section.type === 'call' &&
              !groupedLeadKindAt(index) &&
              !callGroupKind(section) &&
              !isAskUserTool(section.name)
            "
            v-model="callActiveKeys[index]"
            :class="
              section.running
                ? 'tool-call-collapse tool-call-running'
                : 'tool-call-collapse'
            "
            :data-risk="callRisk(section) ?? undefined"
          >
            <ElCollapseItem name="call">
              <template #title>
                <span class="tool-call-label">
                  <span
                    v-if="callRisk(section)"
                    class="tool-call-risk-bar"
                    :data-risk="callRisk(section)"
                  />
                  <span class="tool-call-name">{{ displayToolName(section.name) }}</span>
                  <span
                    v-if="toolHeaderParamPreview(section)"
                    class="tool-call-inline-params"
                  >
                    {{ toolHeaderParamPreview(section) }}
                  </span>
                  <ElTag
                    v-if="riskTagLabel(callRisk(section))"
                    size="small"
                    class="tool-call-risk-tag"
                    :data-risk="callRisk(section)"
                    effect="plain"
                  >
                    {{ riskTagLabel(callRisk(section)) }}
                  </ElTag>
                  <NText
                    v-if="section.running"
                    depth="3"
                    class="tool-call-status"
                  >
                    {{ section.argsStreaming ? t('chat.generatingArgs') : t('chat.running') }}
                  </NText>
                </span>
              </template>
              <div
                v-if="isFileWriteToolName(section.name)"
                class="tool-call-body"
              >
                <NText
                  v-if="parseStreamingFileWriteArgs(section.arguments).path"
                  class="tool-write-path"
                  code
                >
                  {{ parseStreamingFileWriteArgs(section.arguments).path }}
                </NText>
                <NText
                  v-else-if="section.argsStreaming"
                  depth="3"
                >
                  {{ t('chat.resolvingPath') }}
                </NText>
                <FileWriteDiff
                  v-if="
                    !section.running &&
                    (section.diffText !== undefined ||
                      (section.before !== undefined &&
                        section.after !== undefined))
                  "
                  :before="section.before"
                  :after="section.after"
                  :diff="section.diffText"
                  :created="section.created"
                />
                <pre
                  v-else-if="
                    section.argsStreaming ||
                    parseStreamingFileWriteArgs(section.arguments).content !== undefined
                  "
                  class="tool-write-stream"
                >
                  {{ parseStreamingFileWriteArgs(section.arguments).content ?? '' }}<span
                    v-if="section.argsStreaming"
                    class="tool-write-cursor"
                  >▍</span>
                </pre>
                <NText
                  v-if="section.running && !section.result && !section.argsStreaming"
                  depth="3"
                  class="tool-write-status"
                >
                  {{ t('chat.writingFile') }}
                </NText>
                <pre v-if="section.result" class="tool-result">{{ section.result }}</pre>
                <NText
                  v-if="
                    !parseStreamingFileWriteArgs(section.arguments).path &&
                    !section.argsStreaming &&
                    parseStreamingFileWriteArgs(section.arguments).content === undefined &&
                    !section.result &&
                    !(section.running && !section.result && !section.argsStreaming) &&
                    !(
                      !section.running &&
                      (section.diffText !== undefined ||
                        (section.before !== undefined &&
                          section.after !== undefined))
                    )
                  "
                  depth="3"
                >
                  {{
                    parseStreamingFileWriteArgs(section.arguments).complete
                      ? t('chat.waitingTool')
                      : t('chat.preparingWrite')
                  }}
                </NText>
              </div>
              <div v-else class="tool-call-body">
                <div
                  v-if="getToolDisplayView(section).paramLines.length"
                  class="tool-display-lines"
                >
                  <NText
                    v-for="(line, lineIndex) in getToolDisplayView(section).paramLines"
                    :key="`${section.id}-param-${lineIndex}`"
                    depth="3"
                  >
                    {{ line }}
                  </NText>
                </div>
                <pre
                  v-if="getToolDisplayView(section).rawParams"
                  class="tool-args"
                >{{ getToolDisplayView(section).rawParams }}</pre>
                <div
                  v-if="getToolDisplayView(section).resultLines.length"
                  class="tool-display-lines"
                >
                  <NText
                    v-for="(line, lineIndex) in getToolDisplayView(section).resultLines"
                    :key="`${section.id}-result-${lineIndex}`"
                    depth="3"
                  >
                    {{ line }}
                  </NText>
                </div>
                <pre
                  v-if="getToolDisplayView(section).rawResult"
                  class="tool-result"
                >{{ getToolDisplayView(section).rawResult }}</pre>
                <NText
                  v-if="
                    section.running &&
                    !section.result &&
                    !getToolDisplayView(section).resultLines.length
                  "
                  depth="3"
                >
                  {{ t('chat.runningEllipsis') }}
                </NText>
                <NText
                  v-else-if="
                    !section.arguments &&
                    !section.result &&
                    !getToolDisplayView(section).paramLines.length
                  "
                  depth="3"
                >
                  {{ t('chat.waitingTool') }}
                </NText>
              </div>
            </ElCollapseItem>
          </ElCollapse>
        </div>
        </template>
      </template>
      <NSpace v-if="!isUser && live && message.sections.length === 0">
        <NSpin size="small" />
        <NText depth="3">{{ t('chat.generating') }}</NText>
      </NSpace>
    </div>
    <div
      v-if="!isUser && messageChangedFiles.length > 0"
      class="message-changed-files-card"
    >
      <div class="message-changed-files-card-header">
        <NIcon :component="DocumentOutline" class="message-changed-files-card-icon" />
        <NText class="message-changed-files-card-title">
          {{ t('chat.messageChangedFiles') }}
        </NText>
        <NText depth="3" class="message-changed-files-card-count">
          {{ messageChangedFiles.length }}
        </NText>
        <ElButton
          v-if="messageChangedFiles.length > CHANGED_FILES_COLLAPSED_COUNT"
          class="message-changed-files-toggle"
          text
          size="small"
          @click="changedFilesExpanded = !changedFilesExpanded"
        >
          {{
            changedFilesExpanded
              ? t('chat.changedFilesCollapse')
              : t('chat.changedFilesExpand', { n: messageChangedFiles.length })
          }}
        </ElButton>
      </div>
      <div class="message-changed-files-card-list">
        <CottageTooltip
          v-for="file in visibleChangedFiles"
          :key="file.path"
          :content="file.path"
          placement="top"
          delay="lazy"
        >
          <button
            type="button"
            :class="
              file.path === workspaceStore.selectedPath
                ? 'message-changed-files-item message-changed-files-item-active'
                : 'message-changed-files-item'
            "
            @click="selectChangedFile(file.path)"
          >
            <span class="message-changed-files-path">{{ file.path }}</span>
            <span class="message-changed-files-kind" :data-kind="file.kind">
              {{ changedFileKindLabel(file.kind) }}
            </span>
          </button>
        </CottageTooltip>
      </div>
    </div>
    <div v-if="message.error" class="message-error-banner" role="alert">
      <div class="message-error-banner-main">
        <NIcon
          :component="AlertCircleOutline"
          class="message-error-banner-icon"
        />
        <div class="message-error-banner-copy">
          <div class="message-error-banner-title">
            {{ t('chat.turnErrorTitle') }}
          </div>
          <div class="message-error-banner-detail">{{ message.error }}</div>
        </div>
      </div>
      <ElButton
        v-if="!isUser"
        class="message-error-banner-retry"
        type="danger"
        size="small"
        plain
        :disabled="chatBusy || retrying"
        :loading="retrying"
        @click="onRetryAfterError"
      >
        <template #icon>
          <NIcon :component="RefreshOutline" />
        </template>
        {{ t('chat.retryTurn') }}
      </ElButton>
    </div>
    <div
      v-if="showAssistantToolbar"
      class="message-assistant-toolbar"
    >
      <NText v-if="outputCompletedAtLabel" depth="3" class="message-assistant-time">
        {{ outputCompletedAtLabel }}
      </NText>
      <div class="message-assistant-actions">
        <CottageTooltip :content="t('chat.copyOutputHint')" placement="top" delay="lazy">
          <ElButton
            class="message-assistant-action-btn"
            text
            size="small"
            :disabled="copying"
            :loading="copying"
            @click="onCopyAssistantOutput"
          >
            <template #icon>
              <NIcon :component="copied ? CheckmarkOutline : CopyOutline" />
            </template>
            {{ copied ? t('chat.copiedOutput') : t('chat.copyOutput') }}
          </ElButton>
        </CottageTooltip>
        <CottageTooltip :content="t('chat.forkChatHint')" placement="top" delay="normal">
          <ElButton
            class="message-assistant-action-btn"
            text
            size="small"
            :disabled="chatBusy || forking || !canForkFromMessage"
            :loading="forking"
            @click="onForkFromAssistantMessage"
          >
            <template #icon>
              <NIcon :component="GitBranchOutline" />
            </template>
            {{ t('chat.forkChat') }}
          </ElButton>
        </CottageTooltip>
      </div>
    </div>
  </div>
</template>
