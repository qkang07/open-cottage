import { z } from 'zod';
import { cottageTool, type CottageTool } from '../agent/runtime/tool';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const normalizeEvalPath = (path: string): string => {
  const parts = path.replace(/\\/g, '/').split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (normalized.length === 0) throw new Error(`路径超出工作区：${path}`);
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  const result = normalized.join('/');
  if (!result) throw new Error(`无效文件路径：${path}`);
  return result;
};

const copyBytes = (bytes: Uint8Array): Uint8Array => new Uint8Array(bytes);

export class EvalMemoryWorkspace {
  private readonly files = new Map<string, Uint8Array>();

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) {
      this.files.set(normalizeEvalPath(path), encoder.encode(content));
    }
  }

  exists(path: string): boolean {
    return this.files.has(normalizeEvalPath(path));
  }

  readText(path: string): string {
    const normalized = normalizeEvalPath(path);
    const bytes = this.files.get(normalized);
    if (!bytes) throw new Error(`文件不存在：${normalized}`);
    return decoder.decode(bytes);
  }

  writeText(path: string, content: string): { before: string; created: boolean } {
    const normalized = normalizeEvalPath(path);
    const previous = this.files.get(normalized);
    const before = previous ? decoder.decode(previous) : '';
    this.files.set(normalized, encoder.encode(content));
    return { before, created: previous === undefined };
  }

  delete(path: string): boolean {
    return this.files.delete(normalizeEvalPath(path));
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(
      [...this.files.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, bytes]) => [path, decoder.decode(copyBytes(bytes))]),
    );
  }
}

export const changedEvalPaths = (
  before: Record<string, string>,
  after: Record<string, string>,
): string[] => {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths]
    .filter((path) => before[path] !== after[path])
    .sort((a, b) => a.localeCompare(b));
};

export const createEvalWorkspaceTools = (
  workspace: EvalMemoryWorkspace,
): CottageTool[] => [
  cottageTool(
    async ({ path }) => ({ path, content: workspace.readText(path) }),
    {
      name: 'readFile',
      description: '读取确定性评测工作区中的文本文件。',
      schema: z.object({ path: z.string() }),
    },
  ),
  cottageTool(
    async ({ path, content }) => {
      workspace.writeText(path, content);
      return { path, written: true };
    },
    {
      name: 'writeFile',
      description: '写入确定性评测工作区中的文本文件。',
      schema: z.object({ path: z.string(), content: z.string() }),
    },
  ),
  cottageTool(
    async ({ paths }) => ({
      deleted: paths.filter((path) => workspace.delete(path)),
    }),
    {
      name: 'deleteFiles',
      description: '删除确定性评测工作区中的文件。',
      schema: z.object({ paths: z.array(z.string()).min(1) }),
    },
  ),
];
