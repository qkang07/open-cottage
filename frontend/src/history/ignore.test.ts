import { describe, expect, it } from 'vitest';
import { buildIgnoreGlobs, filterTrackedFiles, matchesAny, shouldTrack } from './ignore';

describe('matchesAny', () => {
  it('matches ** globs', () => {
    expect(matchesAny('src/foo.ts', ['**/*.ts'])).toBe(true);
    expect(matchesAny('src/foo.js', ['**/*.ts'])).toBe(false);
  });

  it('matches directory prefixes', () => {
    expect(matchesAny('node_modules/foo/bar.js', ['node_modules/**'])).toBe(true);
    expect(matchesAny('src/foo.ts', ['node_modules/**'])).toBe(false);
  });

  it('supports brace expansion', () => {
    expect(matchesAny('a.png', ['*.{png,jpg}'])).toBe(true);
    expect(matchesAny('a.jpg', ['*.{png,jpg}'])).toBe(true);
    expect(matchesAny('a.gif', ['*.{png,jpg}'])).toBe(false);
  });
});

describe('shouldTrack', () => {
  it('tracks files matching trackGlobs and not ignoreGlobs', () => {
    expect(shouldTrack('src/index.ts', ['**'], ['node_modules/**'])).toBe(true);
    expect(shouldTrack('node_modules/foo.js', ['**'], ['node_modules/**'])).toBe(false);
  });

  it('excludes files not matching trackGlobs', () => {
    expect(shouldTrack('dist/bundle.js', ['src/**'], [])).toBe(false);
    expect(shouldTrack('src/index.ts', ['src/**'], [])).toBe(true);
  });
});

describe('filterTrackedFiles', () => {
  it('filters by globs', () => {
    const files = ['src/a.ts', 'src/b.ts', 'node_modules/x.js', 'dist/bundle.js'];
    const result = filterTrackedFiles(files, ['src/**'], ['node_modules/**']);
    expect(result).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('buildIgnoreGlobs', () => {
  it('always excludes .cottage/**', () => {
    const globs = buildIgnoreGlobs(['node_modules/**']);
    expect(globs).toContain('.cottage/**');
    expect(globs).toContain('node_modules/**');
  });
});
