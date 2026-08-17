import { hashBytes } from '../history/storage';
import { workspace } from '../workspace/FileSystemWorkspace';
import type {
  PlanCommit,
  PlanDefinition,
  PlanEvent,
  PlanHead,
  PlanManifest,
  PlanRun,
} from './types';

const root = (planId: string) => `plans/v1/${planId}`;
const definitionPath = (planId: string, revision: number) =>
  `${root(planId)}/definition.${revision}.json`;
const commitPath = (planId: string, commitId: string) =>
  `${root(planId)}/commits/${commitId}.json`;
const commitManifestPath = (planId: string, commitId: string) =>
  `${root(planId)}/commits/${commitId}.manifest.json`;
const commitVerifyPath = (planId: string, commitId: string) =>
  `${root(planId)}/commits/${commitId}.verify.json`;
const headPath = (planId: string) => `${root(planId)}/head.json`;
const runPath = (planId: string) => `${root(planId)}/run.json`;
const eventsPath = (planId: string) => `${root(planId)}/events.jsonl`;
const verifyPath = (planId: string) => `${root(planId)}/verify.json`;
const manifestPath = (planId: string) => `${root(planId)}/manifest.json`;

const encoder = new TextEncoder();

const checksumPayload = (commit: Omit<PlanCommit, 'checksum'>) => ({
  schema: commit.schema,
  commitId: commit.commitId,
  parentCommitId: commit.parentCommitId,
  planId: commit.planId,
  definitionRevision: commit.definitionRevision,
  manifestChecksum: commit.manifestChecksum,
  verifyChecksum: commit.verifyChecksum,
  run: commit.run,
  event: commit.event,
  createdAt: commit.createdAt,
});

const checksumFor = (commit: Omit<PlanCommit, 'checksum'>) =>
  hashBytes(encoder.encode(JSON.stringify(checksumPayload(commit))));

const artifactChecksum = (value: unknown) =>
  hashBytes(encoder.encode(JSON.stringify(value)));

export class PlanRepositoryError extends Error {
  readonly code = 'repository_corrupt' as const;

  constructor(
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PlanRepositoryError';
  }
}

export interface StoredPlan {
  definition: PlanDefinition;
  run: PlanRun;
  head?: PlanHead;
  commit?: PlanCommit;
}

export interface CommitPlanInput {
  definition: PlanDefinition;
  run: PlanRun;
  event: PlanEvent;
  manifest?: PlanManifest;
  writeDefinition?: boolean;
}

/**
 * Plan v1 repository. Immutable commits plus head are authoritative; run/events
 * remain best-effort compatibility projections for existing readers.
 */
export class PlanRepository {
  saveDefinition(definition: PlanDefinition) {
    return workspace.writeCottagePath(
      definitionPath(definition.id, definition.revision),
      definition,
    );
  }

  loadDefinition(planId: string, revision: number) {
    return workspace.readCottagePath<PlanDefinition>(definitionPath(planId, revision));
  }

