import { describe, expect, it } from 'vitest';
import {
  deriveSkillDescription,
  formatWorkspaceSkillsPromptBlock,
  parseSkillFrontmatter,
  stripSkillFrontmatter,
} from './workspaceSkills';

describe('workspaceSkills', () => {
  it('parseSkillFrontmatter reads name and folded description', () => {
    const md = `---
name: demo
description: >-
  Line one
  line two
---
# Demo
`;
    expect(parseSkillFrontmatter(md)).toEqual({
      name: 'demo',
      description: 'Line one\nline two',
    });
    expect(stripSkillFrontmatter(md)).toMatch(/^# Demo/);
  });

  it('deriveSkillDescription falls back to heading then path', () => {
    expect(
      deriveSkillDescription('SKILLS/a.md', '# Title\n\nbody', {}),
    ).toBe('Title');
    expect(deriveSkillDescription('SKILLS/x.md', 'plain', {})).toBe('plain');
    expect(deriveSkillDescription('SKILLS/x.md', '\n\n', {})).toBe('SKILLS/x.md');
  });

  it('formatWorkspaceSkillsPromptBlock is empty without entries', () => {
    expect(formatWorkspaceSkillsPromptBlock([])).toBe('');
  });

  it('formatWorkspaceSkillsPromptBlock lists workspace_skill tags', () => {
    const block = formatWorkspaceSkillsPromptBlock([
      { path: 'SKILLS/foo/SKILL.md', description: 'Do foo' },
    ]);
    expect(block).toContain('<available_skills');
    expect(block).toContain('path="SKILLS/foo/SKILL.md"');
    expect(block).toContain('inline="false"');
    expect(block).toContain('Do foo');
  });

  it('formatWorkspaceSkillsPromptBlock inlines small skill bodies', () => {
    const block = formatWorkspaceSkillsPromptBlock([
      {
        path: 'SKILLS/bar.md',
        name: 'bar',
        description: 'Bar skill',
        body: '# Bar\n\nDo the thing',
      },
    ]);
    expect(block).toContain('inline="true"');
    expect(block).toContain('name="bar"');
    expect(block).toContain('# Bar\n\nDo the thing');
    expect(block).toContain('禁止用 listFiles');
  });
});
