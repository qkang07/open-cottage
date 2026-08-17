import type { McpServerConfig } from '../../config/constants';
import {
  loadLayeredCottageConfigWithOptions,
  saveCottageConfigToWorkspace,
  saveLayeredCottageConfig,
} from '../../config/cottageStorage';
import { getCottageConfig } from '../../config/store';
import { workspace } from '../../workspace/FileSystemWorkspace';
import {
  packManifestPath,
  packPromptPath,
  packSkillPath,
} from './paths';
import type { CapabilityPackManifest, InstalledCapabilityPackRef } from './types';
import { validateCapabilityPackManifest } from './validate';

const mergeMcpServers = (
  existing: McpServerConfig[] | undefined,
  incoming: McpServerConfig[] | undefined,
): McpServerConfig[] => {
  if (!incoming?.length) return existing ?? [];
  const map = new Map((existing ?? []).map((s) => [s.id, s]));
  for (const server of incoming) {
    map.set(server.id, { ...map.get(server.id), ...server });
  }
  return [...map.values()];
};

const upsertInstalledRef = (
  refs: InstalledCapabilityPackRef[],
  next: InstalledCapabilityPackRef,
): InstalledCapabilityPackRef[] => {
  const without = refs.filter((r) => r.id !== next.id);
  return [...without, next];
};

export interface InstallPackOptions {
  level?: 'folder' | 'domain';
}

export const installCapabilityPack = async (
  rawManifest: unknown,
  options?: InstallPackOptions,
): Promise<InstalledCapabilityPackRef> => {
  const level = options?.level ?? 'folder';
  const manifest = validateCapabilityPackManifest(rawManifest);

  const ref: InstalledCapabilityPackRef = {
    id: manifest.id,
    enabled: true,
    installedAt: Date.now(),
    version: manifest.version,
  };

  if (level === 'domain') {
    // 域名层：manifest 内联存储到配置，不写文件系统
    ref.inlineManifest = manifest;
    const layered = await loadLayeredCottageConfigWithOptions({ syncStore: false });
    const domainPacks = layered.layers.domain?.packs?.installed ?? [];
    const nextInstalled = upsertInstalledRef(domainPacks, ref);
    await saveLayeredCottageConfig(
      { packs: { installed: nextInstalled } },
      { level: 'domain' },
    );
    return ref;
  }

  // folder 层：写文件系统 + 配置
  if (!workspace.isOpen) {
    throw new Error('请先打开工作空间');
  }

  await workspace.writeCottagePath(packManifestPath(manifest.id), manifest);

  if (manifest.promptOverlay?.trim()) {
    await workspace.writeCottageText(
      packPromptPath(manifest.id),
      manifest.promptOverlay.trim(),
    );
  }

  for (const skill of manifest.skills ?? []) {
    const file = skill.file.replace(/^\/+/, '');
    if (!file.endsWith('.md')) {
      throw new Error(`技能文件须为 .md：${skill.file}`);
    }
    await workspace.writeCottageText(
      packSkillPath(manifest.id, file),
      skill.content,
    );
  }

  const config = getCottageConfig();
  const installed = config.packs?.installed ?? [];
  const nextInstalled = upsertInstalledRef(installed, ref);
  const mcpPatch =
    manifest.mcpServers?.length
      ? {
          mcp: {
            ...config.mcp,
            servers: mergeMcpServers(config.mcp?.servers, manifest.mcpServers),
          },
        }
      : {};

  await saveCottageConfigToWorkspace({
    packs: { installed: nextInstalled },
    ...mcpPatch,
  });

  return ref;
};

export const setCapabilityPackEnabled = async (
  packId: string,
  enabled: boolean,
  level?: 'folder' | 'domain',
): Promise<void> => {
  if (level === 'domain') {
    const layered = await loadLayeredCottageConfigWithOptions({ syncStore: false });
    const installed = layered.layers.domain?.packs?.installed ?? [];
    const target = installed.find((r) => r.id === packId);
    if (!target) throw new Error('未找到该能力包');
    const next = installed.map((r) =>
      r.id === packId ? { ...r, enabled } : r,
    );
    await saveLayeredCottageConfig(
      { packs: { installed: next } },
      { level: 'domain' },
    );
    return;
  }

  const config = getCottageConfig();
  const installed = config.packs?.installed ?? [];
  const target = installed.find((r) => r.id === packId);
  if (!target) throw new Error('未找到该能力包');

  const next = installed.map((r) =>
    r.id === packId ? { ...r, enabled } : r,
  );
  await saveCottageConfigToWorkspace({ packs: { installed: next } });
};

export const uninstallCapabilityPack = async (
  packId: string,
  level?: 'folder' | 'domain',
): Promise<void> => {
  if (level === 'domain') {
    const layered = await loadLayeredCottageConfigWithOptions({ syncStore: false });
    const installed = layered.layers.domain?.packs?.installed ?? [];
    if (!installed.some((r) => r.id === packId)) {
      throw new Error('未找到该能力包');
    }
    await saveLayeredCottageConfig(
      { packs: { installed: installed.filter((r) => r.id !== packId) } },
      { level: 'domain' },
    );
    return;
  }

  if (!workspace.isOpen) {
    throw new Error('请先打开工作空间');
  }

  const config = getCottageConfig();
  const installed = config.packs?.installed ?? [];
  if (!installed.some((r) => r.id === packId)) {
    throw new Error('未找到该能力包');
  }

  const manifest = await workspace.readCottagePath<CapabilityPackManifest>(
    packManifestPath(packId),
  );

  const mcpPatch =
    manifest?.mcpServers?.length
      ? {
          mcp: {
            ...config.mcp,
            servers: (config.mcp?.servers ?? []).filter(
              (s) => !manifest.mcpServers!.some((m) => m.id === s.id),
            ),
          },
        }
      : {};

  await saveCottageConfigToWorkspace({
    packs: { installed: installed.filter((r) => r.id !== packId) },
    ...mcpPatch,
  });

  // 保留包目录文件以便用户手动恢复；仅移除注册记录
};
