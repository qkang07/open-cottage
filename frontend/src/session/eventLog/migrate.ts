import type { StoredMessage } from '../../agent/messages';
import {
  chatSessionFile,
  legacyTraceFile,
  traceFile,
  type ChatSessionRuntimeMeta,
} from '../../config/constants';
import { workspace } from '../../workspace/FileSystemWorkspace';
import {
  loadSessionEvents,
  parseSessionEventsText,
  SessionEventLog,
  sessionEventsFileExists,
} from './log';
import {
  ensureMessageIds,
  messagesToEvents,
  projectSessionState,
  type SessionProjectedState,
} from './project';
import type { SessionEvent } from './types';

const loadLegacyTraceEvents = async (
  sessionId: string,
): Promise<SessionEvent[]> => {
  let text = await workspace.readCottageText(traceFile(sessionId));
  if (!text?.trim()) {
    text = await workspace.readCottageText(legacyTraceFile(sessionId));
  }
  return parseSessionEventsText(text);
};

interface LegacyChatFile {
  history: StoredMessage[];
  runtime?: ChatSessionRuntimeMeta;
}

const readLegacyChatFile = async (
  sessionId: string,
): Promise<LegacyChatFile | null> => {
  const raw = await workspace.readCottageJson<unknown>(chatSessionFile(sessionId));
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return { history: raw as StoredMessage[], runtime: undefined };
  }
  if (typeof raw === 'object' && raw && 'history' in raw) {
    const obj = raw as {
      history?: StoredMessage[];
      runtime?: ChatSessionRuntimeMeta;
    };
    return {
      history: Array.isArray(obj.history) ? obj.history : [],
      runtime: obj.runtime,
    };
  }
  return null;
};

/**
 * 若尚无 events.jsonl，则从 chat-{id}.json + 旧 trace.jsonl 一次性迁移并写入。
 * 迁移后仍保留旧文件（只读兼容），新写入只走 events.jsonl。
 */
export const ensureSessionEventsMigrated = async (
  sessionId: string,
): Promise<SessionEvent[]> => {
  if (!workspace.isOpen) return [];

  const existing = await loadSessionEvents(sessionId);
  if (existing.length > 0) return existing;

  const legacyChat = await readLegacyChatFile(sessionId);
  const legacyTrace = await loadLegacyTraceEvents(sessionId);
  const events: SessionEvent[] = [];

  if (legacyChat?.history.length) {
    const baseAt =
      legacyTrace[0]?.at ??
      legacyChat.runtime?.capturedAt ??
      Date.now() - legacyChat.history.length;
    events.push(...messagesToEvents(ensureMessageIds(legacyChat.history), baseAt));
  }

  events.push(...legacyTrace);

  if (legacyChat?.runtime) {
    events.push({
      type: 'runtime',
      at: legacyChat.runtime.capturedAt || Date.now(),
      runtime: legacyChat.runtime,
    });
  }

  if (events.length === 0) return [];

  events.sort((a, b) => a.at - b.at);
  const log = new SessionEventLog(sessionId, { flushDelayMs: 0 });
  log.appendMany(events);
  await log.flush();
  return events;
};

export const loadSessionProjectedState = async (
  sessionId: string,
): Promise<SessionProjectedState> => {
  const events = await ensureSessionEventsMigrated(sessionId);
  return projectSessionState(events);
};

export const sessionStoreExists = async (sessionId: string): Promise<boolean> => {
  if (await sessionEventsFileExists(sessionId)) return true;
  if (!workspace.isOpen) return false;
  const legacy = await workspace.readCottageJson<unknown>(chatSessionFile(sessionId));
  return legacy !== null;
};
