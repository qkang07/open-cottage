/**
 * 将 File System Access API 映射为 Worker 使用的最小 fs.promises 接口。
 * 当前由 RAG 与代码符号索引复用，与版本历史存储无关。
 */

/** 索引 Worker 所需的最小 stat 子集。 */
interface MinimalStat {
  type: 'file' | 'dir';
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: 1;
  gid: 1;
  dev: 1;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

function makeStat(type: 'file' | 'dir', size = 0): MinimalStat {
  const now = Date.now();
  return {
    type,
    mode: type === 'file' ? 0o100644 : 0o040000,
    size,
    ino: 0,
    mtimeMs: now,
    ctimeMs: now,
    uid: 1,
    gid: 1,
    dev: 1,
    isFile: () => type === 'file',
    isDirectory: () => type === 'dir',
    isSymbolicLink: () => false,
  };
}

function splitPathParts(filepath: string): string[] {
  return filepath
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
}

async function resolveDir(
  root: FileSystemDirectoryHandle,
  parts: string[],
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create });
  }
  return current;
}

async function resolveParent(
  root: FileSystemDirectoryHandle,
  filepath: string,
  create = false,
): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
  const parts = splitPathParts(filepath);
  const name = parts.pop();
  if (!name) throw new Error(`ENOENT: invalid path '${filepath}'`);
  const parent = parts.length ? await resolveDir(root, parts, create) : root;
  return { parent, name };
}

/** 创建基于指定工作区目录句柄的 fs 对象。 */
export function createFsAdapter(root: FileSystemDirectoryHandle) {
  const promises = {
    async readFile(
      filepath: string,
      opts?: { encoding?: string } | string,
    ): Promise<Uint8Array | string> {
      const { parent, name } = await resolveParent(root, filepath);
      let fileHandle: FileSystemFileHandle;
      try {
        fileHandle = await parent.getFileHandle(name);
      } catch {
        throw Object.assign(new Error(`ENOENT: no such file '${filepath}'`), {
          code: 'ENOENT',
        });
      }
      const file = await fileHandle.getFile();
      const encoding =
        typeof opts === 'string' ? opts : opts?.encoding;
      if (encoding === 'utf8' || encoding === 'utf-8') {
        return await file.text();
      }
      return new Uint8Array(await file.arrayBuffer());
    },

    async writeFile(
      filepath: string,
      data: Uint8Array | string,
      opts?: { mode?: number; encoding?: string },
    ): Promise<void> {
      void opts;
      const { parent, name } = await resolveParent(root, filepath, true);
      const fileHandle = await parent.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      if (typeof data === 'string') {
        await writable.write(data);
      } else {
        await writable.write(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      }
      await writable.close();
    },

    async mkdir(filepath: string, _opts?: { mode?: number }): Promise<void> {
      const parts = splitPathParts(filepath);
      await resolveDir(root, parts, true);
    },

    async rmdir(filepath: string): Promise<void> {
      const { parent, name } = await resolveParent(root, filepath);
      try {
        await parent.removeEntry(name, { recursive: true });
      } catch {
        throw Object.assign(new Error(`ENOENT: '${filepath}'`), {
          code: 'ENOENT',
        });
      }
    },

    async unlink(filepath: string): Promise<void> {
      const { parent, name } = await resolveParent(root, filepath);
      try {
        await parent.removeEntry(name);
      } catch {
        throw Object.assign(new Error(`ENOENT: '${filepath}'`), {
          code: 'ENOENT',
        });
      }
    },

    async stat(filepath: string): Promise<MinimalStat> {
      if (!filepath || filepath === '/' || filepath === '.') {
        return makeStat('dir');
      }
      const { parent, name } = await resolveParent(root, filepath);
      // 优先尝试文件
      try {
        const fh = await parent.getFileHandle(name);
        const file = await fh.getFile();
        return makeStat('file', file.size);
      } catch {
        // not a file
      }
      // 尝试目录
      try {
        await parent.getDirectoryHandle(name);
        return makeStat('dir');
      } catch {
        // not found
      }
      throw Object.assign(new Error(`ENOENT: '${filepath}'`), {
        code: 'ENOENT',
      });
    },

    async lstat(filepath: string): Promise<MinimalStat> {
      // FSA 没有符号链接，lstat 等同 stat
      return promises.stat(filepath);
    },

    async readdir(filepath: string): Promise<string[]> {
      let dir: FileSystemDirectoryHandle;
      if (!filepath || filepath === '/' || filepath === '.') {
        dir = root;
      } else {
        const parts = splitPathParts(filepath);
        try {
          dir = await resolveDir(root, parts);
        } catch {
          throw Object.assign(new Error(`ENOENT: '${filepath}'`), {
            code: 'ENOENT',
          });
        }
      }
      const entries: string[] = [];
      for await (const [name] of dir.entries()) {
        entries.push(name);
      }
      return entries;
    },

    async readlink(_filepath: string): Promise<string> {
      throw Object.assign(new Error('ENOTSUP: symlinks not supported'), {
        code: 'ENOTSUP',
      });
    },

    async symlink(_target: string, _filepath: string): Promise<void> {
      throw Object.assign(new Error('ENOTSUP: symlinks not supported'), {
        code: 'ENOTSUP',
      });
    },

    async chmod(_filepath: string, _mode: number): Promise<void> {
      // no-op: FSA 无权限位
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      const data = await promises.readFile(oldPath);
      await promises.writeFile(newPath, data as Uint8Array);
      await promises.unlink(oldPath);
    },
  };

  return { promises };
}

export type FsAdapter = ReturnType<typeof createFsAdapter>;
