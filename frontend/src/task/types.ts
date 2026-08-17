import type { AcceptanceCheck, VerifyReport } from '../platform/verify';

export type TaskStatus =
  | 'draft'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskStepStatus = 'pending' | 'doing' | 'done';

export interface TaskAcceptance {
  files?: string[];
  script?: string;
  /** 结构化验收检查项；非空时优先于 files/script */
  checks?: AcceptanceCheck[];
}

export type { AcceptanceCheck, VerifyReport } from '../platform/verify';

export interface TaskSpec {
  goal: string;
  constraints?: string;
  acceptance: TaskAcceptance;
  maxTurns?: number;
}

export interface TaskHandoff {
  summary: string;
  remaining: string[];
  nextSteps: string[];
  at: number;
}

export type SubtaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface SubtaskRef {
  id: string;
  goal: string;
  chatSessionId: string;
  status: SubtaskStatus;
  summary?: string;
  error?: string;
  background: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TaskState {
  status: TaskStatus;
  chatSessionId: string;
  turnCount: number;
  operatorInstructions?: TaskOperatorInstruction[];
  lastError?: string;
  deliverablePath?: string;
  /** 最近一次验收报告；任务完成或验收失败后写入 */
  verifyReport?: VerifyReport;
  /** 触顶 maxTurns 时的结构化交接 */
  handoff?: TaskHandoff;
  /** 派生子任务记录 */
  subtasks?: SubtaskRef[];
  createdAt: number;
  updatedAt: number;
}

export interface TaskOperatorInstruction {
  id: string;
  content: string;
  createdAt: number;
}

export interface TaskPlanStep {
  id: string;
  title: string;
  status: TaskStepStatus;
}

export interface TaskPlan {
  steps: TaskPlanStep[];
  updatedAt: number;
}

export interface TaskManifestEntry {
  path: string;
  description?: string;
}

export interface TaskManifest {
  paths: TaskManifestEntry[];
  summary?: string;
  updatedAt: number;
}

/** 结构化 canvas 交付物（表格 / 待办 / Markdown） */
export type TaskCanvasKind = 'table' | 'todo-list' | 'markdown';

export interface TaskCanvasTable {
  kind: 'table';
  title?: string;
  columns: string[];
  rows: string[][];
}

export interface TaskCanvasTodoItem {
  id?: string;
  text: string;
  done?: boolean;
}

export interface TaskCanvasTodoList {
  kind: 'todo-list';
  title?: string;
  items: TaskCanvasTodoItem[];
}

export interface TaskCanvasMarkdown {
  kind: 'markdown';
  title?: string;
  content: string;
}

export type TaskCanvasPayload =
  | TaskCanvasTable
  | TaskCanvasTodoList
  | TaskCanvasMarkdown;

export interface TaskDeliverableCanvas {
  summary?: string;
  canvas: TaskCanvasPayload;
  updatedAt: number;
}

export type TaskDeliverableKind = 'manifest' | 'canvas';

export interface TaskMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface TasksIndex {
  activeId: string | null;
  tasks: TaskMeta[];
}

export type TaskEventType =
  | 'created'
  | 'started'
  | 'turn'
  | 'plan'
  | 'instruction'
  | 'complete_signal'
  | 'deliverable_canvas'
  | 'verified'
  | 'handoff'
  | 'subtask'
  | 'paused'
  | 'resumed'
  | 'failed'
  | 'completed'
  | 'cancelled';

export interface TaskEvent {
  type: TaskEventType;
  at: number;
  detail?: Record<string, unknown>;
}

export const DEFAULT_MAX_TURNS = 30;
