import { describe, expect, it } from 'vitest';
import {
  basenameOf,
  defaultNewFolderPath,
  defaultNewTextFilePath,
  joinPathInDir,
  parentDirOf,
  uniqueEntryPath,
} from './suggestEntryPath';

describe('suggestEntryPath', () => {
  it('uniqueEntryPath avoids collisions', () => {
    const files = ['untitled.txt', 'untitled-1.txt'];
    expect(uniqueEntryPath(files, '', 'untitled', '.txt')).toBe('untitled-2.txt');
  });

  it('parentDirOf', () => {
    expect(parentDirOf('src/a.ts')).toBe('src');
    expect(parentDirOf('README.md')).toBe('');
  });

  it('joinPathInDir and basenameOf', () => {
    expect(basenameOf('src/foo.ts')).toBe('foo.ts');
    expect(joinPathInDir('src', 'bar.ts')).toBe('src/bar.ts');
    expect(() => joinPathInDir('src', 'a/b')).toThrow(/不能包含/);
  });

  it('suggests under context dir', () => {
    expect(
      defaultNewTextFilePath(['src/untitled.txt'], 'src'),
    ).toBe('src/untitled-1.txt');
    expect(defaultNewFolderPath(['new-folder'], '')).toBe('new-folder-1');
  });
});
