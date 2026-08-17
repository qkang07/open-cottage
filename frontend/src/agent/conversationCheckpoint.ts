import { workspace } from '../workspace/FileSystemWorkspace';
import type { StoredMessage } from './messages';
import type { ContextUsage } from './tokenCounter';
import type { ExecutionPlan } from '../platform/plan/types';
import type { PlanSessionCounters } from '../platform/plan/types';
import { restoreTree } from '../history/historyService';
import type { CottageAgent } from './CottageAgent';
import type { EventBus } from '../platform/events';

export type CheckpointTrigger =
  | 'pre_turn'
  | 'post_turn'
  | 'pre_risky_tool'
  | 'pre_compaction'
  | 'pre_rewind'
  | 'manual';

export interface ConversationCheckpoint {
  id: string;
  sessionId: string;
  at: number;
  trigger: CheckpointTrigger;
  label: string;
  /** 对话历史快照在 history/{id}.json 中的相对路径（可与其它检查点共享） */
  historyRef: string;
  /** 关联的版本历史 v2 版本 ID，rewind 时用于 restoreTree。 */
  workspaceVersionId?: string | null;
  /** @deprecated 旧 Git 历史引用仅为兼容读取而保留，新版不会使用。 */
  workspaceCheckpointOid?: string | null;
  /** 当时 storedHistory 长度，用于 UI 显示"回到第 N 条" */
  messageCount: number;
  /** 末条消息 id，用于同内容复用快速判断 */
  lastMessageId?: string | null;
  /**
   * @deprecated 新写入不再落盘；请从 history 快照读取。旧索引可能仍有值。
   */
  contextUsage?: ContextUsage | null;
  /**
   * @deprecated 新写入不再落盘；请从 history 快照读取。旧索引可能仍有值。
   */
  planState?: PlanStateSnapshot | null;
}

export interface PlanStateSnapshot {
  plan: ExecutionPlan | null;
  lastBlockedReason?: string;
  counters: PlanSessionCounters;
}

/** 对外展开后的完整快照（读 API 始终返回此形状） */
export interface ConversationSnapshot {
  history: StoredMessage[];
  contextUsage: ContextUsage | null;
  planState: PlanStateSnapshot | null;
}

/** 磁盘上的 v2 full 快照 */
interface SnapshotFileFull {
  v: 2;
  kind: 'full';
  history: StoredMessage[];
  contextUsage: ContextUsage | null;
  planState: PlanStateSnapshot | null;
}

/** 磁盘上的 v2 delta：相对 base 检查点仅追加后缀 */
interface SnapshotFileDelta {
  v: 2;
  kind: 'delta';
  baseId: string;
  prefixLen: number;
  append: StoredMessage[];
  contextUsage: ContextUsage | null;
  planState: PlanStateSnapshot | null;
}

/** v1 旧全量（无 v/kind） */
interface SnapshotFileV1 {
  history: StoredMessage[];
  contextUsage?: ContextUsage | null;
  planState?: PlanStateSnapshot | null;
}

type SnapshotFile = SnapshotFileFull | SnapshotFileDelta | SnapshotFileV1;

const checkpointsPath = (sessionId: string) =>
  `sessions/${sessionId}/checkpoints.json`;

const historyRefPath = (sessionId: string, checkpointId: string) =>
  `sessions/${sessionId}/history/${checkpointId}.json`;

const planPath = (sessionId: string) => `sessions/${sessionId}/plan.json`;

const messageIds = (history: readonly StoredMessage[]): Array<string | undefined> =>
  history.map((m) => m.id);

const isPrefixOf = (
  prefix: readonly (string | undefined)[],
  full: readonly (string | undefined)[],
): boolean => {
  if (prefix.length > full.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (prefix[i] !== full[i]) return false;
  }
  return true;
};

const idsEqual = (
  a: readonly (string | undefined)[],
  b: readonly (string | undefined)[],
): boolean => a.length === b.length && isPrefixOf(a, b);

const isDeltaFile = (data: SnapshotFile): data is SnapshotFileDelta =>
  'v' in data && data.v === 2 && data.kind === 'delta';

const isFullV2File = (data: SnapshotFile): data is SnapshotFileFull =>
  'v' in data && data.v === 2 && data.kind === 'full';

