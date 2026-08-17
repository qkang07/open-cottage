/**
 * 会话运行时元信息构建。
 * 从当前 Agent 实例提取模型配置、系统提示词、工具列表等快照。
 */

import type { CottageAgent } from '../agent/CottageAgent';
import type { ChatSessionRuntimeMeta } from './constants';
import { getCottageConfig, getLlmConfig } from './store';

/** 构建会话运行时元信息快照（模型配置、系统提示词、工具列表等） */
export function buildSessionRuntimeMeta(agent: CottageAgent): ChatSessionRuntimeMeta {
  const debug = agent.getDebugInfo();
  const identity = agent.getModelRuntimeIdentity();
  const preset = getCottageConfig().modelPresets?.find(
    (candidate) =>
      candidate.id === identity.presetId ||
      (candidate.config.provider === identity.provider &&
        candidate.config.model === identity.model &&
        (candidate.config.connectionId?.trim() || undefined) ===
          identity.connectionId),
  );
  return {
    capturedAt: Date.now(),
    modelConfig: agent.getModelConfig() ?? getLlmConfig() ?? null,
    activePresetId: identity.presetId ?? preset?.id,
    activePresetName: identity.presetName ?? preset?.name,
    systemPrompt: debug.systemPrompt,
    tools: debug.tools,
    enabledTools: getCottageConfig().enabledTools,
    mode: agent.getAgentMode(),
    inFlight: agent.isInFlight(),
    lastTurnStartedAt: agent.getTurnStartedAt() ?? undefined,
  };
}
