import type { StoredMessage } from '../agent/messages';
import { z } from 'zod';
import { parseChatComponents } from '../chat/components';
import { mergeLegacyComponentsIntoHistory } from '../chat/mergeLegacyComponents';
import { createChatModel } from '../agent/createModel';
import { workspace } from '../workspace/FileSystemWorkspace';
import {
  COTTAGE_CHAT_HISTORY_FILE,
  COTTAGE_CHATS_INDEX_FILE,
  MAX_CHAT_SESSIONS,
  type ChatSessionMeta,
  type ChatSessionRuntimeMeta,
  type ChatSessionSnapshot,
  type ChatSessionsIndex,
  chatSessionFile,
  sessionEventsFile,
} from './constants';
import { getActiveModelPreset, getLlmConfig } from './store';
import {
  getPresetApiKey,
  getSecretForProvider,
  type ProviderSecrets,
} from './secrets';
import {
  deleteSessionStoreFiles,
  loadSessionProjectedState,
  sessionStoreExists,
} from '../session/eventLog';


const emptyIndex = (): ChatSessionsIndex => ({
  activeId: null,
  sessions: [],
});

/** 会话是否有过用户输入（无输入则不计入历史记录） */
export const sessionHasUserInput = (
  history: readonly StoredMessage[],
): boolean => history.some((m) => m.role === 'user');

/** 置顶优先，其次按 updatedAt 降序 */
export const compareChatSessions = (
  a: ChatSessionMeta,
  b: ChatSessionMeta,
): number => {
  const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  if (pinDiff !== 0) return pinDiff;
  return b.updatedAt - a.updatedAt;
};

export const sortChatSessions = (
  sessions: readonly ChatSessionMeta[],
): ChatSessionMeta[] => [...sessions].sort(compareChatSessions);

const normalizeSessionMeta = (item: unknown): ChatSessionMeta | null => {
  if (
    typeof item !== 'object' ||
    item === null ||
    typeof (item as ChatSessionMeta).id !== 'string' ||
    typeof (item as ChatSessionMeta).title !== 'string' ||
    typeof (item as ChatSessionMeta).createdAt !== 'number' ||
    typeof (item as ChatSessionMeta).updatedAt !== 'number'
  ) {
    return null;
  }
  const raw = item as ChatSessionMeta;
  return {
    id: raw.id,
    title: raw.title,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ...(raw.pinned === true ? { pinned: true } : {}),
  };
};

const normalizeIndex = (raw: ChatSessionsIndex): ChatSessionsIndex => ({
  activeId: typeof raw.activeId === 'string' ? raw.activeId : null,
  sessions: Array.isArray(raw.sessions)
    ? raw.sessions
        .map(normalizeSessionMeta)
        .filter((item): item is ChatSessionMeta => item !== null)
    : [],
});

const MAX_TITLE_LENGTH = 48;
/** 超过此长度时再尝试 AI 精简标题（与 LLM 提示的目标字数对齐） */
const SHORT_TITLE_MAX = 12;

const chatTitleSchema = z.object({
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
});

/** 去除 XML/自定义标签，保留可读文本 */
const stripTags = (text: string): string =>
  text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** 取第一条用户消息中适合展示的纯文本（优先用户原文） */
const extractUserPromptText = (history: readonly StoredMessage[]): string => {
  const userMsg = history.find((m) => m.role === 'user');
  if (!userMsg) return '';
  const raw = (userMsg.userText ?? userMsg.content).trim();
  return stripTags(raw);
};

/** 同步标题：优先用户首条输入（截断），无输入则为「新对话」 */
const fallbackTitleFromHistory = (history: readonly StoredMessage[]): string => {
  const text = extractUserPromptText(history);
  return text.slice(0, MAX_TITLE_LENGTH) || '新对话';
};

/** 从历史直接推导标题（用户原文），不调用 LLM */
export const deriveTitleFromHistory = fallbackTitleFromHistory;

/** 用户原文是否偏长，值得用 AI 再精简 */
export const shouldRefineChatTitle = (
  history: readonly StoredMessage[],
): boolean => {
  const text = extractUserPromptText(history);
  if (!text) return false;
  return [...text].length > SHORT_TITLE_MAX;
};

