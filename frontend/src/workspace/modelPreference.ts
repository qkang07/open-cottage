const WORKSPACE_MODEL_PREFERENCE_KEY = 'cottage:workspace-model-preferences';

type WorkspaceModelPreference = {
  agentPresetId?: string;
  imagePresetId?: string;
};

type WorkspaceModelPreferences = Record<string, WorkspaceModelPreference>;

const readPreferences = (): WorkspaceModelPreferences => {
  try {
    const raw = localStorage.getItem(WORKSPACE_MODEL_PREFERENCE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([workspaceId, value]) => {
      // 兼容旧版本只保存 Agent 模型 ID 的格式。
      if (typeof value === 'string' && value.trim()) {
        return [[workspaceId, { agentPresetId: value }]];
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const entry = value as WorkspaceModelPreference;
      const normalized: WorkspaceModelPreference = {
        ...(typeof entry.agentPresetId === 'string' && entry.agentPresetId.trim()
          ? { agentPresetId: entry.agentPresetId }
          : {}),
        ...(typeof entry.imagePresetId === 'string' && entry.imagePresetId.trim()
          ? { imagePresetId: entry.imagePresetId }
          : {}),
      };
      return Object.keys(normalized).length ? [[workspaceId, normalized]] : [];
    }));
  } catch {
    return {};
  }
};

const writePreferences = (preferences: WorkspaceModelPreferences): void => {
  localStorage.setItem(WORKSPACE_MODEL_PREFERENCE_KEY, JSON.stringify(preferences));
};

/** Returns the most recently selected model preset for a workspace. */
export const getWorkspaceLastModelPresetId = (
  workspaceId: string | null | undefined,
): string | undefined => (workspaceId ? readPreferences()[workspaceId]?.agentPresetId : undefined);

/** Keeps the user's model choice local to this browser and workspace. */
export const setWorkspaceLastModelPresetId = (
  workspaceId: string | null | undefined,
  presetId: string,
): void => {
  if (!workspaceId || !presetId.trim()) return;
  const preferences = readPreferences();
  writePreferences({
    ...preferences,
    [workspaceId]: { ...preferences[workspaceId], agentPresetId: presetId },
  });
};

export const getWorkspaceLastImageModelPresetId = (
  workspaceId: string | null | undefined,
): string | undefined => (workspaceId ? readPreferences()[workspaceId]?.imagePresetId : undefined);

export const setWorkspaceLastImageModelPresetId = (
  workspaceId: string | null | undefined,
  presetId: string,
): void => {
  if (!workspaceId || !presetId.trim()) return;
  const preferences = readPreferences();
  writePreferences({
    ...preferences,
    [workspaceId]: { ...preferences[workspaceId], imagePresetId: presetId },
  });
};

export const forgetWorkspaceLastModelPresetId = (workspaceId: string): void => {
  const preferences = readPreferences();
  if (!(workspaceId in preferences)) return;
  delete preferences[workspaceId];
  writePreferences(preferences);
};
