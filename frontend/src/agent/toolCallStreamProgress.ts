import type { CottageMessage } from './messages';

export interface CottageToolCallChunk {
  id?: string;
  index?: number;
  name?: string;
  args?: string;
}

export type PendingToolCallProgress = {
  id: string;
  name: string;
  args: string;
};

const chunkKey = (chunk: CottageToolCallChunk): string => {
  if (chunk.id?.trim()) return chunk.id.trim();
  if (chunk.index !== undefined) return `index:${chunk.index}`;
  return 'default';
};

/** 将 runtime 流式工具参数片段合并为可展示的累积参数。 */
export const mergeToolCallChunks = (
  chunks: readonly CottageToolCallChunk[],
): PendingToolCallProgress[] => {
  const merged = new Map<string, PendingToolCallProgress>();

  for (const chunk of chunks) {
    const key = chunkKey(chunk);
    const existing = merged.get(key);
    const name = chunk.name?.trim() || existing?.name || '';
    const args = `${existing?.args ?? ''}${chunk.args ?? ''}`;
    const id = chunk.id?.trim() || existing?.id || key;
    if (!name && !args) continue;
    merged.set(key, { id, name, args });
  }

  return [...merged.values()];
};

export const applyToolCallProgress = (
  assistantMsg: CottageMessage,
  pending: readonly PendingToolCallProgress[],
  options?: { argsStreaming?: boolean },
): boolean => {
  const argsStreaming = options?.argsStreaming ?? true;
  let changed = false;

  for (const tc of pending) {
    if (!tc.name && !tc.args) continue;

    const existing = assistantMsg.sections.find(
      (s): s is Extract<typeof s, { type: 'call' }> =>
        s.type === 'call' &&
        (s.id === tc.id ||
          (tc.name !== '' &&
            s.name === tc.name &&
            Boolean(s.running) &&
            s.result === undefined)),
    );

    if (existing) {
      if (existing.id !== tc.id) {
        existing.id = tc.id;
        changed = true;
      }
      if (existing.arguments !== tc.args) {
        existing.arguments = tc.args;
        changed = true;
      }
      if (tc.name && existing.name !== tc.name) {
        existing.name = tc.name;
        changed = true;
      }
      if (!existing.running) {
        existing.running = true;
        changed = true;
      }
      if (argsStreaming && !existing.argsStreaming) {
        existing.argsStreaming = true;
        changed = true;
      }
      continue;
    }

    assistantMsg.sections.push({
      type: 'call',
      id: tc.id,
      name: tc.name || '…',
      arguments: tc.args,
      running: true,
      argsStreaming,
    });
    changed = true;
  }

  return changed;
};
