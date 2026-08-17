import { describe, expect, it } from 'vitest';
import {
  formatProjectInstructionsPromptBlock,
  type ProjectInstructionsPayload,
} from './projectInstructions';

describe('projectInstructions', () => {
  it('formatProjectInstructionsPromptBlock is empty without payload', () => {
    expect(formatProjectInstructionsPromptBlock(null)).toBe('');
    expect(formatProjectInstructionsPromptBlock(undefined)).toBe('');
  });

  it('wraps content in project_instructions tag', () => {
    const payload: ProjectInstructionsPayload = {
      path: 'AGENTS.md',
      content: 'Do not commit secrets',
      truncated: false,
      totalChars: 20,
    };
    const block = formatProjectInstructionsPromptBlock(payload);
    expect(block).toContain('<project_instructions path="AGENTS.md">');
    expect(block).toContain('Do not commit secrets');
    expect(block).toContain('</project_instructions>');
  });

  it('notes truncation when truncated', () => {
    const payload: ProjectInstructionsPayload = {
      path: 'AGENTS.md',
      content: 'partial',
      truncated: true,
      totalChars: 99999,
    };
    const block = formatProjectInstructionsPromptBlock(payload);
    expect(block).toContain('已截断');
    expect(block).toContain('99999');
  });
});
