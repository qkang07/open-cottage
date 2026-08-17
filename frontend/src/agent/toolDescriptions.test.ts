import { describe, expect, it } from 'vitest';
import {
  TOOL_DESCRIPTIONS,
  TOOL_LOCALE_ALIASES,
  toolLocaleAlias,
} from './toolDescriptions';

describe('toolDescriptions', () => {
  it('every described tool has locale alias', () => {
    for (const toolName of Object.keys(TOOL_DESCRIPTIONS)) {
      expect(TOOL_LOCALE_ALIASES[toolName]).toBeTruthy();
      expect(toolLocaleAlias(toolName)).toBe(TOOL_LOCALE_ALIASES[toolName]);
    }
  });
});
