import {
  loadLayeredCottageConfigWithOptions,
} from '../../config/cottageStorage';
import { getCottageConfig } from '../../config/store';
import { workspace } from '../../workspace/FileSystemWorkspace';
import type { Capability } from '../capabilities/types';
import { packManifestPath, packPromptPath, packSkillsDir } from './paths';
import type {
  InstalledCapabilityPackRef,
  LoadedCapabilityPack,
  CapabilityPackManifest,
} from './types';
import { validateCapabilityPackManifest } from './validate';

export const listInstalledPackRefs = (layer?: 'folder' | 'domain'): InstalledCapabilityPackRef[] => {
  if (layer === 'domain') {
    // 注意：getCottageConfig() 返回的是 merged 配置，domain 层 packs 无法直接区分
    // 使用 loadLayeredCottageConfigWithOptions 做异步精确读取
    return [];
  }
  return getCottageConfig().packs?.installed ?? [];
};

export const listInstalledPackRefsAsync = async (
  layer: 'folder' | 'domain',
): Promise<InstalledCapabilityPackRef[]> => {
  if (layer === 'domain') {
    const layered = await loadLayeredCottageConfigWithOptions({ syncStore: false });
    return layered.layers.domain?.packs?.installed ?? [];
  }
  // folder 层：直接从 merged config 读取（folder 是最高优先级，等同于 merged）
  const layered = await loadLayeredCottageConfigWithOptions({ syncStore: false });
  return layered.layers.folder?.packs?.installed ?? [];
};

export const readPackManifest = async (
  packId: string,
): Promise<CapabilityPackManifest | null> => {
  const raw = await workspace.readCottagePath<unknown>(packManifestPath(packId));
  if (!raw) return null;
  try {
    return validateCapabilityPackManifest(raw);
  } catch {
    return null;
  }
};

const readPackPromptOverlay = async (packId: string): Promise<string> => {
  const fromFile = await workspace.readCottageText(packPromptPath(packId));
  return fromFile?.trim() ?? '';
};

export const loadInstalledPacks = async (): Promise<LoadedCapabilityPack[]> => {
  if (!workspace.isOpen) return [];

  const refs = listInstalledPackRefs();
  const loaded: LoadedCapabilityPack[] = [];

  for (const ref of refs) {
    if (ref.enabled === false) continue;
    const manifest = await readPackManifest(ref.id);
    if (!manifest) continue;

    const inline = manifest.promptOverlay?.trim() ?? '';
    const fromFile = await readPackPromptOverlay(ref.id);
    const promptOverlay = [inline, fromFile].filter(Boolean).join('\n\n');

    loaded.push({ ref, manifest, promptOverlay });
  }

  return loaded;
};

export const loadAllPackManifests = async (
  layer?: 'folder' | 'domain',
): Promise<
  Array<{ ref: InstalledCapabilityPackRef; manifest: CapabilityPackManifest | null }>
> => {
  if (layer === 'domain') {
    const refs = await listInstalledPackRefsAsync('domain');
    return refs.map((ref) => {
      let manifest: CapabilityPackManifest | null = null;
      if (ref.inlineManifest) {
        try {
          manifest = validateCapabilityPackManifest(ref.inlineManifest);
        } catch {
          manifest = null;
        }
      }
      return { ref, manifest };
    });
  }

  // folder 层（默认）：从文件系统读取 manifest
  const refs = layer === 'folder'
    ? await listInstalledPackRefsAsync('folder')
    : listInstalledPackRefs();
  const result: Array<{
    ref: InstalledCapabilityPackRef;
    manifest: CapabilityPackManifest | null;
  }> = [];
  for (const ref of refs) {
    result.push({ ref, manifest: await readPackManifest(ref.id) });
  }
  return result;
};

export const collectPackCapabilities = (
  packs: readonly LoadedCapabilityPack[],
): Capability[] => {
  const list: Capability[] = [];
  for (const pack of packs) {
    if (pack.manifest.capabilities?.length) {
      list.push(...pack.manifest.capabilities);
    }
  }
  return list;
};

export const listPackSkillPaths = async (packId: string): Promise<string[]> => {
  const dir = packSkillsDir(packId);
  return (await workspace.listCottageFiles(dir)).filter((p) =>
    p.toLowerCase().endsWith('.md'),
  );
};
