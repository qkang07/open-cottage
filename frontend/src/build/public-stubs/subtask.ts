export interface DispatchSubtaskResult {
  subtaskId: string;
  status: 'completed' | 'failed' | 'cancelled';
  summary?: string;
  error?: string;
}

export interface SubtaskRunnerDeps {
  parentTaskId: string;
}

const disabledError = () => new Error('当前构建未包含任务模式');

export const dispatchSubtaskForeground = async (): Promise<DispatchSubtaskResult> => {
  throw disabledError();
};

export const dispatchSubtaskBackground = async (): Promise<DispatchSubtaskResult> => {
  throw disabledError();
};

export const resumeSubtask = async (): Promise<DispatchSubtaskResult> => {
  throw disabledError();
};

export const buildSubtaskInjectionMessage = (): string => '';

export const resetBackgroundSubtaskRuns = (): void => {};

