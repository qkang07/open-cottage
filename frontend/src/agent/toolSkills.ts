import type { CottageTool } from '@/agent/runtime/tool';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { TOOL_DESCRIPTIONS } from './toolDescriptions';

/** 始终绑定给模型的基础文件工具（高频） */
export const CORE_FILE_TOOL_NAMES = [
  'listDirectory',
  'findFiles',
  'searchFiles',
  'readFile',
  'editFile',
  'writeFile',
  'createFile',
  'deleteFiles',
  'mkdir',
  'rename',
  'copy',
] as const;

/**
 * 默认不绑定、仅在 system 中列目录；
 * 需通过 loadTools 加载 skill 并激活后才能调用。
 */
export const DEFERRED_FILE_TOOL_NAMES = [
  'listFiles',
  'exists',
  'statFile',
  'hashFile',
  'getDirectorySize',
  'readMany',
  'diffFiles',
  'patchFile',
  'applyPatch',
  'appendFile',
  'touch',
  'move',
  'copyPaths',
  'compress',
  'extract',
  'runScript',
] as const;

/** 同样按需加载的非文件工具（历史 / RAG） */
export const DEFERRED_OPTIONAL_TOOL_NAMES = [
  'searchWorkspaceSemantic',
] as const;

export const LOAD_TOOLS_TOOL_NAME = 'loadTools';

export type CoreFileToolName = (typeof CORE_FILE_TOOL_NAMES)[number];
export type DeferredFileToolName = (typeof DEFERRED_FILE_TOOL_NAMES)[number];

const CORE_FILE_SET = new Set<string>(CORE_FILE_TOOL_NAMES);
const DEFERRED_FILE_SET = new Set<string>(DEFERRED_FILE_TOOL_NAMES);

export const isCoreFileToolName = (name: string): boolean =>
  CORE_FILE_SET.has(name);

export const isDeferredFileToolName = (name: string): boolean =>
  DEFERRED_FILE_SET.has(name);

export const partitionFileTools = (
  tools: readonly CottageTool[],
): {
  core: CottageTool[];
  deferred: CottageTool[];
} => {
  const core: CottageTool[] = [];
  const deferred: CottageTool[] = [];
  for (const tool of tools) {
    if (isDeferredFileToolName(tool.name)) deferred.push(tool);
    else if (isCoreFileToolName(tool.name)) core.push(tool);
    else deferred.push(tool); // 未知新工具默认延后，避免撑爆 schema
  }
  return { core, deferred };
};

export const toolSkillSummary = (name: string): string =>
  TOOL_DESCRIPTIONS[name] ?? name;

/** 注入 system：延后工具目录（类似 available_skills） */
export const formatDeferredToolsPromptBlock = (
  deferredNames: readonly string[],
): string => {
  if (!deferredNames.length) return '';
  const items = [...deferredNames]
    .sort((a, b) => a.localeCompare(b))
    .map(
      (name) =>
        `<deferred_tool name="${name}">${toolSkillSummary(name)}</deferred_tool>`,
    )
    .join('\n');
  return [
    '',
    `<available_deferred_tools description="以下工具默认未挂载，不在当前可调用列表中。需要使用时先调用 loadTools({ names: [\"工具名\"] })：系统会返回该工具的完整 skill（参数说明），并在本回合后续步骤中启用它。可一次加载多个。">`,
    items,
    '</available_deferred_tools>',
  ].join('\n');
};

const zodSchemaToJson = (schema: unknown): unknown => {
  if (!schema || typeof schema !== 'object') return {};
  try {
    return zodToJsonSchema(schema as z.ZodTypeAny, {
      $refStrategy: 'none',
      target: 'openApi3',
    });
  } catch {
    return { note: 'schema 无法序列化，请参考 description' };
  }
};

/** 生成单个工具的 skill markdown（供 loadTools 返回） */
export const buildToolSkillMarkdown = (
  tool: CottageTool,
): string => {
  const parameters = zodSchemaToJson(
    (tool as { schema?: unknown }).schema,
  );
  return [
    `# Tool: ${tool.name}`,
    '',
    tool.description?.trim() || toolSkillSummary(tool.name),
    '',
    '## Parameters (JSON Schema)',
    '```json',
    JSON.stringify(parameters, null, 2),
    '```',
    '',
    `加载后可直接调用 \`${tool.name}\`，无需再 loadTools。`,
  ].join('\n');
};
