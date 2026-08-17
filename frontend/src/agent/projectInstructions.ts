import { workspace } from '../workspace/FileSystemWorkspace';

/** 注入系统提示的项目约定文件（按优先级尝试） */
export const PROJECT_INSTRUCTION_CANDIDATES = [
  'AGENTS.md',
  'AGENT.md',
  'agents.md',
  'agent.md',
] as const;

/** 项目约定注入上限（字符）；超限截断并提示用 readFile */
export const PROJECT_INSTRUCTIONS_MAX_CHARS = 30_000;

export interface ProjectInstructionsPayload {
  path: string;
  content: string;
  truncated: boolean;
  totalChars: number;
}

/**
 * 读取工作区根目录的 AGENTS.md / AGENT.md（若存在）。
 * 超长时截断，避免撑爆 system prompt。
 */
export const loadProjectInstructions = async (): Promise<
  ProjectInstructionsPayload | null
> => {
  if (!workspace.isOpen) return null;

  for (const candidate of PROJECT_INSTRUCTION_CANDIDATES) {
    try {
      if (!(await workspace.exists(candidate))) continue;
      const kind = await workspace.getEntryKind(candidate);
      if (kind !== 'file') continue;
      const { content } = await workspace.readFile(candidate);
      const trimmed = content.trim();
      if (!trimmed) continue;
      const truncated = trimmed.length > PROJECT_INSTRUCTIONS_MAX_CHARS;
      return {
        path: candidate,
        content: truncated
          ? trimmed.slice(0, PROJECT_INSTRUCTIONS_MAX_CHARS)
          : trimmed,
        truncated,
        totalChars: trimmed.length,
      };
    } catch {
      // 尝试下一个候选名
    }
  }
  return null;
};

export const formatProjectInstructionsPromptBlock = (
  payload: ProjectInstructionsPayload | null | undefined,
): string => {
  if (!payload?.content) return '';
  const note = payload.truncated
    ? `\n（已截断：全文 ${payload.totalChars} 字符，完整内容请 readFile("${payload.path}")）`
    : '';
  return [
    '',
    `<project_instructions path="${payload.path}">`,
    payload.content + note,
    '</project_instructions>',
  ].join('\n');
};

export const loadProjectInstructionsBlock = async (): Promise<string> => {
  const payload = await loadProjectInstructions();
  return formatProjectInstructionsPromptBlock(payload);
};
