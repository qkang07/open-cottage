import type { CottageAgent } from '../../agent/CottageAgent';
import { buildCottageSystemPrompt } from '../../agent/constants';
import type { StoredMessage } from '../../agent/messages';
import {
  BASE_TOOL_NAMES,
  OPTIONAL_TOOL_NAMES,
  normalizeEnabledTools,
} from '../../agent/toolCatalog';
import { TOOL_DESCRIPTIONS } from '../../agent/toolDescriptions';
import { loadSessionSnapshot } from '../../config/chatSessions';
import type {
  ChatSessionMeta,
  ChatSessionRuntimeMeta,
  LlmModelConfig,
} from '../../config/constants';
import { normalizeProviderId, providerLabel } from '../../config/llmProviders';
import { getActiveModelPreset, getCottageConfig, getLlmConfig } from '../../config/store';
import type { ToolCallInteraction } from '../../chat/toolCallInteraction';
import {
  loadSessionProjectedState,
  type SessionEvent,
  type SessionToolInteractionEvent,
} from '../../session/eventLog';
import type { TraceEvent } from '../trace';

/**
 * 活跃会话：把内存里尚未（或未能）落盘的 tool_interaction 合并进时间线，
 * 避免审批等待期间 Debug 只看到磁盘投影而丢卡片。
 */
function mergeLiveToolInteractions(
  events: SessionEvent[],
  history: readonly StoredMessage[],
): SessionEvent[] {
  const latestByCall = new Map<string, ToolCallInteraction['status']>();
  for (const event of events) {
    if (event.type === 'tool_interaction') {
      latestByCall.set(event.callId, event.interaction.status);
    }
  }
  const extras: SessionToolInteractionEvent[] = [];
  for (const message of history) {
    if (message.role !== 'assistant' || !message.toolCalls) continue;
    for (const call of message.toolCalls) {
      if (!call.interaction) continue;
      if (latestByCall.get(call.id) === call.interaction.status) continue;
      extras.push({
        type: 'tool_interaction',
        at: Date.now(),
        callId: call.id,
        interaction: call.interaction,
      });
      latestByCall.set(call.id, call.interaction.status);
    }
  }
  return extras.length ? [...events, ...extras] : events;
}

export interface DebugToolInfo {
  name: string;
  description?: string;
}

export interface SessionDebugDetail {
  meta: ChatSessionMeta;
  isActive: boolean;
  modelLabel: string;
  modelConfig: LlmModelConfig | null;
  configNote: string | null;
  runtimeCapturedAt: number | null;
  systemPrompt: string;
  tools: DebugToolInfo[];
  /** 完整展示 transcript（压缩后仍保留） */
  rawHistory: StoredMessage[];
  /** 发给模型的上下文投影 */
  llmHistory: StoredMessage[];
  messageCount: number;
  llmMessageCount: number;
  /** 执行/诊断事件（含 compaction） */
  diagnostics: TraceEvent[];
  events: SessionEvent[];
}

function formatModelLabel(
  config: LlmModelConfig | null | undefined,
  runtime?: ChatSessionRuntimeMeta | null,
): string {
  if (!config) return '未配置';
  const provider = providerLabel(normalizeProviderId(config.provider));
  const presetName = runtime?.activePresetName;
  const presetSuffix = presetName ? `（预设：${presetName}）` : '';
  if (presetSuffix) {
    return `${provider} / ${config.model}${presetSuffix}`;
  }
  const preset = getActiveModelPreset();
  const liveSuffix =
    preset &&
    preset.config.provider === config.provider &&
    preset.config.model === config.model
      ? `（预设：${preset.name}）`
      : '';
  return `${provider} / ${config.model}${liveSuffix}`;
}

function buildGlobalToolList(): DebugToolInfo[] {
  const enabled = normalizeEnabledTools(getCottageConfig().enabledTools) ?? [];
  const names = [
    ...BASE_TOOL_NAMES,
    ...OPTIONAL_TOOL_NAMES.filter((n) => enabled.includes(n)),
    'askUser',
    'submitExecutionPlan',
    'searchWorkspaceSemantic',
  ];
  const unique = [...new Set(names)];
  return unique.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
  }));
}

function buildGlobalSystemPrompt(): string {
  return buildCottageSystemPrompt(
    getCottageConfig().enabledTools,
    undefined,
    undefined,
    undefined,
    Boolean(getCottageConfig().platform?.planGate?.enabled),
  );
}

function detailFromRuntime(
  meta: ChatSessionMeta,
  runtime: ChatSessionRuntimeMeta,
  rawHistory: StoredMessage[],
  llmHistory: StoredMessage[],
  diagnostics: TraceEvent[],
  events: SessionEvent[],
  isActive: boolean,
): SessionDebugDetail {
  return {
    meta,
    isActive,
    modelLabel: formatModelLabel(runtime.modelConfig, runtime),
    modelConfig: runtime.modelConfig,
    configNote: null,
    runtimeCapturedAt: runtime.capturedAt,
    systemPrompt: runtime.systemPrompt,
    tools: runtime.tools,
    rawHistory,
    llmHistory,
    messageCount: rawHistory.length,
    llmMessageCount: llmHistory.length,
    diagnostics,
    events,
  };
}

export async function loadSessionDebugDetail(
  meta: ChatSessionMeta,
  activeAgent: CottageAgent | null,
  activeChatId: string | null,
): Promise<SessionDebugDetail> {
  const isActive = activeChatId === meta.id && activeAgent !== null;
  if (isActive && activeAgent) {
    await activeAgent.getTraceRecorder()?.flush();
  }
  const projected = await loadSessionProjectedState(meta.id);
  const snapshot = await loadSessionSnapshot(meta.id);

  if (isActive && activeAgent) {
    const debug = activeAgent.getDebugInfo();
    const modelConfig = activeAgent.getModelConfig() ?? getLlmConfig() ?? null;
    const history = activeAgent.getChatHistory();
    const llmHistory = activeAgent.getLlmHistory();
    return {
      meta,
      isActive: true,
      modelLabel: formatModelLabel(modelConfig),
      modelConfig,
      configNote: null,
      runtimeCapturedAt: Date.now(),
      systemPrompt: debug.systemPrompt,
      tools: debug.tools,
      rawHistory: history,
      llmHistory,
      messageCount: history.length,
      llmMessageCount: llmHistory.length,
      diagnostics: projected.diagnostics,
      events: mergeLiveToolInteractions(projected.events, history),
    };
  }

  if (snapshot.runtime) {
    return detailFromRuntime(
      meta,
      snapshot.runtime,
      projected.transcript.length ? projected.transcript : snapshot.history,
      projected.llmHistory.length
        ? projected.llmHistory
        : (snapshot.llmHistory ?? snapshot.history),
      projected.diagnostics,
      projected.events,
      false,
    );
  }

  const modelConfig = getLlmConfig() ?? null;
  const transcript = projected.transcript.length
    ? projected.transcript
    : snapshot.history;
  const llmHistory = projected.llmHistory.length
    ? projected.llmHistory
    : (snapshot.llmHistory ?? transcript);
  return {
    meta,
    isActive: false,
    modelLabel: formatModelLabel(modelConfig),
    modelConfig,
    configNote: '此会话尚未记录运行时配置（旧版数据，发送新消息后将自动补齐）',
    runtimeCapturedAt: null,
    systemPrompt: buildGlobalSystemPrompt(),
    tools: buildGlobalToolList(),
    rawHistory: transcript,
    llmHistory,
    messageCount: transcript.length,
    llmMessageCount: llmHistory.length,
    diagnostics: projected.diagnostics,
    events: projected.events,
  };
}