const resolveTitleSecret = (secrets: ProviderSecrets) => {
  const activePreset = getActiveModelPreset();
  if (activePreset) {
    const presetSecret = getPresetApiKey(secrets, activePreset.id);
    if (presetSecret?.apiKey.trim()) return presetSecret;
  }
  const config = getLlmConfig();
  if (!config) return undefined;
  return getSecretForProvider(secrets, config.provider, config.connectionId);
};

/**
 * 生成聊天标题：短输入直接用用户原文；长输入尝试 LLM 精简，
 * 失败或不可用时回退到用户原文截断。
 */
export const generateChatTitle = async (
  history: readonly StoredMessage[],
  secrets: ProviderSecrets,
): Promise<string> => {
  const text = extractUserPromptText(history);
  if (!text) return '新对话';

  const provisional = fallbackTitleFromHistory(history);
  if (!shouldRefineChatTitle(history)) {
    return provisional;
  }

  try {
    const config = getLlmConfig();
    if (!config) return provisional;
    const secret = resolveTitleSecret(secrets);
    if (
      !secret ||
      (!secret.apiKey.trim() && !config.baseUrl?.trim() && !secret.baseUrl?.trim())
    ) {
      return provisional;
    }

    const model = createChatModel(
      { ...config, maxTokens: 20 },
      secret,
    );

    const prompt = [
      '请根据下面的用户问题生成一个简短、准确的中文聊天标题，控制在 12 个字以内。',
      '只输出标题文本，不要加引号、序号、解释或任何额外内容。',
      '',
      '用户问题：',
      text.slice(0, 500),
    ].join('\n');

    const response = await model.generateObject({
      messages: [{ role: 'user', content: prompt }],
      schema: chatTitleSchema,
      schemaName: 'chat_title',
      schemaDescription: '简短的中文聊天标题',
    });
    const generated = stripTags(response.value.title);
    const title = generated.replace(/^[\s"'""`]+|[\s"'""`]+$/g, '').trim();
    return title.slice(0, MAX_TITLE_LENGTH) || provisional;
  } catch {
    return provisional;
  }
};

const saveChatSessionsIndex = async (index: ChatSessionsIndex) => {
  if (!workspace.isOpen) return;
  await workspace.writeCottageJson(COTTAGE_CHATS_INDEX_FILE, index);
};

export const loadChatSessionsIndex = async (): Promise<ChatSessionsIndex> => {
  if (!workspace.isOpen) return emptyIndex();

  const stored = await workspace.readCottageJson<ChatSessionsIndex>(
    COTTAGE_CHATS_INDEX_FILE,
  );
  if (stored && Array.isArray(stored.sessions)) {
    return normalizeIndex(stored);
  }

  const legacy = await workspace.readCottageJson<StoredMessage[]>(
    COTTAGE_CHAT_HISTORY_FILE,
  );
  if (legacy?.length) {
    const now = Date.now();
    const id = crypto.randomUUID();
    const meta: ChatSessionMeta = {
      id,
      title: fallbackTitleFromHistory(legacy),
      createdAt: now,
      updatedAt: now,
    };
    await workspace.writeCottageJson(chatSessionFile(id), {
      schema: 'cottage-chat-session-v2',
      version: 1,
      history: legacy,
      runtime: undefined,
    });
    const index: ChatSessionsIndex = { activeId: id, sessions: [meta] };
    await saveChatSessionsIndex(index);
    return index;
  }

  return emptyIndex();
};

const emptySnapshot = (): ChatSessionSnapshot => ({
  schema: 'cottage-chat-session-v2',
  version: 1,
  history: [],
  runtime: undefined,
});

const parseSessionFile = (raw: unknown): ChatSessionSnapshot => {
  if (Array.isArray(raw)) {
    return {
      schema: 'cottage-chat-session-v2',
      version: 1,
      history: raw as StoredMessage[],
      runtime: undefined,
    };
  }
  if (raw && typeof raw === 'object' && 'history' in raw) {
    const obj = raw as Partial<ChatSessionSnapshot> & { components?: unknown };
    let history: StoredMessage[] = Array.isArray(obj.history) ? obj.history : [];
    // 兼容旧版旁路 components[]：合并进 toolCalls[].interaction 后不再单独保存
    const legacy = parseChatComponents(obj.components);
    if (legacy.length) {
      history = mergeLegacyComponentsIntoHistory(history, legacy);
    }
    return {
      schema: 'cottage-chat-session-v2',
      version: 1,
      history,
      runtime: obj.runtime,
    };
  }
  return emptySnapshot();
};

export const loadSessionSnapshot = async (
  sessionId: string,
): Promise<ChatSessionSnapshot> => {
  if (!workspace.isOpen) return emptySnapshot();
  const state = await loadSessionProjectedState(sessionId);
  if (state.events.length === 0 && state.transcript.length === 0) {
    // 兼容：事件日志为空时再试旧 chat-{id}.json（ensureSessionEventsMigrated 已处理，此处兜底）
    const raw = await workspace.readCottageJson<unknown>(chatSessionFile(sessionId));
    return parseSessionFile(raw);
  }
  return {
    schema: 'cottage-chat-session-v2',
    version: 1,
    history: state.transcript,
    llmHistory: state.llmHistory,
    runtime: state.runtime ?? undefined,
  };
};

export const saveSessionSnapshot = async (
  sessionId: string,
  snapshot: Pick<ChatSessionSnapshot, 'history' | 'runtime' | 'llmHistory'>,
): Promise<void> => {
  // 会话真相已改为 append-only events.jsonl；此函数仅保留兼容签名，不再整文件重写。
  void sessionId;
  void snapshot;
};

export const loadSessionHistory = async (
  sessionId: string,
): Promise<StoredMessage[]> => {
  const snapshot = await loadSessionSnapshot(sessionId);
  return snapshot.history;
};

export const saveSessionHistory = async (
  sessionId: string,
  history: readonly StoredMessage[],
  runtime?: ChatSessionRuntimeMeta,
): Promise<void> => {
  // 兼容旧调用：不再重写 chat-{id}.json。消息应在 Agent 侧实时 append 到事件日志。
  void sessionId;
  void history;
  void runtime;
};

export const createChatSession = async (
  title = '新对话',
): Promise<ChatSessionMeta> => {
  if (!workspace.isOpen) {
    throw new Error('请先打开工作区');
  }

  const now = Date.now();
  const meta: ChatSessionMeta = {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
  };

  // 占位 events.jsonl，避免 repair 把活跃空会话判为不存在
  try {
    await workspace.writeCottageText(sessionEventsFile(meta.id), '');
  } catch {
    // ignore
  }

  const index = await loadChatSessionsIndex();
  // 空会话只设为当前活跃，不写入历史列表（有用户输入后再列入）
  await saveChatSessionsIndex({ activeId: meta.id, sessions: index.sessions });
  return meta;
};

const chatSessionFileExists = async (sessionId: string): Promise<boolean> => {
  if (!workspace.isOpen) return false;
  return sessionStoreExists(sessionId);
};

/** 会话文件是否存在（含尚未列入历史的空会话） */
export const chatSessionExists = chatSessionFileExists;

export const setActiveChatSession = async (sessionId: string): Promise<void> => {
  const index = await loadChatSessionsIndex();
  const listed = index.sessions.some((s) => s.id === sessionId);
  if (!listed && !(await chatSessionFileExists(sessionId))) {
    throw new Error('会话不存在');
  }
  await saveChatSessionsIndex({ ...index, activeId: sessionId });
};

/**
 * 确保会话已进入历史列表（首次有用户输入时调用）。
 * 已在列表中则仅更新 meta。
 */
export const ensureChatSessionListed = async (
  sessionId: string,
  patch?: Partial<Pick<ChatSessionMeta, 'title'>>,
): Promise<ChatSessionMeta | null> => {
  if (!workspace.isOpen) return null;

  const index = await loadChatSessionsIndex();
  const now = Date.now();
  const existing = index.sessions.find((s) => s.id === sessionId);

  if (existing) {
    const updated: ChatSessionMeta = {
      ...existing,
      ...patch,
      updatedAt: now,
    };
    const sessions = sortChatSessions(
      index.sessions.map((s) => (s.id === sessionId ? updated : s)),
    );
    await saveChatSessionsIndex({ ...index, sessions });
    return updated;
  }

  const meta: ChatSessionMeta = {
    id: sessionId,
    title: patch?.title ?? '新对话',
    createdAt: now,
    updatedAt: now,
  };
  const sessions = sortChatSessions([meta, ...index.sessions]).slice(
    0,
    MAX_CHAT_SESSIONS,
  );
  await saveChatSessionsIndex({ ...index, sessions });
  return meta;
};

/** 设置会话置顶状态（不改动 updatedAt） */
export const setChatSessionPinned = async (
  sessionId: string,
  pinned: boolean,
): Promise<ChatSessionMeta | null> => {
  if (!workspace.isOpen) return null;

  const index = await loadChatSessionsIndex();
  const existing = index.sessions.find((s) => s.id === sessionId);
  if (!existing) return null;

  const updated: ChatSessionMeta = {
    id: existing.id,
    title: existing.title,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
    ...(pinned ? { pinned: true } : {}),
  };
  const sessions = sortChatSessions(
    index.sessions.map((s) => (s.id === sessionId ? updated : s)),
  );
  await saveChatSessionsIndex({ ...index, sessions });
  return updated;
};

export const touchChatSession = async (
  sessionId: string,
  patch: Partial<Pick<ChatSessionMeta, 'title'>>,
): Promise<ChatSessionMeta | null> => ensureChatSessionListed(sessionId, patch);

/** 删除会话文件并从历史索引中移除 */
export const deleteChatSession = async (sessionId: string): Promise<void> => {
  if (!workspace.isOpen) return;

  const index = await loadChatSessionsIndex();
  const sessions = sortChatSessions(
    index.sessions.filter((s) => s.id !== sessionId),
  );
  const activeId =
    index.activeId === sessionId ? (sessions[0]?.id ?? null) : index.activeId;
  await saveChatSessionsIndex({ activeId, sessions });

  try {
    await deleteSessionStoreFiles(sessionId);
  } catch {
    // 文件可能已不存在
  }
};

export const formatSessionTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** 补齐索引中缺失的会话历史文件，剔除无用户输入的历史项，并修正无效的 activeId */
export const repairChatSessionsIndex = async (): Promise<ChatSessionsIndex> => {
  if (!workspace.isOpen) return emptyIndex();

  await workspace.ensureCottageDir();

  const index = await loadChatSessionsIndex();

  const listed: ChatSessionMeta[] = [];
  for (const session of index.sessions) {
    const exists = await sessionStoreExists(session.id);
    if (!exists) {
      // 历史列表中的会话文件丢失：不再补空文件，直接丢弃该项
      continue;
    }
    const history = await loadSessionHistory(session.id);
    if (!sessionHasUserInput(history)) {
      // 无用户输入：不计入历史，删除残留文件（若仍是 active 则保留文件供当前会话使用）
      if (index.activeId !== session.id) {
        try {
          await deleteSessionStoreFiles(session.id);
        } catch {
          // ignore
        }
      }
      continue;
    }
    listed.push(session);
  }

  let activeId = index.activeId;
  if (activeId) {
    const activeListed = listed.some((s) => s.id === activeId);
    const activeExists = await chatSessionFileExists(activeId);
    if (!activeListed && activeExists) {
      const history = await loadSessionHistory(activeId);
      if (sessionHasUserInput(history)) {
        // 有输入但未入历史（例如中途刷新）：补回列表
        const now = Date.now();
        listed.unshift({
          id: activeId,
          title: fallbackTitleFromHistory(history),
          createdAt: now,
          updatedAt: now,
        });
      }
      // 无输入的活跃空会话：保留 activeId 与文件，但不入历史列表
    } else if (!activeListed && !activeExists) {
      activeId = listed[0]?.id ?? null;
    }
  }
  if (!activeId && listed.length > 0) {
    activeId = listed[0].id;
  }

  const repaired: ChatSessionsIndex = {
    activeId,
    sessions: sortChatSessions(listed),
  };
  if (
    repaired.activeId !== index.activeId ||
    repaired.sessions.length !== index.sessions.length ||
    repaired.sessions.some((s, i) => s.id !== index.sessions[i]?.id)
  ) {
    await saveChatSessionsIndex(repaired);
  }
  return repaired;
};
