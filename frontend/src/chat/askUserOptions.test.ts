import { describe, expect, it } from 'vitest';
import { normalizeAskUserOptions } from './askUserOptions';

describe('normalizeAskUserOptions', () => {
  it('保留字符串选项，并接受带说明的对象选项', () => {
    expect(
      normalizeAskUserOptions([
        '按类型分类',
        { label: '按主题分类', description: '按业务主题建立目录' },
      ]),
    ).toEqual([
      { label: '按类型分类' },
      { label: '按主题分类', description: '按业务主题建立目录' },
    ]);
  });

  it('忽略没有可选标签的无效项', () => {
    expect(
      normalizeAskUserOptions([{ description: '缺少标签' }, '', 1, null]),
    ).toEqual([]);
  });
});
