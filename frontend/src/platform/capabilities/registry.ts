import { BUILTIN_CAPABILITIES } from './builtins';
import type { Capability, CapabilityDomain } from './types';

const dedupe = (list: Capability[]): Capability[] => {
  const map = new Map<string, Capability>();
  for (const item of list) map.set(item.id, item);
  return [...map.values()];
};

export class CapabilityRegistry {
  private readonly capabilities: Capability[];

  constructor(capabilities: Capability[] = BUILTIN_CAPABILITIES) {
    this.capabilities = dedupe(capabilities);
  }

  list(): Capability[] {
    return [...this.capabilities];
  }

  listByDomain(domain: CapabilityDomain): Capability[] {
    return this.capabilities.filter((c) => c.domain === domain);
  }

  findByToolName(toolName: string): Capability[] {
    return this.capabilities.filter((c) => c.tools.includes(toolName));
  }

  listForTools(toolNames: readonly string[]): Capability[] {
    const enabled = new Set(toolNames);
    return this.capabilities.filter((c) =>
      c.tools.some((tool) => enabled.has(tool)),
    );
  }
}

let defaultRegistry: CapabilityRegistry | null = null;

export const resetCapabilityRegistry = (
  capabilities: Capability[] = BUILTIN_CAPABILITIES,
): CapabilityRegistry => {
  defaultRegistry = new CapabilityRegistry(capabilities);
  return defaultRegistry;
};

export const getCapabilityRegistry = (): CapabilityRegistry => {
  if (!defaultRegistry) {
    defaultRegistry = new CapabilityRegistry();
  }
  return defaultRegistry;
};
