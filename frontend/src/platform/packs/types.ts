import type {
  InstalledCapabilityPackRef,
  McpServerConfig,
} from '../../config/constants';
import type { Capability, CapabilityRiskLevel } from '../capabilities/types';

export type { InstalledCapabilityPackRef, CapabilityPacksConfig } from '../../config/constants';

export const CAPABILITY_PACK_SCHEMA = 'cottage-capability-pack-v1' as const;

export interface CapabilityPackSkill {
  /** 文件名（不含路径），如 review-checklist.md */
  file: string;
  /** 完整 markdown 内容（可含 frontmatter） */
  content: string;
}

export interface CapabilityPackManifest {
  schema: typeof CAPABILITY_PACK_SCHEMA;
  id: string;
  name: string;
  version: string;
  description?: string;
  /** 注册到 Capability Registry 的能力条目 */
  capabilities?: Capability[];
  /** 注入 system prompt 的附加说明（也可写在包目录 prompt.md） */
  promptOverlay?: string;
  /** 安装时写入 .cottage/packs/{id}/skills/ */
  skills?: CapabilityPackSkill[];
  /** 安装时合并进工作区 MCP 配置（不自动启用全局 MCP） */
  mcpServers?: McpServerConfig[];
  /** 建议启用的可选工具名 */
  suggestedTools?: string[];
  riskLevel?: CapabilityRiskLevel;
  requiresApproval?: boolean;
}

export interface LoadedCapabilityPack {
  ref: InstalledCapabilityPackRef;
  manifest: CapabilityPackManifest;
  promptOverlay: string;
}
