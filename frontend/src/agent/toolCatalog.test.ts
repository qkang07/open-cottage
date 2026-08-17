import { describe, expect, it } from 'vitest';
import {
  normalizeEnabledTools,
  optionalToolGroupsFromNames,
  optionalToolNamesForGroups,
  OFFICE_TOOL_NAMES,
} from './toolCatalog';

describe('toolCatalog', () => {
  it('normalizeEnabledTools keeps only known optional tools', () => {
    expect(
      normalizeEnabledTools(['readSpreadsheet', 'readDocument', 'writeSpreadsheet']),
    ).toEqual(['readSpreadsheet', 'writeSpreadsheet']);
  });

  it('optionalToolGroupsFromNames requires the full office pack', () => {
    // 仅部分办公工具不足以算作「办公」能力包已启用
    expect(
      optionalToolGroupsFromNames(['readSpreadsheet', 'writeSpreadsheet']),
    ).toEqual([]);
    // 办公包全部工具齐全才识别为已启用
    expect(optionalToolGroupsFromNames([...OFFICE_TOOL_NAMES])).toEqual([
      'office',
    ]);
  });

  it('optionalToolNamesForGroups expands office pack to all tools', () => {
    expect(optionalToolNamesForGroups(['office'])).toEqual([
      ...OFFICE_TOOL_NAMES,
    ]);
  });
});
