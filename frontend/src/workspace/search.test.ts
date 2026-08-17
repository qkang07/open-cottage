import { describe, expect, it } from 'vitest';
import {
  applySearchReplace,
  buildSearchMatcher,
  globToRegExp,
  isLikelyTextPath,
  matchesAnyGlob,
  matchesGlob,
  searchInContent,
} from './search';

describe('globToRegExp / matchesGlob', () => {
  it('matches single-level * within a segment only', () => {
    expect(matchesGlob('a.ts', '*.ts')).toBe(true);
    expect(matchesGlob('src/a.ts', '*.ts')).toBe(false);
    expect(matchesGlob('src/a.ts', 'src/*.ts')).toBe(true);
    expect(matchesGlob('src/sub/a.ts', 'src/*.ts')).toBe(false);
  });

  it('matches ** across directories, including zero levels', () => {
    expect(matchesGlob('src/a.ts', 'src/**/*.ts')).toBe(true);
    expect(matchesGlob('src/a/b/c.ts', 'src/**/*.ts')).toBe(true);
    expect(matchesGlob('a.ts', '**/*.ts')).toBe(true);
    expect(matchesGlob('x/y/a.ts', '**/*.ts')).toBe(true);
  });

  it('supports {a,b} branches and ? single char', () => {
    expect(matchesGlob('a.json', '**/*.{json,md}')).toBe(true);
    expect(matchesGlob('docs/x.md', '**/*.{json,md}')).toBe(true);
    expect(matchesGlob('a.txt', '**/*.{json,md}')).toBe(false);
    expect(matchesGlob('a1.ts', 'a?.ts')).toBe(true);
    expect(matchesGlob('a12.ts', 'a?.ts')).toBe(false);
  });

  it('escapes regex-special literals', () => {
    expect(globToRegExp('a.b').test('axb')).toBe(false);
    expect(matchesGlob('a.b', 'a.b')).toBe(true);
  });

  it('matchesAnyGlob handles empty list', () => {
    expect(matchesAnyGlob('a.ts', undefined)).toBe(false);
    expect(matchesAnyGlob('a.ts', [])).toBe(false);
    expect(matchesAnyGlob('a.ts', ['*.js', '*.ts'])).toBe(true);
  });
});

describe('isLikelyTextPath', () => {
  it('treats common binary extensions as non-text', () => {
    expect(isLikelyTextPath('a.png')).toBe(false);
    expect(isLikelyTextPath('a.docx')).toBe(false);
    expect(isLikelyTextPath('a.zip')).toBe(false);
    expect(isLikelyTextPath('a.ts')).toBe(true);
    expect(isLikelyTextPath('a.svg')).toBe(true);
  });
});

describe('searchInContent', () => {
  const text = ['const a = 1;', 'const b = 2;', 'let c = a + b;', 'return c;'].join(
    '\n',
  );

  it('returns 1-based line numbers and respects case-insensitive matcher', () => {
    const matches = searchInContent(text, buildSearchMatcher('const'));
    expect(matches.map((m) => m.line)).toEqual([1, 2]);
  });

  it('includes context lines when requested', () => {
    const matches = searchInContent(text, buildSearchMatcher('let'), {
      contextLines: 1,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].before).toEqual(['const b = 2;']);
    expect(matches[0].after).toEqual(['return c;']);
  });

  it('honors maxMatches', () => {
    const matches = searchInContent(text, buildSearchMatcher('const'), {
      maxMatches: 1,
    });
    expect(matches).toHaveLength(1);
  });

  it('supports regex matcher', () => {
    const matches = searchInContent(
      text,
      buildSearchMatcher('=\\s*\\d', { isRegex: true }),
    );
    expect(matches.map((m) => m.line)).toEqual([1, 2]);
  });
});

describe('applySearchReplace', () => {
  it('replaces a unique match', () => {
    const { content, replacements } = applySearchReplace('hello world', [
      { search: 'world', replace: 'cottage' },
    ]);
    expect(content).toBe('hello cottage');
    expect(replacements).toBe(1);
  });

  it('throws when search is not found', () => {
    expect(() =>
      applySearchReplace('abc', [{ search: 'xyz', replace: '1' }]),
    ).toThrow(/未找到/);
  });

  it('throws on ambiguous match without replaceAll', () => {
    expect(() =>
      applySearchReplace('a a a', [{ search: 'a', replace: 'b' }]),
    ).toThrow(/匹配到 3 处/);
  });

  it('replaces all occurrences with replaceAll', () => {
    const { content, replacements } = applySearchReplace('a a a', [
      { search: 'a', replace: 'b', replaceAll: true },
    ]);
    expect(content).toBe('b b b');
    expect(replacements).toBe(3);
  });

  it('does not interpret $ as replacement pattern', () => {
    const { content } = applySearchReplace('price = X', [
      { search: 'X', replace: '$100' },
    ]);
    expect(content).toBe('price = $100');
  });

  it('applies edits sequentially', () => {
    const { content, replacements } = applySearchReplace('foo bar', [
      { search: 'foo', replace: 'baz' },
      { search: 'bar', replace: 'qux' },
    ]);
    expect(content).toBe('baz qux');
    expect(replacements).toBe(2);
  });
});
