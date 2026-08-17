import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';

const disabledError = () => new Error('当前构建未包含任务模式');

export const useTaskStore = defineStore('task', () => {
  const tasks = ref<never[]>([]);
  const activeTaskId = ref<string | null>(null);
  const runningTaskId = ref<string | null>(null);
  const taskDetailVersion = ref(0);
  const focusChatRef = shallowRef<() => void>(() => {});

  const rejectDisabled = async (): Promise<never> => {
    throw disabledError();
  };

  return {
    tasks,
    activeTaskId: computed(() => activeTaskId.value),
    runningTaskId,
    taskDetailVersion,
    refreshTasks: async () => ({ activeId: null, tasks: [] }),
    selectTask: async () => {},
    createTask: rejectDisabled,
    startTask: rejectDisabled,
    pauseTask: () => {},
    resumeTask: rejectDisabled,
    retryTask: rejectDisabled,
    cancelTask: () => {},
    focusChatPanel: () => focusChatRef.value(),
    addInstruction: rejectDisabled,
    registerFocusChatPanel: (fn: () => void) => {
      focusChatRef.value = fn;
    },
    getTaskState: async () => null,
    getTaskPlan: async () => null,
    getTaskEvents: async () => [],
    notifySubtaskUpdate: () => {},
    wakeControl: () => {},
  };
});

