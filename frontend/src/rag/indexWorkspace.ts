/**
 * RAG 索引工作区 I/O 抽象：主线程 workspace 与 Worker FSA 共用。
 */

import { matchesAnyGlob } from '../workspace/search';
import { isTraverseSkippedDirName } from '../workspace/traverseIgnore';

export interface ListIndexFilesOptions {
  /** 匹配到的路径不加入结果；目录若整棵会被忽略则不再递归 */
  ignoreGlobs?: readonly string[];
}

export interface IndexWorkspace {
  listFiles(options?: ListIndexFilesOptions): Promise<string[]>;
  readFile(path: string): Promise<string | null>;
  readFileBytes(path: string): Promise<Uint8Array | null>;
  writeFile(path: string, content: string): Promise<void>;
  writeFileBytes(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  deleteFile(path: string): Promise<void>;
}

const normalizePath = (path: string): string => path.replace(/\\/g, '/');

/** 若该目录下任意普通文件路径都会命中忽略规则，则跳过递归 */
export const shouldSkipIgnoredDirectory = (
  relativeDirPath: string,
  ignoreGlobs: readonly string[] | undefined,
): boolean => {
  if (!ignoreGlobs?.length || !relativeDirPath) return false;
  return matchesAnyGlob(`${relativeDirPath}/__cottage_ignore__`, ignoreGlobs);
};

export const createIndexWorkspaceFromFs = (
  fs: {
    promises: {
      readFile: (
        filepath: string,
        opts?: { encoding?: string },
      ) => Promise<Uint8Array | string>;
      writeFile: (
        filepath: string,
        data: Uint8Array | string,
      ) => Promise<void>;
      stat: (filepath: string) => Promise<{ isFile(): boolean; isDirectory(): boolean }>;
      readdir: (filepath: string) => Promise<string[]>;
      unlink: (filepath: string) => Promise<void>;
    };
  },
): IndexWorkspace => {
  const filePath = (path: string) => {
    const normalized = normalizePath(path);
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  };

  const listAllFiles = async (options?: ListIndexFilesOptions): Promise<string[]> => {
    const ignoreGlobs = options?.ignoreGlobs;
    const entries: string[] = [];

    const walk = async (dirPath: string, prefix: string) => {
      let names: string[];
      try {
        names = await fs.promises.readdir(dirPath);
      } catch {
        return;
      }
      for (const name of names) {
        if (name.startsWith('.')) continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        const full = dirPath === '/' ? `/${name}` : `${dirPath}/${name}`;
        try {
          const stat = await fs.promises.stat(full);
          if (stat.isDirectory()) {
            if (isTraverseSkippedDirName(name)) continue;
            if (shouldSkipIgnoredDirectory(rel, ignoreGlobs)) continue;
            await walk(full, rel);
          } else if (stat.isFile()) {
            if (matchesAnyGlob(rel, ignoreGlobs)) continue;
            entries.push(rel);
          }
        } catch {
          // skip
        }
      }
    };

    await walk('/', '');
    return entries.sort();
  };

  return {
    listFiles: listAllFiles,
    async readFile(path) {
      try {
        const text = await fs.promises.readFile(filePath(path), { encoding: 'utf8' });
        return typeof text === 'string' ? text : null;
      } catch {
        return null;
      }
    },
    async readFileBytes(path) {
      try {
        const bytes = await fs.promises.readFile(filePath(path));
        return bytes instanceof Uint8Array ? bytes : null;
      } catch {
        return null;
      }
    },
    async writeFile(path, content) {
      await fs.promises.writeFile(filePath(path), content);
    },
    async writeFileBytes(path, data) {
      await fs.promises.writeFile(filePath(path), data);
    },
    async exists(path) {
      try {
        await fs.promises.stat(filePath(path));
        return true;
      } catch {
        return false;
      }
    },
    async deleteFile(path) {
      try {
        await fs.promises.unlink(filePath(path));
      } catch {
        // ignore
      }
    },
  };
};

export const createIndexWorkspaceFromFileSystem = (
  workspace: {
    listFiles: () => Promise<string[]>;
    readFile: (path: string) => Promise<{ content: string }>;
    readFileBytes: (path: string) => Promise<Uint8Array>;
    writeFile: (path: string, content: string) => Promise<unknown>;
    writeFileBytes: (path: string, data: Uint8Array | ArrayBuffer) => Promise<unknown>;
    exists: (path: string) => Promise<boolean>;
    deleteFile: (path: string) => Promise<unknown>;
  },
): IndexWorkspace => ({
  async listFiles(options) {
    const all = await workspace.listFiles();
    const ignoreGlobs = options?.ignoreGlobs;
    if (!ignoreGlobs?.length) return all;
    return all.filter((path) => !matchesAnyGlob(path, ignoreGlobs));
  },
  async readFile(path) {
    try {
      const { content } = await workspace.readFile(path);
      return content || null;
    } catch {
      return null;
    }
  },
  async readFileBytes(path) {
    try {
      return await workspace.readFileBytes(path);
    } catch {
      return null;
    }
  },
  writeFile: (path, content) => workspace.writeFile(path, content).then(() => undefined),
  writeFileBytes: (path, data) =>
    workspace.writeFileBytes(path, data).then(() => undefined),
  exists: (path) => workspace.exists(path),
  async deleteFile(path) {
    try {
      await workspace.deleteFile(path);
    } catch {
      // ignore
    }
  },
});
