import { describe, expect, it } from 'vitest';
import { resolveWorkspaceFileLink } from './workspaceFileLinks';

const files = ['frontend/src/main.ts', 'README.md'];

describe('resolveWorkspaceFileLink', () => {
  it('resolves workspace-relative links and strips line locations', () => {
    expect(
      resolveWorkspaceFileLink('frontend/src/main.ts:12:4', 'open-cottage', files),
    ).toEqual({ path: 'frontend/src/main.ts', line: 12, column: 4 });
    expect(
      resolveWorkspaceFileLink('README.md#L8', 'open-cottage', files),
    ).toEqual({ path: 'README.md', line: 8, column: undefined });
    expect(
      resolveWorkspaceFileLink('README.md:9', 'open-cottage', files),
    ).toEqual({ path: 'README.md', line: 9, column: undefined });
  });

  it('resolves absolute paths below the active workspace root', () => {
    expect(
      resolveWorkspaceFileLink(
        'C:\\workspace\\open-cottage\\frontend\\src\\main.ts',
        'open-cottage',
        files,
      ),
    ).toEqual({ path: 'frontend/src/main.ts', line: undefined, column: undefined });
  });

  it('does not capture external links, anchors, or parent traversal', () => {
    expect(
      resolveWorkspaceFileLink('https://example.com/a.ts', 'open-cottage', files),
    ).toBeNull();
    expect(
      resolveWorkspaceFileLink(
        'vscode://file/frontend/src/main.ts',
        'open-cottage',
        files,
      ),
    ).toBeNull();
    expect(resolveWorkspaceFileLink('#section', 'open-cottage', files)).toBeNull();
    expect(resolveWorkspaceFileLink('../outside.ts', 'open-cottage', files)).toBeNull();
  });
});
