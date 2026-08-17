import { workspace } from '../workspace/FileSystemWorkspace';
import type { LlmModelConfig } from '../config/constants';

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  lastActiveAt: number;
  status: 'active' | 'paused' | 'archived';
  mode: 'chat' | 'task';
  modelConfig?: LlmModelConfig;
  messageCount: number;
  lastCheckpointId?: string;
  /** busy 时崩溃，标记为 paused，resume 时提示"上次未完成" */
  interrupted?: boolean;
}

const INDEX_PATH = 'sessions/index.json';

async function readIndex(): Promise<SessionMeta[]> {
  const data = await workspace.readCottagePath<SessionMeta[]>(INDEX_PATH);
  return data ?? [];
}

async function writeIndex(sessions: SessionMeta[]): Promise<void> {
  await workspace.writeCottagePath(INDEX_PATH, sessions);
}

export async function listSessions(): Promise<SessionMeta[]> {
  const sessions = await readIndex();
  return sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

export async function getSession(id: string): Promise<SessionMeta | null> {
  const sessions = await readIndex();
  return sessions.find((s) => s.id === id) ?? null;
}

export interface CreateSessionInit {
  id: string;
  title?: string;
  mode?: 'chat' | 'task';
  modelConfig?: LlmModelConfig;
}

export async function createSession(init: CreateSessionInit): Promise<SessionMeta> {
  const now = Date.now();
  const meta: SessionMeta = {
    id: init.id,
    title: init.title ?? '新会话',
    createdAt: now,
    lastActiveAt: now,
    status: 'active',
    mode: init.mode ?? 'chat',
    modelConfig: init.modelConfig,
    messageCount: 0,
  };
  const sessions = await readIndex();
  sessions.push(meta);
  await writeIndex(sessions);
  return meta;
}

export async function updateSession(
  id: string,
  patch: Partial<SessionMeta>,
): Promise<void> {
  const sessions = await readIndex();
  const idx = sessions.findIndex((s) => s.id === id);
  if (idx < 0) return;
  sessions[idx] = { ...sessions[idx], ...patch, id: sessions[idx].id };
  await writeIndex(sessions);
}

export async function archiveSession(id: string): Promise<void> {
  await updateSession(id, { status: 'archived' });
}

export async function touchSession(id: string): Promise<void> {
  await updateSession(id, { lastActiveAt: Date.now() });
}

export async function markInterrupted(id: string): Promise<void> {
  await updateSession(id, { interrupted: true, status: 'paused' });
}

export async function clearInterrupted(id: string): Promise<void> {
  await updateSession(id, { interrupted: false, status: 'active' });
}

/**
 * 回合结束时调用，更新 messageCount、lastActiveAt、lastCheckpointId。
 */
export async function snapshotSession(
  id: string,
  messageCount: number,
  lastCheckpointId?: string,
): Promise<void> {
  await updateSession(id, {
    messageCount,
    lastActiveAt: Date.now(),
    lastCheckpointId,
  });
}
