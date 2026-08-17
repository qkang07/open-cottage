import type { CottageTool } from '@/agent/runtime/tool';
import { CODING_PACK } from './coding';
import { DATA_ANALYSIS_PACK } from './dataAnalysis';
import { OFFICE_PACK } from './office';
import { WEB_AUTOMATION_PACK } from './webAutomation';
import { PDF_PACK } from './pdf';
import { CHART_PACK } from './chart';
import { IMAGE_GEN_PACK } from './imageGen';
import { DEEP_RESEARCH_PACK } from './deepResearch';
import { WORKSPACE_TIDY_PACK } from './tidy';
import type { BuiltinCapabilityPack, BuiltinPackToolContext } from './types';

export * from './types';
export { BASE_PACK } from './base';
export type { BaseCapabilityPack } from './base';
export {
  OFFICE_PACK,
  CODING_PACK,
  DATA_ANALYSIS_PACK,
  WEB_AUTOMATION_PACK,
  PDF_PACK,
  CHART_PACK,
  IMAGE_GEN_PACK,
  DEEP_RESEARCH_PACK,
  WORKSPACE_TIDY_PACK,
};

export const BUILTIN_PACKS: readonly BuiltinCapabilityPack[] = [
  OFFICE_PACK,
  CODING_PACK,
  DATA_ANALYSIS_PACK,
  WEB_AUTOMATION_PACK,
  PDF_PACK,
  CHART_PACK,
  IMAGE_GEN_PACK,
  DEEP_RESEARCH_PACK,
  WORKSPACE_TIDY_PACK,
];

const hasAnyEnabledTool = (
  pack: BuiltinCapabilityPack,
  enabledTools: readonly string[],
): boolean => {
  const set = new Set(enabledTools);
  return pack.toolNames.some((name) => set.has(name));
};

export type CottageServiceAvailability = {
  connected: boolean;
  /** 服务声明的 capability；未提供时仅校验是否已连接 */
  capabilities?: readonly string[];
};

/**
 * 判断内置能力包对 Cottage Service 的依赖是否满足。
 * 无 requiresCottageServiceCapabilities 的包始终可用。
 */
export const isBuiltinPackAvailable = (
  pack: BuiltinCapabilityPack,
  cottage?: CottageServiceAvailability,
): boolean => {
  const required = pack.requiresCottageServiceCapabilities;
  if (!required?.length) return true;
  if (!cottage?.connected) return false;
  const caps = cottage.capabilities;
  if (!caps) return true;
  return required.every((c) => caps.includes(c));
};

/** 已启用的内置能力包（由 enabledTools 推导；可按 Cottage Service 可用性过滤） */
export const resolveEnabledBuiltinPacks = (
  enabledTools: readonly string[] | undefined,
  cottage?: CottageServiceAvailability,
): BuiltinCapabilityPack[] => {
  if (!enabledTools?.length) return [];
  return BUILTIN_PACKS.filter((pack) => {
    if (!hasAnyEnabledTool(pack, enabledTools)) return false;
    return isBuiltinPackAvailable(pack, cottage);
  });
};

const cottageAvailabilityFromCtx = (
  ctx: BuiltinPackToolContext,
): CottageServiceAvailability => ({
  connected: Boolean(ctx.cottageService),
  capabilities: ctx.cottageServiceServerCapabilities,
});

/** 装配已启用内置包的工具（依赖 Cottage Service 且未连接时跳过） */
export const createBuiltinPackTools = (
  ctx: BuiltinPackToolContext,
): CottageTool[] => {
  const cottage = cottageAvailabilityFromCtx(ctx);
  const tools: CottageTool[] = [];
  for (const pack of resolveEnabledBuiltinPacks(ctx.enabledTools, cottage)) {
    tools.push(...pack.createTools(ctx));
  }
  return tools;
};

/** 已启用内置包的提示词 overlay（依赖 Cottage Service 且未连接时跳过） */
export const builtinPackPromptOverlays = (
  enabledTools: readonly string[] | undefined,
  cottage?: CottageServiceAvailability,
): string[] =>
  resolveEnabledBuiltinPacks(enabledTools, cottage).map((pack) => pack.promptOverlay);

/**
 * 意图识别：根据用户文本建议启用的内置包（不自动启用，仅返回建议）。
 * 依赖 Cottage Service 且当前不可用的包不会被建议。
 */
export const suggestBuiltinPacksForText = (
  text: string,
  enabledTools: readonly string[] | undefined,
  cottage?: CottageServiceAvailability,
): BuiltinCapabilityPack[] => {
  const lower = text.toLowerCase();
  const enabledSet = new Set(enabledTools ?? []);
  return BUILTIN_PACKS.filter((pack) => {
    if (!isBuiltinPackAvailable(pack, cottage)) return false;
    const alreadyOn = pack.toolNames.some((n) => enabledSet.has(n));
    if (alreadyOn) return false;
    return pack.intentKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  });
};

/** 按 groupId 查找内置能力包 */
export const builtinPackByGroupId = (
  groupId: string,
): BuiltinCapabilityPack | undefined =>
  BUILTIN_PACKS.find((pack) => pack.groupId === groupId);
