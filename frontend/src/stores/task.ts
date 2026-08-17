import { computed, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import type { CottageAgent } from '../agent/CottageAgent';
import { createChatSession } from '../config/chatSessions';
import { TaskRunner, type TaskRunnerDeps } from '../task/TaskRunner';
import {
  addTaskMeta,
  appendTaskInstruction,
  appendTaskEvent,
  loadTaskPlan,
  loadTaskEvents,
  loadTaskState,
  loadTasksIndex,
  recoverInterruptedTasks,
  saveTaskSpec,
  saveTaskState,
  setActiveTask,
  taskTitleFromGoal,
} from '../task/persistence';
import { createTaskRunControl } from '../task/taskControl';
import type { TaskMeta, TaskSpec, TaskState, AcceptanceCheck } from '../task/types';
import { useAgentStore } from './agent';
import { useWorkspaceStore } from './workspace';

/** 创建任务的输入参数 */
interface CreateTaskInput {
  goal: string;
  constraints?: string;
  acceptanceFiles?: string[];
  acceptanceScript?: string;
  acceptanceChecks?: AcceptanceCheck[];
  maxTurns?: number;
}

/**
 * 任务状态管理。
 * 控制任务的创建、启动、暂停、恢复、取消，以及任务运行器的生命周期。
 */
export const useTaskStore = defineStore('task', () => {
  const workspaceStore = useWorkspaceStore();
  const agentStore = useAgentStore();

  const tasks = ref<TaskMeta[]>([]);
  const activeTaskId = ref<string | null>(null);
  const runningTaskId = ref<string | null>(null);
  const taskDetailVersion = ref(0);

  const runnerRef = shallowRef<TaskRunner | null>(null);
  const controlRef = shallowRef(createTaskRunControl());
  const focusChatRef = shallowRef<() => void>(() => {});

  const chatRef = shallowRef<CottageAgent | null>(null);

  watch(
    () => agentStore.chat,
    (c) => { chatRef.value = c; },
    { immediate: true },
  );

  /** 增加任务详情版本号（触发 UI 刷新） */
  function bumpDetail() {
    taskDetailVersion.value += 1;
  }

  /** 通知父任务的子任务状态更新 */
  function notifySubtaskUpdate(parentTaskId: string) {
    bumpDetail();
    if (runningTaskId.value === parentTaskId) {
      controlRef.value.wake('subtask-done');
    }
  }

  /** 唤醒任务运行器控制（用于外部事件触发） */
  function wakeControl(reason: import('../task/taskControl').WakeReason) {
    controlRef.value.wake(reason);
    bumpDetail();
  }

  /** 从磁盘刷新任务列表 */
  async function refreshTasks() {
    const index = await loadTasksIndex();
    tasks.value = [...index.tasks].sort((a, b) => b.updatedAt - a.updatedAt);
    bumpDetail();
    return index;
  }

  /** 确保任务运行器已创建（懒初始化） */
  function ensureRunner() {
    if (!runnerRef.value) {
      runnerRef.value = new TaskRunner(() => ({
        getChat: () => chatRef.value,
        getControl: () => controlRef.value,
        mountTaskSession: agentStore.mountTaskSession,
        persistChat: agentStore.persistCurrentChat,
        getSignals: agentStore.getTaskSignals,
        onUpdate: () => { void refreshTasks(); },
      } satisfies TaskRunnerDeps));
    }
    return runnerRef.value;
  }

  /** 选中指定任务（切换当前任务并刷新列表） */
  async function selectTask(taskId: string | null) {
    activeTaskId.value = taskId;
    await setActiveTask(taskId);
    if (taskId && !runningTaskId.value) {
      const state = await loadTaskState(taskId);
      if (state?.chatSessionId && state.chatSessionId !== agentStore.activeChatId) {
        await agentStore.switchChat(state.chatSessionId);
      }
    }
    await refreshTasks();
  }

  watch(
    () => workspaceStore.activeWorkspaceId,
    async (workspaceId, previousId) => {
      if (previousId && workspaceId !== previousId && runningTaskId.value) {
        runnerRef.value?.cancel();
        runningTaskId.value = null;
        controlRef.value.reset();
      }
      if (!workspaceId) {
        tasks.value = [];
        activeTaskId.value = null;
        return;
      }
      await recoverInterruptedTasks();
      const index = await refreshTasks();
      activeTaskId.value = index.activeId;
    },
    { immediate: true },
  );

  watch(runningTaskId, (id) => {
    if (!id) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  });

  /** 创建新任务 */
  async function createTask(input: CreateTaskInput) {
    const goal = input.goal.trim();
    if (!goal) throw new Error('任务目标不能为空');

    const session = await createChatSession(taskTitleFromGoal(goal));
    const taskId = crypto.randomUUID();
    const now = Date.now();

    const spec: TaskSpec = {
      goal,
      constraints: input.constraints?.trim() || undefined,
      acceptance: {
        files: input.acceptanceFiles?.filter(Boolean),
        script: input.acceptanceScript?.trim() || undefined,
        checks: input.acceptanceChecks?.filter((c) => c && c.type),
      },
      maxTurns: input.maxTurns,
    };

    const state: TaskState = {
      status: 'draft',
      chatSessionId: session.id,
      turnCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    await saveTaskSpec(taskId, spec);
    await saveTaskState(taskId, state);
    await addTaskMeta({
      id: taskId,
      title: taskTitleFromGoal(goal),
      createdAt: now,
      updatedAt: now,
    });
    await appendTaskEvent(taskId, { type: 'created', at: now });
    await selectTask(taskId);
    return taskId;
  }

  /** 启动指定任务 */
  async function startTask(taskId: string) {
    if (runningTaskId.value && runningTaskId.value !== taskId) {
      throw new Error('已有任务在运行，请先暂停或取消');
    }

    const state = await loadTaskState(taskId);
    if (!state) throw new Error('任务不存在');
    if (state.status === 'running') return;

    if (state.status === 'completed' || state.status === 'cancelled') {
      throw new Error('该任务已结束，请创建新任务');
    }

    activeTaskId.value = taskId;
    await setActiveTask(taskId);
    controlRef.value.reset();
    runningTaskId.value = taskId;
    focusChatRef.value();

    const runner = ensureRunner();
    try {
      await runner.run(taskId);
    } finally {
      runningTaskId.value = null;
      controlRef.value.reset();
      await refreshTasks();
    }
  }

  /** 暂停当前运行的任务 */
  function pauseTask() {
    if (!runningTaskId.value) return;
    runnerRef.value?.pause();
  }

  /** 恢复已暂停的任务 */
  async function resumeTask(taskId: string) {
    const state = await loadTaskState(taskId);
    if (!state) throw new Error('任务不存在');
    if (state.status !== 'paused') {
      throw new Error('只能继续已暂停的任务');
    }
    await startTask(taskId);
  }

  /** 重试失败的任务（重置状态并重新启动） */
  async function retryTask(taskId: string) {
    const state = await loadTaskState(taskId);
    if (!state) throw new Error('任务不存在');
    if (state.status !== 'failed') {
      throw new Error('只能重试失败的任务');
    }
    await saveTaskState(taskId, {
      ...state,
      status: 'draft',
      lastError: undefined,
      turnCount: 0,
      updatedAt: Date.now(),
    });
    await appendTaskEvent(taskId, {
      type: 'started',
      at: Date.now(),
      detail: { retry: true },
    });
    await refreshTasks();
    await startTask(taskId);
  }

  /** 取消当前运行的任务 */
  function cancelTask() {
    if (!runningTaskId.value) return;
    runnerRef.value?.cancel();
  }

  /** 聚焦到任务聊天面板 */
  function focusChatPanel() {
    focusChatRef.value();
  }

  /** 向运行中的任务添加操作指令 */
  async function addInstruction(taskId: string, content: string) {
    await appendTaskInstruction(taskId, content);
    if (runningTaskId.value === taskId) {
      controlRef.value.wake('operator-instruction');
    }
    await refreshTasks();
  }

  /** 注册任务聊天面板聚焦函数 */
  function registerFocusChatPanel(fn: () => void) {
    focusChatRef.value = fn;
  }

  const resolvedActiveTaskId = computed(
    () => activeTaskId.value ?? agentStore.activeTaskId,
  );

  return {
    tasks,
    activeTaskId: resolvedActiveTaskId,
    runningTaskId,
    taskDetailVersion,
    refreshTasks,
    selectTask,
    createTask,
    startTask,
    pauseTask,
    resumeTask,
    retryTask,
    cancelTask,
    focusChatPanel,
    addInstruction,
    registerFocusChatPanel,
    getTaskState: loadTaskState,
    getTaskPlan: loadTaskPlan,
    getTaskEvents: loadTaskEvents,
    notifySubtaskUpdate,
    wakeControl,
  };
});
