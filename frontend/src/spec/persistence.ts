import { workspace } from '../workspace/FileSystemWorkspace';
import type { SpecDoc, SpecStatus } from './types';
import { renderSpecMarkdown } from './types';

const SPECS_DIR = 'specs';

function specJsonPath(id: string): string {
  return `${SPECS_DIR}/${id}/spec.json`;
}

function specMarkdownPath(id: string): string {
  return `${SPECS_DIR}/${id}/spec.md`;
}

/** 保存方案文档（同时写入可读 Markdown 副本） */
export async function saveSpec(doc: SpecDoc): Promise<void> {
  await workspace.writeCottagePath(specJsonPath(doc.id), doc);
  await workspace.writeCottageText(specMarkdownPath(doc.id), renderSpecMarkdown(doc));
}

export async function loadSpec(id: string): Promise<SpecDoc | null> {
  return workspace.readCottagePath<SpecDoc>(specJsonPath(id));
}

/** 列出未完成的方案（会话恢复用） */
export async function listActiveSpecs(): Promise<SpecDoc[]> {
  if (!workspace.isOpen) return [];

  let cottageDir: FileSystemDirectoryHandle;
  try {
    cottageDir = await workspace.ensureCottageDir();
  } catch {
    return [];
  }

  let specsDir: FileSystemDirectoryHandle;
  try {
    specsDir = await cottageDir.getDirectoryHandle(SPECS_DIR);
  } catch {
    return [];
  }

  const terminal: SpecStatus[] = ['completed', 'failed'];
  const docs: SpecDoc[] = [];
  for await (const [name, handle] of specsDir.entries()) {
    if (handle.kind !== 'directory') continue;
    const doc = await loadSpec(name).catch(() => null);
    if (doc && !terminal.includes(doc.status)) {
      docs.push(doc);
    }
  }
  return docs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteSpec(id: string): Promise<void> {
  await workspace.deleteEntry(`${SPECS_DIR}/${id}`);
}
