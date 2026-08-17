import { TOOL_DESCRIPTIONS, TOOL_RISK } from '../../agent/toolDescriptions';
import type { CapabilityRiskLevel } from '../capabilities/types';
import { BASE_PACK, type BaseCapabilityPack, type BuiltinCapabilityPack } from './builtins';
import type { CapabilityPackManifest } from './types';

export type PackSource = 'base' | 'builtin' | 'external';

export interface PackToolInfo {
  name: string;
  description?: string;
  riskLevel?: CapabilityRiskLevel;
}

export interface PackSkillInfo {
  file: string;
  content?: string;
}

/** 能力包详情统一视图模型（基础包 / 内置包 / 外部包共用） */
export interface PackDetail {
  id: string;
  name: string;
  description?: string;
  source: PackSource;
  domain?: string;
  riskLevel?: CapabilityRiskLevel;
  alwaysOn?: boolean;
  version?: string;
  tools: PackToolInfo[];
  skills: PackSkillInfo[];
  promptOverlay?: string;
  capabilities?: string[];
  mcpServerNames?: string[];
}

const toToolInfos = (names: readonly string[]): PackToolInfo[] =>
  names.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    riskLevel: TOOL_RISK[name],
  }));

export const basePackDetail = (
  pack: BaseCapabilityPack = BASE_PACK,
): PackDetail => ({
  id: pack.id,
  name: pack.name,
  description: pack.description,
  source: 'base',
  riskLevel: pack.riskLevel,
  alwaysOn: true,
  tools: toToolInfos(pack.toolNames),
  skills: [],
  promptOverlay: pack.promptOverlay,
});

export const builtinPackDetail = (pack: BuiltinCapabilityPack): PackDetail => ({
  id: pack.id,
  name: pack.name,
  description: pack.description,
  source: 'builtin',
  domain: pack.domain,
  riskLevel: pack.riskLevel,
  tools: toToolInfos(pack.toolNames),
  skills: [],
  promptOverlay: pack.promptOverlay,
  capabilities: [...pack.capabilityIds],
});

export const externalPackDetail = (
  id: string,
  manifest: CapabilityPackManifest | null,
  version?: string,
): PackDetail => {
  const toolNames = new Set<string>();
  for (const cap of manifest?.capabilities ?? []) {
    for (const t of cap.tools ?? []) toolNames.add(t);
  }
  for (const t of manifest?.suggestedTools ?? []) toolNames.add(t);
  return {
    id,
    name: manifest?.name ?? id,
    description: manifest?.description,
    source: 'external',
    riskLevel: manifest?.riskLevel,
    version: version ?? manifest?.version,
    tools: toToolInfos([...toolNames]),
    skills: (manifest?.skills ?? []).map((s) => ({
      file: s.file,
      content: s.content,
    })),
    promptOverlay: manifest?.promptOverlay,
    capabilities: (manifest?.capabilities ?? []).map((c) => c.id),
    mcpServerNames: (manifest?.mcpServers ?? []).map(
      (s) => s.name || s.id,
    ),
  };
};
