/**
 * 远程安装：从 URL 拉取内容并安装为能力包或工作区技能。
 *
 * 自动识别内容类型：
 * - JSON 且 schema 为能力包 schema → 校验后安装为能力包（写入 .cottage/packs）
 * - 其余按 Markdown 技能处理 → 写入工作区 SKILLS/ 目录
 *
 * 网络访问优先直连（raw.githubusercontent.com 等通常放行 CORS）；
 * 直连失败（CORS/网络）时，若传入 Cottage Service 抓取器则改走代理。
 */

import { WORKSPACE_SKILLS_DIR } from '../../config/constants';
import { parseSkillFrontmatter } from '../../agent/workspaceSkills';
import { workspace } from '../../workspace/FileSystemWorkspace';
import { installCapabilityPack } from './install';
import { CAPABILITY_PACK_SCHEMA } from './types';
import { validateCapabilityPackManifest } from './validate';

/** 与 Cottage Service 客户端 fetchPage 兼容的最小抓取器接口 */
export interface RemoteFetcher {
  fetchPage(
    url: string,
    opts?: { maxLength?: number; profile?: string; referer?: string },
  ): Promise<{ content: string }>;
}

export type RemoteInstallKind = 'pack' | 'skill';

export interface RemoteInstallResult {
  kind: RemoteInstallKind;
  /** 能力包 id 或技能文件路径 */
  id: string;
  /** 展示名 */
  name: string;
  /** 是否覆盖了已存在的技能文件（仅 skill 类型有意义） */
  overwritten?: boolean;
}

export interface InstallFromUrlOptions {
  /** 能力包安装层级，默认 folder */
  level?: 'folder' | 'domain';
  /** 直连失败时用于代理抓取的 Cottage Service 客户端 */
  fetcher?: RemoteFetcher | null;
  /**
   * 覆盖确认回调。技能文件已存在时调用，返回 false 则中止安装。
   * 未提供时默认覆盖。
   */
  confirmOverwrite?: (path: string) => Promise<boolean> | boolean;
}

const sanitizeFileStem = (raw: string): string =>
  raw.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').replace(/^_+|_+$/g, '') ||
  'remote-skill';

/** 从 frontmatter name 或 URL 末段推导技能文件名（保证 .md 后缀） */
const deriveSkillFileName = (
  url: string,
  meta: Record<string, string>,
): string => {
  const fromMeta = meta.name?.trim();
  if (fromMeta) return `${sanitizeFileStem(fromMeta)}.md`;

  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] ?? '';
    // 形如 .../my-skill/SKILL.md 时优先用上级目录名
    if (/^skill\.md$/i.test(last) && parts.length >= 2) {
      return `${sanitizeFileStem(parts[parts.length - 2])}.md`;
    }
    if (last) {
      const stem = last.replace(/\.md$/i, '');
      return `${sanitizeFileStem(stem)}.md`;
    }
  } catch {
    // 非法 URL：忽略，走兜底
  }
  return `remote-skill-${Date.now()}.md`;
};

const fetchRemoteText = async (
  url: string,
  fetcher?: RemoteFetcher | null,
): Promise<string> => {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.text();
    // 非 2xx：若有代理则尝试代理，否则报错
    if (!fetcher) throw new Error(`下载失败 HTTP ${res.status}`);
  } catch (error) {
    if (!fetcher) {
      throw new Error(
        `无法访问该地址（可能受 CORS 限制）：${
          error instanceof Error ? error.message : String(error)
        }。可连接 Cottage Service 后重试。`,
      );
    }
  }

  const proxied = await fetcher.fetchPage(url);
  if (!proxied?.content?.trim()) {
    throw new Error('远程内容为空');
  }
  return proxied.content;
};

const looksLikePackJson = (text: string): boolean =>
  text.trimStart().startsWith('{');

/**
 * 从远程 URL 安装：自动识别能力包 JSON 或 Markdown 技能。
 */
export const installFromUrl = async (
  rawUrl: string,
  options?: InstallFromUrlOptions,
): Promise<RemoteInstallResult> => {
  const url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('请填写以 http(s):// 开头的地址');
  }

  const text = await fetchRemoteText(url, options?.fetcher);

  // 1) 尝试作为能力包 manifest
  if (looksLikePackJson(text)) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { schema?: unknown }).schema === CAPABILITY_PACK_SCHEMA
    ) {
      const manifest = validateCapabilityPackManifest(parsed);
      const ref = await installCapabilityPack(manifest, {
        level: options?.level ?? 'folder',
      });
      return { kind: 'pack', id: ref.id, name: manifest.name };
    }
  }

  // 2) 作为 Markdown 技能写入 SKILLS/
  if (!workspace.isOpen) {
    throw new Error('请先打开工作空间');
  }
  if (!text.trim()) {
    throw new Error('远程技能内容为空');
  }

  const meta = parseSkillFrontmatter(text);
  const fileName = deriveSkillFileName(url, meta);
  const path = `${WORKSPACE_SKILLS_DIR}/${fileName}`;

  const dirKind = await workspace.getEntryKind(WORKSPACE_SKILLS_DIR);
  if (dirKind !== 'directory') {
    await workspace.mkdir(WORKSPACE_SKILLS_DIR);
  }

  const existing = await workspace.getEntryKind(path);
  const overwritten = existing === 'file';
  if (overwritten && options?.confirmOverwrite) {
    const ok = await options.confirmOverwrite(path);
    if (!ok) throw new Error('已取消：目标技能文件已存在');
  }

  await workspace.writeFile(path, text);

  return {
    kind: 'skill',
    id: path,
    name: meta.name?.trim() || fileName.replace(/\.md$/i, ''),
    overwritten,
  };
};