  async loadLatestDefinition(planId: string): Promise<PlanDefinition | null> {
    const files = await workspace.listCottageFiles(root(planId)).catch(() => []);
    const revisions = files
      .map((path) => path.match(/definition\.(\d+)\.json$/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
    return revisions.length ? this.loadDefinition(planId, revisions[0]!) : null;
  }

  loadHead(planId: string) {
    return workspace.readCottagePath<PlanHead>(headPath(planId));
  }

  loadCommit(planId: string, commitId: string) {
    return workspace.readCottagePath<PlanCommit>(commitPath(planId, commitId));
  }

  async assertCommit(planId: string, commit: PlanCommit): Promise<void> {
    if (commit.planId !== planId || commit.schema !== 1) {
      throw new PlanRepositoryError('计划提交与 head 不匹配', {
        planId,
        commitId: commit.commitId,
      });
    }
    const { checksum: _checksum, ...payload } = commit;
    const actual = await checksumFor(payload);
    if (actual !== commit.checksum) {
      throw new PlanRepositoryError('计划提交 checksum 校验失败', {
        planId,
        commitId: commit.commitId,
      });
    }
    if (commit.parentCommitId) {
      const parent = await this.loadCommit(planId, commit.parentCommitId);
      if (!parent) {
        throw new PlanRepositoryError('计划提交缺少父提交', {
          planId,
          commitId: commit.commitId,
          parentCommitId: commit.parentCommitId,
        });
      }
      const { checksum: _parentChecksum, ...parentPayload } = parent;
      if ((await checksumFor(parentPayload)) !== parent.checksum) {
        throw new PlanRepositoryError('计划父提交 checksum 校验失败', {
          planId,
          parentCommitId: parent.commitId,
        });
      }
      const visited = new Set([commit.commitId, parent.commitId]);
      let ancestor = parent;
      while (ancestor.parentCommitId) {
        if (visited.has(ancestor.parentCommitId)) {
          throw new PlanRepositoryError('计划提交链存在循环', {
            planId,
            commitId: ancestor.parentCommitId,
          });
        }
        const next = await this.loadCommit(planId, ancestor.parentCommitId);
        if (!next) {
          throw new PlanRepositoryError('计划提交链缺少祖先提交', {
            planId,
            parentCommitId: ancestor.parentCommitId,
          });
        }
        if (next.planId !== planId || next.schema !== 1) {
          throw new PlanRepositoryError('计划祖先提交归属无效', {
            planId,
            commitId: next.commitId,
          });
        }
        const { checksum: _ancestorChecksum, ...ancestorPayload } = next;
        if ((await checksumFor(ancestorPayload)) !== next.checksum) {
          throw new PlanRepositoryError('计划祖先提交 checksum 校验失败', {
            planId,
            commitId: next.commitId,
          });
        }
        visited.add(next.commitId);
        ancestor = next;
      }
    }
    if (commit.manifestChecksum) {
      const manifest = await workspace.readCottagePath<PlanManifest>(
        commitManifestPath(planId, commit.commitId),
      );
      if (!manifest || (await artifactChecksum(manifest)) !== commit.manifestChecksum) {
        throw new PlanRepositoryError('计划提交的 manifest 缺失或 checksum 无效', {
          planId,
          commitId: commit.commitId,
        });
      }
    }
    if (commit.verifyChecksum) {
      const verify = await workspace.readCottagePath<PlanRun['finalVerification']>(
        commitVerifyPath(planId, commit.commitId),
      );
      if (!verify || (await artifactChecksum(verify)) !== commit.verifyChecksum) {
        throw new PlanRepositoryError('计划提交的 verify 报告缺失或 checksum 无效', {
          planId,
          commitId: commit.commitId,
        });
      }
    }
  }

  async commit(input: CommitPlanInput): Promise<StoredPlan> {
    const { definition, event } = input;
    const previousHead = await this.loadHead(definition.id);
    if (previousHead && previousHead.commitId !== input.run.commitId) {
      throw new PlanRepositoryError('计划 head 已由另一标签页推进，请重新加载后再继续', {
        planId: definition.id,
        expectedCommitId: input.run.commitId,
        actualCommitId: previousHead.commitId,
      });
    }
    if (input.writeDefinition !== false) {
      const existing = await this.loadDefinition(definition.id, definition.revision);
      if (!existing) {
        await this.saveDefinition(definition);
      } else if (JSON.stringify(existing) !== JSON.stringify(definition)) {
        throw new PlanRepositoryError('不可变 definition revision 内容冲突', {
          planId: definition.id,
          revision: definition.revision,
        });
      }
    }

    const commitId = crypto.randomUUID();
    const createdAt = Date.now();
    const manifestChecksum = input.manifest
      ? await artifactChecksum(input.manifest)
      : undefined;
    const verifyChecksum = input.run.finalVerification
      ? await artifactChecksum(input.run.finalVerification)
      : undefined;
    const run: PlanRun = {
      ...input.run,
      commitId,
      recentEvents: [...(input.run.recentEvents ?? []), event].slice(-100),
      updatedAt: createdAt,
    };
    const withoutChecksum: Omit<PlanCommit, 'checksum'> = {
      schema: 1,
      commitId,
      parentCommitId: previousHead?.commitId,
      planId: definition.id,
      definitionRevision: definition.revision,
      manifestChecksum,
      verifyChecksum,
      run,
      event,
      createdAt,
    };
    const commit: PlanCommit = {
      ...withoutChecksum,
      checksum: await checksumFor(withoutChecksum),
    };

    // Immutable data first. createWritable + close replaces the head as one file.
    await workspace.writeCottagePath(commitPath(definition.id, commitId), commit);
    if (input.manifest) {
      await workspace.writeCottagePath(
        commitManifestPath(definition.id, commitId),
        input.manifest,
      );
    }
    if (run.finalVerification) {
      await workspace.writeCottagePath(
        commitVerifyPath(definition.id, commitId),
        run.finalVerification,
      );
    }

    const head: PlanHead = {
      schema: 1,
      planId: definition.id,
      commitId,
      approvedRevision: run.approvedRevision,
      updatedAt: createdAt,
    };
    await workspace.writeCottagePath(headPath(definition.id), head);

    // Compatibility projections are deliberately non-authoritative.
    if (input.manifest) {
      await workspace
        .writeCottagePath(manifestPath(definition.id), input.manifest)
        .catch(() => undefined);
    }
    if (run.finalVerification) {
      await workspace
        .writeCottagePath(verifyPath(definition.id), run.finalVerification)
        .catch(() => undefined);
    }
    await workspace.writeCottagePath(runPath(definition.id), run).catch(() => undefined);
    await workspace
      .appendCottageText(eventsPath(definition.id), `${JSON.stringify(event)}\n`)
      .catch(() => undefined);
    return { definition, run, head, commit };
  }

  async load(planId: string): Promise<StoredPlan | null> {
    const head = await this.loadHead(planId);
    if (head) {
      if (head.planId !== planId || !head.commitId) {
        throw new PlanRepositoryError('计划 head 无效', { planId });
      }
      const commit = await this.loadCommit(planId, head.commitId);
      if (!commit) {
        throw new PlanRepositoryError('计划 head 指向的提交不存在', {
          planId,
          commitId: head.commitId,
        });
      }
      await this.assertCommit(planId, commit);
      if (head.approvedRevision !== commit.run.approvedRevision) {
        throw new PlanRepositoryError('计划 head 与提交批准版本不一致', {
          planId,
          headRevision: head.approvedRevision,
          runRevision: commit.run.approvedRevision,
        });
      }
      const definition = await this.loadDefinition(planId, commit.definitionRevision);
      if (!definition) {
        throw new PlanRepositoryError('计划提交引用的 definition 不存在', {
          planId,
          revision: commit.definitionRevision,
        });
      }
      return { definition, run: commit.run, head, commit };
    }

    // Legacy v1 plans are read byte-for-byte without migration. Their first
    // subsequent mutation will create the initial commit/head.
    const run = await workspace.readCottagePath<PlanRun>(runPath(planId));
    if (!run) return null;
    const definition =
      run.status === 'awaiting_approval' || run.approvedRevision < 1
        ? await this.loadLatestDefinition(planId)
        : await this.loadDefinition(planId, run.approvedRevision);
    return definition ? { definition, run } : null;
  }

  async listPlanIds(): Promise<string[]> {
    const files = await workspace.listCottageFiles('plans/v1').catch(() => []);
    return [...new Set(
      files
        .filter((path) => path.endsWith('/head.json') || path.endsWith('/run.json'))
        .map((path) => path.split('/')[2])
        .filter((id): id is string => Boolean(id)),
    )];
  }
}

export const planRepository = new PlanRepository();
