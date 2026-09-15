import { describe, expect, it } from 'vitest';
import {
  buildCottagePlanSystemPrompt,
  buildCottageSystemPrompt,
  buildCottageTaskSystemPrompt,
} from './constants';

describe('Cottage system prompts', () => {
  it('keeps the browser-agent runtime boundary in every public mode', () => {
    const prompts = [
      buildCottageSystemPrompt(undefined),
      buildCottagePlanSystemPrompt(undefined),
      buildCottageTaskSystemPrompt(undefined),
    ];

    for (const prompt of prompts) {
      expect(prompt).toContain('运行时身份与能力边界：');
      expect(prompt).toContain('当前实际可用的能力，以本回合注入的工具');
      expect(prompt).toContain('没有 Shell、PowerShell、命令行');
      expect(prompt).toContain('不得臆造工具、权限、文件、命令、执行结果或外部访问');
      expect(prompt).toContain('浏览器隔离 Worker');
      expect(prompt).not.toContain('- - 即使可用 runScript');
    }
  });
});
