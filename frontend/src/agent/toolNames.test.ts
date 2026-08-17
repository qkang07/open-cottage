import { describe, expect, it } from 'vitest';
import { isAskUserTool, normalizeToolName, toolNameIn } from './toolNames';

describe('normalizeToolName', () => {
  it('转小写并移除下划线', () => {
    expect(normalizeToolName('readFile')).toBe('readfile');
    expect(normalizeToolName('read_file')).toBe('readfile');
    expect(normalizeToolName('Read_File')).toBe('readfile');
  });
});

describe('isAskUserTool', () => {
  it('命中 askUser 及其变体', () => {
    expect(isAskUserTool('askUser')).toBe(true);
    expect(isAskUserTool('ask_user')).toBe(true);
    expect(isAskUserTool('AskUser')).toBe(true);
  });

  it('拒绝其它工具名与空值', () => {
    expect(isAskUserTool('applyTidyPlan')).toBe(false);
    expect(isAskUserTool('')).toBe(false);
    expect(isAskUserTool(undefined)).toBe(false);
    expect(isAskUserTool(null)).toBe(false);
  });
});

describe('toolNameIn', () => {
  const names = new Set(['runScript', 'askUser', 'submitExecutionPlan']);

  it('精确名与变体名均命中', () => {
    expect(toolNameIn(names, 'askUser')).toBe(true);
    expect(toolNameIn(names, 'ask_user')).toBe(true);
    expect(toolNameIn(names, 'Run_Script')).toBe(true);
  });

  it('未登记的工具名不命中', () => {
    expect(toolNameIn(names, 'readFile')).toBe(false);
    expect(toolNameIn(['readFile'], 'read_file')).toBe(true);
  });
});
