import { COTTAGE_DIR, WORKSPACE_SKILLS_DIR } from '../config/constants';
import { getCottageConfig } from '../config/store';
import { listInstalledPackRefs, listPackSkillPaths } from '../platform/packs/loader';
import { workspace } from '../workspace/FileSystemWorkspace';
import { loadProjectInstructionsBlock } from './projectInstructions';

/** 小于该字符数的技能全文注入 system；更大的仅注入路径与摘要 */
export const SKILL_INLINE_MAX_CHARS = 8_000;

export interface WorkspaceSkillIndexEntry {
  path: string;
  name?: string;
  description: string;
  /** frontmatter 的 tags / domain 解析所得（小写去重），用于注入过滤 */
  tags?: string[];
  /**
   * 小技能全文（未超 SKILL_INLINE_MAX_CHARS 时由加载器填入）。
   * 有 body 时提示词内联全文；无 body 时仅索引，相关任务再 readFile。
   */
  body?: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

export const stripSkillFrontmatter = (content: string): string => {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return content;
  return content.slice(match[0].length).replace(/^\s+/, '');
};

export const parseSkillFrontmatter = (content: string): Record<string, string> => {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return {};

  const result: Record<string, string> = {};
  let currentKey: string | null = null;
  let valueLines: string[] = [];

  const flush = () => {
    if (currentKey) {
      result[currentKey] = valueLines.join('\n').trim();
    }
    currentKey = null;
    valueLines = [];
  };

  for (const line of match[1].split('\n')) {
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      flush();
      currentKey = keyMatch[1];
      const rest = keyMatch[2].trim();
      if (rest === '>-' || rest === '>' || rest === '|') {
        valueLines = [];
      } else {
        valueLines = [rest.replace(/^['"]|['"]$/g, '')];
      }
      continue;
    }
    if (currentKey && /^\s+/.test(line)) {
      valueLines.push(line.trim());
    }
  }
  flush();
  return result;
};

export const deriveSkillDescription = (
  path: string,
  content: string,
  meta: Record<string, string>,
): string => {
  const fromMeta = meta.description?.trim();
  if (fromMeta) return fromMeta;

  const body = stripSkillFrontmatter(content);
  const heading = body.match(/^#\s+(.+)$/m);
  if (heading?.[1]?.trim()) return heading[1].trim();

  const firstLine = body
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith('#'));
  if (firstLine) return firstLine.slice(0, 240);

  return path;
};

/**
 * 解析技能标签：合并 frontmatter 的 `tags` 与 `domain` 字段。
 * 兼容逗号分隔（`tags: a, b`）与 YAML 列表（`- a` 逐行）两种写法，统一转小写并去重。
 */
export const parseSkillTags = (meta: Record<string, string>): string[] => {
  const out = new Set<string>();
  const add = (raw?: string) => {
    if (!raw) return;
    for (const part of raw.split(/[,\n]/)) {
      const tag = part.replace(/^-\s*/, '').trim().toLowerCase();
      if (tag) out.add(tag);
    }
  };
  add(meta.tags);
  add(meta.domain);
  return [...out];
};

/**
 * 按 activeTags 白名单筛选可注入系统提示词的技能。
 * 白名单为空时返回全部；否则保留「无标签」或「命中任一所选标签」的技能。
 */
export const selectInjectableSkills = (
  entries: readonly WorkspaceSkillIndexEntry[],
  activeTags?: readonly string[],
): WorkspaceSkillIndexEntry[] => {
  const active = (activeTags ?? [])
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!active.length) return [...entries];
  const set = new Set(active);
  return entries.filter(
    (e) => !e.tags?.length || e.tags.some((t) => set.has(t)),
  );
};

export const formatWorkspaceSkillsPromptBlock = (
  entries: readonly WorkspaceSkillIndexEntry[],
): string => {
  if (!entries.length) return '';

  const items = entries
    .map((entry) => {
      const nameAttr = entry.name ? ` name="${entry.name}"` : '';
      if (entry.body) {
        return [
          `<workspace_skill path="${entry.path}"${nameAttr} inline="true">`,
          entry.body,
          '</workspace_skill>',
        ].join('\n');
      }
      return `<workspace_skill path="${entry.path}"${nameAttr} inline="false">${entry.description}</workspace_skill>`;
    })
    .join('\n');

  return [
    '',
    '<available_skills description="工作空间 SKILLS 与已安装能力包中的技能。inline=true 的正文已完整注入；inline=false 的仅有摘要，与任务相关时再用 readFile 读取该 path。禁止用 listFiles/findFiles/listDirectory 扫描 SKILLS/ 来发现技能。">',
    items,
    '</available_skills>',
  ].join('\n');
};

const maybeInlineBody = (content: string): string | undefined => {
  if (content.length > 0 && content.length <= SKILL_INLINE_MAX_CHARS) {
    return content;
  }
  return undefined;
};

const packSkillVirtualPath = (packId: string, relativePath: string) =>
  `${COTTAGE_DIR}/packs/${packId}/skills/${relativePath.split('/').pop() ?? relativePath}`;

const loadPackSkillEntries = async (): Promise<WorkspaceSkillIndexEntry[]> => {
  if (!workspace.isOpen) return [];

  const config = getCottageConfig();
  const respectEnabled = config.skills?.respectFrontmatterEnabled ?? true;
  const refs = listInstalledPackRefs().filter((r) => r.enabled !== false);
  const entries: WorkspaceSkillIndexEntry[] = [];

  for (const ref of refs) {
    const paths = await listPackSkillPaths(ref.id);
    for (const cottagePath of paths) {
      const content = await workspace.readCottageText(cottagePath);
      if (!content?.trim()) continue;

      const meta = parseSkillFrontmatter(content);
      if (respectEnabled && meta.enabled === 'false') continue;

      const fileName = cottagePath.split('/').pop() ?? cottagePath;
      entries.push({
        path: packSkillVirtualPath(ref.id, fileName),
        name: meta.name?.trim() || ref.id,
        description: deriveSkillDescription(cottagePath, content, meta),
        tags: parseSkillTags(meta),
        body: maybeInlineBody(content),
      });
    }
  }

  return entries;
};

export const loadWorkspaceSkillsIndex = async (): Promise<
  WorkspaceSkillIndexEntry[]
> => {
  if (!workspace.isOpen) return [];

  const kind = await workspace.getEntryKind(WORKSPACE_SKILLS_DIR);
  const packEntries = await loadPackSkillEntries();

  if (kind !== 'directory') {
    return packEntries.sort((a, b) => a.path.localeCompare(b.path));
  }

  const paths = (await workspace.listFiles(WORKSPACE_SKILLS_DIR)).filter((p) =>
    p.toLowerCase().endsWith('.md'),
  );

  const config = getCottageConfig();
  const respectEnabled = config.skills?.respectFrontmatterEnabled ?? true;

  const entries: WorkspaceSkillIndexEntry[] = [...packEntries];

  for (const path of paths) {
    const { content } = await workspace.readFile(path);
    if (!content.trim()) continue;

    const meta = parseSkillFrontmatter(content);

    // 尊重 frontmatter enabled 字段：为 false 时跳过
    if (respectEnabled && meta.enabled === 'false') continue;

    const name = meta.name?.trim() || undefined;
    entries.push({
      path,
      name,
      description: deriveSkillDescription(path, content, meta),
      tags: parseSkillTags(meta),
      body: maybeInlineBody(content),
    });
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
};

/**
 * 返回经 activeTags 过滤后、实际注入系统提示词的技能索引。
 * 管理面板应使用 loadWorkspaceSkillsIndex 获取全量；Agent 构建时使用本函数。
 */
export const loadInjectableWorkspaceSkills = async (): Promise<
  WorkspaceSkillIndexEntry[]
> => {
  const all = await loadWorkspaceSkillsIndex();
  const config = getCottageConfig();
  return selectInjectableSkills(all, config.skills?.activeTags);
};

export interface WorkspaceAgentPromptContext {
  skills: WorkspaceSkillIndexEntry[];
  /** 已格式化的 <project_instructions> 块，无文件时为空串 */
  projectInstructionsBlock: string;
}

/** Agent 构建时一次加载技能索引与项目约定（AGENTS.md 等） */
export const loadWorkspaceAgentPromptContext =
  async (): Promise<WorkspaceAgentPromptContext> => {
    const [skills, projectInstructionsBlock] = await Promise.all([
      loadInjectableWorkspaceSkills(),
      loadProjectInstructionsBlock(),
    ]);
    return { skills, projectInstructionsBlock };
  };