const toResolvedSnapshot = (
  history: StoredMessage[],
  contextUsage: ContextUsage | null | undefined,
  planState: PlanStateSnapshot | null | undefined,
): ConversationSnapshot => ({
  history,
  contextUsage: contextUsage ?? null,
  planState: planState ?? null,
});

export async function listCheckpoints(
  sessionId: string,
): Promise<ConversationCheckpoint[]> {
  const data = await workspace.readCottagePath<ConversationCheckpoint[]>(
    checkpointsPath(sessionId),
  );
  return data ?? [];
}

async function saveCheckpoints(
  sessionId: string,
  entries: ConversationCheckpoint[],
): Promise<void> {
  await workspace.writeCottagePath(checkpointsPath(sessionId), entries);
}

export async function appendCheckpoint(
  entry: ConversationCheckpoint,
): Promise<void> {
  const existing = await listCheckpoints(entry.sessionId);
  existing.push(entry);
  await saveCheckpoints(entry.sessionId, existing);
}

/**
 * 展开 history 文件（支持 v1 full / v2 full / v2 delta 链）。
 * entries 用于按 baseId 解析 delta；缺省时会重新 listCheckpoints。
 */
async function resolveSnapshotFromRef(
  historyRef: string,
  entries: ConversationCheckpoint[],
  visiting: Set<string>,
): Promise<ConversationSnapshot> {
  if (visiting.has(historyRef)) {
    console.error('[ConversationCheckpoint] delta 链循环:', historyRef);
    return { history: [], contextUsage: null, planState: null };
  }
  visiting.add(historyRef);

  const data = await workspace.readCottagePath<SnapshotFile>(historyRef);
  if (!data) {
    return { history: [], contextUsage: null, planState: null };
  }

  if (isDeltaFile(data)) {
    const baseEntry = entries.find((e) => e.id === data.baseId);
    if (!baseEntry) {
      console.error(
        '[ConversationCheckpoint] delta base 未找到:',
        data.baseId,
      );
      return toResolvedSnapshot(
        data.append,
        data.contextUsage,
        data.planState,
      );
    }
    const baseSnap = await resolveSnapshotFromRef(
      baseEntry.historyRef,
      entries,
      visiting,
    );
    const prefix = baseSnap.history.slice(0, data.prefixLen);
    return toResolvedSnapshot(
      [...prefix, ...data.append],
      data.contextUsage,
      data.planState,
    );
  }

  if (isFullV2File(data)) {
    return toResolvedSnapshot(data.history, data.contextUsage, data.planState);
  }

  // v1
  return toResolvedSnapshot(
    Array.isArray(data.history) ? data.history : [],
    data.contextUsage,
    data.planState,
  );
}

export async function loadCheckpointSnapshot(
  checkpoint: ConversationCheckpoint,
  entries?: ConversationCheckpoint[],
): Promise<ConversationSnapshot> {
  const list = entries ?? (await listCheckpoints(checkpoint.sessionId));
  return resolveSnapshotFromRef(checkpoint.historyRef, list, new Set());
}

export async function loadLastCheckpoint(
  sessionId: string,
): Promise<ConversationCheckpoint | null> {
  const entries = await listCheckpoints(sessionId);
  if (entries.length === 0) return null;
  return entries[entries.length - 1];
}

export interface CreateCheckpointOptions {
  sessionId: string;
  trigger: CheckpointTrigger;
  label: string;
  history: StoredMessage[];
  contextUsage: ContextUsage | null;
  planState: PlanStateSnapshot | null;
  workspaceVersionId?: string | null;
  /** @deprecated 仅允许旧调用方编译兼容，不会写入新记录。 */
  workspaceCheckpointOid?: string | null;
}

