import { describe, expect, it } from 'vitest';
import {
  CORE_FILE_TOOL_NAMES,
  DEFERRED_FILE_TOOL_NAMES,
  formatDeferredToolsPromptBlock,
  isCoreFileToolName,
  isDeferredFileToolName,
  partitionFileTools,
} from './toolSkills';

describe('toolSkills', () => {
  it('partitions core vs deferred without overlap', () => {
    const core = new Set(CORE_FILE_TOOL_NAMES);
    const deferred = new Set(DEFERRED_FILE_TOOL_NAMES);
    for (const name of CORE_FILE_TOOL_NAMES) {
      expect(deferred.has(name)).toBe(false);
      expect(isCoreFileToolName(name)).toBe(true);
    }
    for (const name of DEFERRED_FILE_TOOL_NAMES) {
      expect(core.has(name)).toBe(false);
      expect(isDeferredFileToolName(name)).toBe(true);
    }
  });

  it('partitionFileTools routes by name', () => {
    const fake = (name: string) =>
      ({ name, description: name }) as {
        name: string;
        description: string;
      };
    const { core, deferred } = partitionFileTools([
      fake('readFile'),
      fake('runScript'),
      fake('editFile'),
    ] as never);
    expect(core.map((t) => t.name).sort()).toEqual(['editFile', 'readFile']);
    expect(deferred.map((t) => t.name)).toEqual(['runScript']);
  });

  it('formatDeferredToolsPromptBlock lists tools and loadTools hint', () => {
    const block = formatDeferredToolsPromptBlock(['runScript', 'compress']);
    expect(block).toContain('<available_deferred_tools');
    expect(block).toContain('name="runScript"');
    expect(block).toContain('name="compress"');
    expect(block).toContain('loadTools');
  });
});
