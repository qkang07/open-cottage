import { capabilitiesForEnabledTools } from '../../agent/toolCatalog';
import { BUILTIN_CAPABILITIES } from '../capabilities/builtins';
import {
  getCapabilityRegistry,
  resetCapabilityRegistry,
} from '../capabilities/registry';
import type { Capability } from '../capabilities/types';
import { collectPackCapabilities, loadInstalledPacks } from './loader';
import type { LoadedCapabilityPack } from './types';

export interface ResolvedPackContext {
  packs: LoadedCapabilityPack[];
  capabilities: Capability[];
  promptOverlays: string[];
}

export const resolvePackContext = async (): Promise<ResolvedPackContext> => {
  const packs = await loadInstalledPacks();
  const packCapabilities = collectPackCapabilities(packs);
  const capabilities = resetCapabilityRegistry([
    ...BUILTIN_CAPABILITIES,
    ...packCapabilities,
  ]).list();

  const promptOverlays = packs
    .filter((p) => p.promptOverlay.trim())
    .map((pack) => {
      const header = `[能力包: ${pack.manifest.name}]`;
      return `${header}\n${pack.promptOverlay.trim()}`;
    });

  // 预热 registry 单例
  void getCapabilityRegistry();

  return { packs, capabilities, promptOverlays };
};

export const formatPackPromptBlock = (overlays: readonly string[]): string => {
  if (!overlays.length) return '';
  return `\n\n${overlays.join('\n\n')}`;
};

export const capabilitiesForAgent = (
  enabledTools: readonly string[] | undefined,
  packs: readonly LoadedCapabilityPack[],
): Capability[] => {
  const fromTools = capabilitiesForEnabledTools(enabledTools);
  const map = new Map(fromTools.map((c) => [c.id, c]));
  for (const pack of packs) {
    for (const capability of pack.manifest.capabilities ?? []) {
      map.set(capability.id, capability);
    }
  }
  return [...map.values()];
};
