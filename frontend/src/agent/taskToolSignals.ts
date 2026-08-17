import type { TaskHandoff } from '../task/types';

export interface TaskToolSignals {
  onComplete?: () => void;
  onFail?: (reason: string) => void;
  onHandoff?: (handoff: TaskHandoff) => void;
  onSubtaskComplete?: (summary: string) => void;
}

export type { TaskHandoff };

export type DispatchSubtaskFn = (
  goal: string,
  options?: { background?: boolean; subtaskId?: string },
) => Promise<{
  ok: boolean;
  subtaskId: string;
  status: string;
  summary?: string;
  error?: string;
}>;
