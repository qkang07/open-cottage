import { describe, expect, it } from 'vitest';
import {
  buildMerkleSnapshot,
  planFileReads,
  type MerkleSnapshot,
} from './merkle';
import type { IndexedFileEntry } from './types';

const entry = (hash: string): IndexedFileEntry => ({
  hash,
  mtime: 1,
  chunkIds: [`${hash}-c0`],
});

describe('merkle', () => {
  it('buildMerkleSnapshot 对相同文件集产生稳定 root', async () => {
    const paths = ['src/a.ts', 'src/b.ts', 'README.md'];
    const hashes = {
      'src/a.ts': 'aaa',
      'src/b.ts': 'bbb',
      'README.md': 'ccc',
    };
    const a = await buildMerkleSnapshot(paths, hashes);
    const b = await buildMerkleSnapshot(paths, hashes);
    expect(a.root).toBe(b.root);
    expect(a.dirs['src']).toBeTruthy();
  });

  it('planFileReads 在 root 未变时跳过全部 read', async () => {
    const paths = ['src/a.ts', 'src/b.ts'];
    const existing: Record<string, IndexedFileEntry> = {
      'src/a.ts': entry('aaa'),
      'src/b.ts': entry('bbb'),
    };
    const merkle = await buildMerkleSnapshot(paths, {
      'src/a.ts': 'aaa',
      'src/b.ts': 'bbb',
    });

    const plan = await planFileReads(paths, existing, merkle, false);
    expect(plan.pathsToRead.size).toBe(0);
    expect(plan.knownHashes['src/a.ts']).toBe('aaa');
    expect(plan.knownHashes['src/b.ts']).toBe('bbb');
  });

  it('planFileReads 仅读取变更子树内文件', async () => {
    const paths = ['src/a.ts', 'src/b.ts', 'lib/c.ts'];
    const existing: Record<string, IndexedFileEntry> = {
      'src/a.ts': entry('aaa'),
      'src/b.ts': entry('bbb'),
      'lib/c.ts': entry('ccc'),
    };
    const oldMerkle = await buildMerkleSnapshot(paths, {
      'src/a.ts': 'aaa',
      'src/b.ts': 'bbb',
      'lib/c.ts': 'ccc',
    });

    const changedPaths = ['src/a.ts', 'src/b.ts', 'lib/c.ts'];
    const existingChanged = {
      ...existing,
      'src/a.ts': entry('aaa-changed'),
    };

    const plan = await planFileReads(changedPaths, existingChanged, oldMerkle, false);
    expect(plan.pathsToRead.has('src/a.ts')).toBe(true);
    expect(plan.knownHashes['lib/c.ts']).toBe('ccc');
  });

  it('新文件始终加入 pathsToRead', async () => {
    const paths = ['src/a.ts', 'src/new.ts'];
    const existing: Record<string, IndexedFileEntry> = {
      'src/a.ts': entry('aaa'),
    };
    const oldMerkle: MerkleSnapshot = await buildMerkleSnapshot(
      ['src/a.ts'],
      { 'src/a.ts': 'aaa' },
    );

    const plan = await planFileReads(paths, existing, oldMerkle, false);
    expect(plan.pathsToRead.has('src/new.ts')).toBe(true);
  });
});
