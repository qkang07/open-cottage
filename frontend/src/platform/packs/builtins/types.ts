import type { CottageTool } from '@/agent/runtime/tool';
import type { CapabilityDomain, CapabilityRiskLevel } from '../../capabilities/types';
import type { OptionalToolGroupId } from '../../../agent/toolCatalog';
import type { CottageServiceClient } from '../../../cottageService/client';

export interface BuiltinPackToolContext {
  enabledTools: readonly string[];
  onWorkspaceMutate?: () => void | Promise<void>;
  /** 已连接的 Cottage Service 客户端（供网页自动化等需要本地服务的包使用） */
  cottageService?: CottageServiceClient;
  /**
   * 用户启用的路由能力（search / fetch / proxy）。
   * 与服务端声明的完整 capability 列表不同，勿用于判断网页自动化等硬依赖。
   */
  cottageServiceCapabilities?: string[];
  /** 服务端声明的完整 capability（screenshot / extract / browser 等） */
  cottageServiceServerCapabilities?: string[];
}

/**
 * 内置能力包：等价于「内建的一个领域 Agent 扩展」，
 * 聚合工具、提示词与能力声明，可由用户手动或意图识别启用。
 */
export interface BuiltinCapabilityPack {
  id: string;
  name: string;
  domain: CapabilityDomain;
  description: string;
  /** 关联聊天区可选工具分组（启用开关） */
  groupId: OptionalToolGroupId;
  /** 该包提供的工具名 */
  toolNames: readonly string[];
  /** 该包覆盖的能力 id（对应 BUILTIN_CAPABILITIES） */
  capabilityIds: readonly string[];
  /** 启用后注入 system prompt 的领域指引（提示词 + 技能要点） */
  promptOverlay: string;
  /** 该包整体风险级别（用于治理展示） */
  riskLevel: CapabilityRiskLevel;
  /** 触发意图识别启用的关键词（用于自动建议） */
  intentKeywords: readonly string[];
  /**
   * 依赖 Cottage Service：需已连接，且服务声明这些 capability 后才可启用/挂载。
   * 例如网页自动化需要 screenshot / extract / browser。
   */
  requiresCottageServiceCapabilities?: readonly string[];
  createTools: (ctx: BuiltinPackToolContext) => CottageTool[];
}