export async function createConversationCheckpoint(
  opts: CreateCheckpointOptions,
): Promise<ConversationCheckpoint> {
  const id = crypto.randomUUID();
  const entries = await listCheckpoints(opts.sessionId);
  const last = entries.length > 0 ? entries[entries.length - 1] : null;
  const lastMessageId = opts.history.at(-1)?.id ?? null;

  let historyRef = historyRefPath(opts.sessionId, id);

  if (last) {
    const lastSnap = await loadCheckpointSnapshot(last, entries);
    const lastIds = messageIds(lastSnap.history);
    const newIds = messageIds(opts.history);

    // 同内容：复用已有 history 文件，不写新快照
    if (idsEqual(lastIds, newIds)) {
      historyRef = last.historyRef;
    } else if (isPrefixOf(lastIds, newIds)) {
      // 纯追加：写 delta
      const delta: SnapshotFileDelta = {
        v: 2,
        kind: 'delta',
        baseId: last.id,
        prefixLen: lastSnap.history.length,
        append: opts.history.slice(lastSnap.history.length),
        contextUsage: opts.contextUsage,
        planState: opts.planState,
      };
      await workspace.writeCottagePath(historyRef, delta);
    } else {
      // rewind / 非前缀：写 full
      const full: SnapshotFileFull = {
        v: 2,
        kind: 'full',
        history: opts.history,
        contextUsage: opts.contextUsage,
        planState: opts.planState,
      };
      await workspace.writeCottagePath(historyRef, full);
    }
  } else {
    const full: SnapshotFileFull = {
      v: 2,
      kind: 'full',
      history: opts.history,
      contextUsage: opts.contextUsage,
      planState: opts.planState,
    };
    await workspace.writeCottagePath(historyRef, full);
  }

  // 索引瘦身：不再写入 contextUsage / planState
  const entry: ConversationCheckpoint = {
    id,
    sessionId: opts.sessionId,
    at: Date.now(),
    trigger: opts.trigger,
    label: opts.label,
    historyRef,
    workspaceVersionId: opts.workspaceVersionId ?? null,
    messageCount: opts.history.length,
    lastMessageId,
  };
  await appendCheckpoint(entry);
  return entry;
}

export async function savePlanState(
  sessionId: string,
  planState: PlanStateSnapshot,
): Promise<void> {
  await workspace.writeCottagePath(planPath(sessionId), planState);
}

export async function loadPlanState(
  sessionId: string,
): Promise<PlanStateSnapshot | null> {
  return await workspace.readCottagePath<PlanStateSnapshot>(planPath(sessionId));
}

export async function removeCheckpoints(
  sessionId: string,
): Promise<void> {
  await saveCheckpoints(sessionId, []);
}

export interface RewindOptions {
  agent: CottageAgent;
  checkpointId: string;
  eventBus?: EventBus | null;
}

/**
 * 回滚到指定对话检查点（绑定工作区）。
 *
 * 1. 先建 pre_rewind 安全检查点，rewind 失败可回滚
 * 2. 读目标 checkpoint 的 history 快照
 * 3. 若有 workspaceVersionId，调 restoreTree 恢复 v2 工作区版本
 * 4. agent.restore(snapshot) 还原 storedHistory / contextUsage / planSession
 * 5. emit CheckpointRewound 事件
 */
export async function rewindToCheckpoint(
  opts: RewindOptions,
): Promise<boolean> {
  const { agent, checkpointId, eventBus } = opts;
  const sessionId = agent.getSessionId();
  if (!sessionId) {
    console.error('[ConversationCheckpoint] agent 无 sessionId，无法 rewind');
    return false;
  }

  const entries = await listCheckpoints(sessionId);
  const checkpoint = entries.find((e) => e.id === checkpointId);
  if (!checkpoint) {
    console.error('[ConversationCheckpoint] 未找到 checkpoint:', checkpointId);
    return false;
  }

  // 1. pre_rewind 安全网
  const preRewindSnapshot = agent.snapshot();
  await createConversationCheckpoint({
    sessionId,
    trigger: 'pre_rewind',
    label: '回滚前自动快照',
    history: preRewindSnapshot.history,
    contextUsage: preRewindSnapshot.contextUsage,
    planState: preRewindSnapshot.planState,
    workspaceVersionId: null,
  });

  // 2. 读目标快照（需重新 list，因刚追加了 pre_rewind）
  const snapshot = await loadCheckpointSnapshot(checkpoint);

  // 3. 回滚工作区
  if (checkpoint.workspaceVersionId) {
    try {
      const restored = await restoreTree(checkpoint.workspaceVersionId);
      if (!restored) return false;
    } catch (error) {
      console.error('[ConversationCheckpoint] restoreTree 失败:', error);
      return false;
    }
  }

  // 4. 还原 agent 状态
  agent.restore(snapshot);

  // 5. emit 事件
  eventBus?.emit({
    type: 'checkpoint_rewound',
    at: Date.now(),
    checkpointId,
  });

  return true;
}
