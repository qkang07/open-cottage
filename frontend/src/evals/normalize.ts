const TIME_KEYS = new Set([
  'at',
  'startedAt',
  'createdAt',
  'updatedAt',
  'completedAt',
  'durationMs',
  'firstTokenMs',
]);

const ID_KEYS = new Set([
  'id',
  'callId',
  'toolCallId',
  'requestId',
  'checkpointId',
  'sessionId',
]);

/** 去除时间波动，并把随机 ID 映射成稳定的 id-1 / id-2。 */
export const normalizeEvalArtifact = (value: unknown): unknown => {
  const ids = new Map<string, string>();
  const stableId = (id: string): string => {
    const existing = ids.get(id);
    if (existing) return existing;
    const next = `id-${ids.size + 1}`;
    ids.set(id, next);
    return next;
  };

  const visit = (input: unknown, key?: string): unknown => {
    if (key && TIME_KEYS.has(key) && typeof input === 'number') return '<time>';
    if (key && ID_KEYS.has(key) && typeof input === 'string') return stableId(input);
    if (Array.isArray(input)) return input.map((item) => visit(item));
    if (!input || typeof input !== 'object') return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        visit(child, childKey),
      ]),
    );
  };

  return visit(value);
};
