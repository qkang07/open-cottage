import { workspace } from '../workspace/FileSystemWorkspace';
import {
  COTTAGE_TASKS_INDEX_FILE,
  taskCanvasFile,
  taskEventsFile,
  taskManifestFile,
  taskPlanFile,
  taskSpecFile,
  taskStateFile,
  taskVerifyFile,
} from '../config/constants';
import type {
  TaskDeliverableCanvas,
  TaskEvent,
  TaskManifest,
  TaskMeta,
  TaskOperatorInstruction,
  TaskPlan,
  TaskSpec,
  TaskState,
  TasksIndex,
  VerifyReport,
} from './types';

const emptyIndex = (): TasksIndex => ({
  activeId: null,
  tasks: [],
});

const normalizeIndex = (raw: TasksIndex): TasksIndex => ({
  activeId: typeof raw.activeId === 'string' ? raw.activeId : null,
  tasks: Array.isArray(raw.tasks)
    ? raw.tasks.filter(
        (item): item is TaskMeta =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          typeof item.createdAt === 'number' &&
          typeof item.updatedAt === 'number',
      )
    : [],
});

const saveTasksIndex = async (index: TasksIndex) => {
  if (!workspace.isOpen) return;
  await workspace.writeCottagePath(COTTAGE_TASKS_INDEX_FILE, index);
};

export const loadTasksIndex = async (): Promise<TasksIndex> => {
  if (!workspace.isOpen) return emptyIndex();
  const stored = await workspace.readCottagePath<TasksIndex>(COTTAGE_TASKS_INDEX_FILE);
  return stored ? normalizeIndex(stored) : emptyIndex();
};

export const loadTaskSpec = async (taskId: string): Promise<TaskSpec | null> => {
  if (!workspace.isOpen) return null;
  return workspace.readCottagePath<TaskSpec>(taskSpecFile(taskId));
};

export const saveTaskSpec = async (taskId: string, spec: TaskSpec) => {
  await workspace.writeCottagePath(taskSpecFile(taskId), spec);
};

export const loadTaskState = async (taskId: string): Promise<TaskState | null> => {
  if (!workspace.isOpen) return null;
  return workspace.readCottagePath<TaskState>(taskStateFile(taskId));
};

export const saveTaskState = async (taskId: string, state: TaskState) => {
  await workspace.writeCottagePath(taskStateFile(taskId), state);
};

export const loadTaskPlan = async (taskId: string): Promise<TaskPlan | null> => {
  if (!workspace.isOpen) return null;
  const plan = await workspace.readCottagePath<TaskPlan>(taskPlanFile(taskId));
  if (!plan || !Array.isArray(plan.steps)) return null;
  return plan;
};

export const saveTaskPlan = async (taskId: string, plan: TaskPlan) => {
  await workspace.writeCottagePath(taskPlanFile(taskId), plan);
};

export const loadTaskManifest = async (taskId: string): Promise<TaskManifest | null> => {
  if (!workspace.isOpen) return null;
  const manifest = await workspace.readCottagePath<TaskManifest>(taskManifestFile(taskId));
  if (!manifest || !Array.isArray(manifest.paths)) return null;
  return manifest;
};

export const saveTaskManifest = async (taskId: string, manifest: TaskManifest) => {
  await workspace.writeCottagePath(taskManifestFile(taskId), manifest);
};

export const loadTaskCanvas = async (
  taskId: string,
): Promise<TaskDeliverableCanvas | null> => {
  if (!workspace.isOpen) return null;
  const canvas = await workspace.readCottagePath<TaskDeliverableCanvas>(
    taskCanvasFile(taskId),
  );
  if (!canvas?.canvas || typeof canvas.canvas.kind !== 'string') return null;
  return canvas;
};

export const saveTaskCanvas = async (
  taskId: string,
  deliverable: TaskDeliverableCanvas,
) => {
  await workspace.writeCottagePath(taskCanvasFile(taskId), deliverable);
};

