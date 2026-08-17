import type { Artifact } from './types';

/** 超过此字符数的产物内容会被写入工作区文件，内存中只保留引用 */
export const ARTIFACT_INLINE_MAX_CHARS = 8 * 1024;

export interface ArtifactStoreOptions {
  orchestrationId: string;
  /** 将大产物写入工作区；返回持久化后的 filePath */
  persistLargeContent?: (
    artifactId: string,
    name: string,
    content: string,
  ) => Promise<string>;
  /** 从工作区读取大产物内容 */
  loadLargeContent?: (filePath: string) => Promise<string | null>;
}

export class ArtifactStore {
  private readonly artifacts = new Map<string, Artifact>();
  private readonly options: ArtifactStoreOptions;

  constructor(options: ArtifactStoreOptions) {
    this.options = options;
  }

  get(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  getAll(): Artifact[] {
    return [...this.artifacts.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  getByStep(stepId: string): Artifact[] {
    return this.getAll().filter((a) => a.producerStepId === stepId);
  }

  has(id: string): boolean {
    return this.artifacts.has(id);
  }

  async add(
    artifact: Omit<Artifact, 'createdAt'>,
  ): Promise<Artifact> {
    const existing = this.artifacts.get(artifact.id);
    if (existing) {
      return existing;
    }

    let filePath = artifact.filePath;
    let content = artifact.content;

    if (
      content &&
      content.length > ARTIFACT_INLINE_MAX_CHARS &&
      !filePath &&
      this.options.persistLargeContent
    ) {
      filePath = await this.options.persistLargeContent(
        artifact.id,
        artifact.name,
        content,
      );
      // 保留摘要/前段在内存便于预览
      content = content.slice(0, ARTIFACT_INLINE_MAX_CHARS);
    }

    const complete: Artifact = {
      ...artifact,
      content,
      filePath,
      createdAt: Date.now(),
    };
    this.artifacts.set(complete.id, complete);
    return complete;
  }

  async loadContent(artifactId: string): Promise<string | undefined> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) return undefined;
    if (artifact.filePath && this.options.loadLargeContent) {
      const full = await this.options.loadLargeContent(artifact.filePath);
      if (full !== null) return full;
    }
    return artifact.content;
  }

  remove(id: string): boolean {
    return this.artifacts.delete(id);
  }

  importAll(artifacts: Artifact[]): void {
    for (const artifact of artifacts) {
      this.artifacts.set(artifact.id, artifact);
    }
  }

  exportAll(): Artifact[] {
    return this.getAll();
  }

  clear(): void {
    this.artifacts.clear();
  }
}