export const loadTaskVerifyReport = async (
  taskId: string,
): Promise<VerifyReport | null> => {
  if (!workspace.isOpen) return null;
  const report = await workspace.readCottagePath<VerifyReport>(taskVerifyFile(taskId));
  if (!report || !Array.isArray(report.checks) || typeof report.verdict !== 'string') {
    return null;
  }
  return report;
};

export const saveTaskVerifyReport = async (
  taskId: string,
  report: VerifyReport,
) => {
  await workspace.writeCottagePath(taskVerifyFile(taskId), report);
};

export const appendTaskEvent = async (taskId: string, event: TaskEvent) => {
  if (!workspace.isOpen) return;
  const line = `${JSON.stringify(event)}\n`;
  const existing = await workspace.readCottageText(taskEventsFile(taskId));
  await workspace.writeCottageText(taskEventsFile(taskId), `${existing ?? ''}${line}`);
};

export const loadTaskEvents = async (taskId: string): Promise<TaskEvent[]> => {
  if (!workspace.isOpen) return [];
  const text = await workspace.readCottageText(taskEventsFile(taskId));
  if (!text?.trim()) return [];

  const events: TaskEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as TaskEvent;
      if (typeof event.type === 'string' && typeof event.at === 'number') {
        events.push(event);
      }
    } catch {
      // Ignore a partially written/corrupt JSONL row and keep the rest visible.
    }
  }
  return events.sort((a, b) => a.at - b.at);
};

export const appendTaskInstruction = async (
  taskId: string,
  content: string,
): Promise<TaskOperatorInstruction> => {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('补充指令不能为空');

  const state = await loadTaskState(taskId);
  if (!state) throw new Error('任务不存在');

  const instruction: TaskOperatorInstruction = {
    id: crypto.randomUUID(),
    content: trimmed,
    createdAt: Date.now(),
  };
  await saveTaskState(taskId, {
    ...state,
    operatorInstructions: [
      ...(state.operatorInstructions ?? []),
      instruction,
    ].slice(-20),
    updatedAt: instruction.createdAt,
  });
  await appendTaskEvent(taskId, {
    type: 'instruction',
    at: instruction.createdAt,
    detail: { content: trimmed },
  });
  await touchTaskMeta(taskId, {});
  return instruction;
};

export const touchTaskMeta = async (
  taskId: string,
  patch: Partial<Pick<TaskMeta, 'title'>>,
): Promise<TaskMeta | null> => {
  const index = await loadTasksIndex();
  const task = index.tasks.find((t) => t.id === taskId);
  if (!task) return null;

  const updated: TaskMeta = {
    ...task,
    ...patch,
    updatedAt: Date.now(),
  };
  const tasks = index.tasks.map((t) => (t.id === taskId ? updated : t));
  tasks.sort((a, b) => b.updatedAt - a.updatedAt);
  await saveTasksIndex({ ...index, tasks });
  return updated;
};

export const setActiveTask = async (taskId: string | null) => {
  const index = await loadTasksIndex();
  await saveTasksIndex({ ...index, activeId: taskId });
};

export const addTaskMeta = async (meta: TaskMeta) => {
  const index = await loadTasksIndex();
  const tasks = [meta, ...index.tasks.filter((t) => t.id !== meta.id)];
  await saveTasksIndex({ activeId: meta.id, tasks });
  return meta;
};

export const formatTaskTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const taskTitleFromGoal = (goal: string) => {
  const trimmed = goal.trim().replace(/\s+/g, ' ').slice(0, 48);
  return trimmed || '新任务';
};

/** 刷新页面后将 running 任务标记为 paused，避免误以为仍在跑 */
export const recoverInterruptedTasks = async () => {
  const index = await loadTasksIndex();
  for (const meta of index.tasks) {
    const state = await loadTaskState(meta.id);
    if (state?.status === 'running') {
      await saveTaskState(meta.id, {
        ...state,
        status: 'paused',
        updatedAt: Date.now(),
      });
    }
  }
};
