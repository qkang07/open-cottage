<script setup lang="ts">
import {
  Add,
  CheckmarkCircle,
  DownloadOutline,
  PauseCircle,
  PlayCircle,
  StopCircle,
  } from '@vicons/ionicons5';
import {
  ElButton,
  ElInput,
  ElTag,
  ElMessage
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NSpace,
  NText
} from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed, onUnmounted, ref, watch } from 'vue';
import { useTaskStore } from '../../stores/task';
import { useWorkspaceStore } from '../../stores/workspace';
import {
  formatTaskTime,
  loadTaskManifest,
  loadTaskCanvas,
  loadTaskSpec,
  loadTaskVerifyReport,
} from '../../task/persistence';
import type { TaskMeta } from '../../task/types';
import type {
  AcceptanceCheck,
  SubtaskStatus,
  TaskDeliverableCanvas,
  TaskEvent,
  TaskManifest,
  TaskPlan,
  TaskSpec,
  TaskState,
  VerifyReport,
} from '../../task/types';
import { workspace } from '../../workspace/FileSystemWorkspace';
import TaskEventTimeline from './TaskEventTimeline.vue';
import TaskLiveLog from './TaskLiveLog.vue';
import TaskPlanBoard from './TaskPlanBoard.vue';
import VerifyResultCard from './VerifyResultCard.vue';
import DeliverableCanvasCard from '../Chat/DeliverableCanvasCard.vue';
const message = ElMessage;
const workspaceStore = useWorkspaceStore();
const taskStore = useTaskStore();
const { snapshot } = storeToRefs(workspaceStore);
const {
  tasks,
  activeTaskId,
  runningTaskId,
  taskDetailVersion,
} = storeToRefs(taskStore);
const goal = ref('');
const acceptanceFiles = ref('');
const acceptanceChecksText = ref('');
const detailState = ref<TaskState | null>(null);
const detailPlan = ref<TaskPlan | null>(null);
const detailEvents = ref<TaskEvent[]>([]);
const detailSpec = ref<TaskSpec | null>(null);
const detailManifest = ref<TaskManifest | null>(null);
const detailCanvas = ref<TaskDeliverableCanvas | null>(null);
const detailVerify = ref<VerifyReport | null>(null);
const instruction = ref('');
const creating = ref(false);
const savingInstruction = ref(false);
const statusTag: Record<
  TaskState['status'],
  { type: 'primary' | 'info' | 'warning' | 'success' | 'danger'; label: string }
> = {
  draft: { type: 'primary', label: '草稿' },
  running: { type: 'info', label: '运行中' },
  paused: { type: 'warning', label: '已暂停' },
  completed: { type: 'success', label: '已完成' },
  failed: { type: 'danger', label: '失败' },
  cancelled: { type: 'primary', label: '已取消' },
};
const activeMeta = computed(() =>
  tasks.value.find((t: TaskMeta) => t.id === activeTaskId.value),
);
const isRunning = computed(() => runningTaskId.value === activeTaskId.value);
const status = computed(() =>
  isRunning.value ? 'running' : detailState.value?.status,
);
const verifyFixing = computed(
  () =>
    isRunning.value &&
    detailVerify.value?.verdict === 'fail',
);
const subtaskTag: Record<
  SubtaskStatus,
  { type: 'primary' | 'info' | 'warning' | 'success' | 'danger'; label: string }
> = {
  running: { type: 'info', label: '运行中' },
  completed: { type: 'success', label: '已完成' },
  failed: { type: 'danger', label: '失败' },
  cancelled: { type: 'warning', label: '已取消' },
};
const subtasks = computed(
  () =>
    [...(detailState.value?.subtasks ?? [])].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    ),
);
async function loadDetail() {
  if (!activeTaskId.value) {
    detailState.value = null;
    detailPlan.value = null;
    detailSpec.value = null;
    detailManifest.value = null;
    detailCanvas.value = null;
    detailVerify.value = null;
    return;
  }
  const [state, plan, events, spec, manifest, canvas, verify] = await Promise.all([
    taskStore.getTaskState(activeTaskId.value),
    taskStore.getTaskPlan(activeTaskId.value),
    taskStore.getTaskEvents(activeTaskId.value),
    loadTaskSpec(activeTaskId.value),
    loadTaskManifest(activeTaskId.value),
    loadTaskCanvas(activeTaskId.value),
    loadTaskVerifyReport(activeTaskId.value),
  ]);
  detailState.value = state;
  detailPlan.value = plan;
  detailEvents.value = events;
  detailSpec.value = spec;
  detailManifest.value = manifest;
  detailCanvas.value = canvas;
  detailVerify.value = verify;
}
watch(
  [activeTaskId, tasks, runningTaskId, taskDetailVersion],
  () => { void loadDetail(); },
  { immediate: true },
);
let pollTimer: number | undefined;
watch(runningTaskId, (id) => {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
  if (!id) return;
  pollTimer = window.setInterval(() => { void loadDetail(); }, 800);
});
onUnmounted(() => {
  if (pollTimer) window.clearInterval(pollTimer);
});

/**
 * 解析验收检查编辑器文本为结构化 AcceptanceCheck[]。
 * 行格式：`type|path|...`，type ∈ {exists, notexists, contains, notcontains, regex, json}
 *  - exists|path
 *  - contains|path|text
 *  - regex|path|pattern[|flags]
 *  - json|path|field|value   (value 尝试按 JSON 解析，失败则当作字符串)
 */
function parseAcceptanceChecks(text: string): AcceptanceCheck[] {
  const checks: AcceptanceCheck[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map((s) => s.trim());
    const [type, path, ...rest] = parts;
    if (!type || !path) continue;
    switch (type) {
      case 'exists':
        checks.push({ type: 'fileExists', path, description: `存在：${path}` });
        break;
      case 'notexists':
        checks.push({
          type: 'fileExists',
          path,
          not: true,
          description: `不存在：${path}`,
        });
        break;
      case 'contains':
        checks.push({
          type: 'contentContains',
          path,
          expected: rest[0] ?? '',
          description: `${path} 包含 "${rest[0] ?? ''}"`,
        });
        break;
      case 'notcontains':
        checks.push({
          type: 'contentContains',
          path,
          expected: rest[0] ?? '',
          not: true,
          description: `${path} 不包含 "${rest[0] ?? ''}"`,
        });
        break;
      case 'regex':
        checks.push({
          type: 'contentMatches',
          path,
          expected: rest[0] ?? '',
          flags: rest[1] ?? '',
          description: `${path} 匹配 /${rest[0] ?? ''}/${rest[1] ?? ''}`,
        });
        break;
      case 'json': {
        const field = rest[0] ?? '';
        const rawValue = rest[1] ?? '';
        let equals: unknown = rawValue;
        try {
          equals = JSON.parse(rawValue);
        } catch {
          equals = rawValue;
        }
        checks.push({
          type: 'jsonField',
          path,
          field,
          equals,
          description: `${path} 字段 ${field} === ${rawValue}`,
        });
        break;
      }
    }
  }
  return checks;
}

async function handleCreate() {
  if (!snapshot.value) {
    message.warning('请先打开工作空间');
    return;
  }
  creating.value = true;
  try {
    const files = acceptanceFiles.value
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const checks = parseAcceptanceChecks(acceptanceChecksText.value);
    await taskStore.createTask({
      goal: goal.value,
      acceptanceFiles: files.length ? files : undefined,
      acceptanceChecks: checks.length ? checks : undefined,
    });
    goal.value = '';
    acceptanceFiles.value = '';
    acceptanceChecksText.value = '';
    message.success('任务已创建');
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    creating.value = false;
  }
}
async function handleOpenDeliverable() {
  if (!detailState.value?.deliverablePath) return;
  await workspaceStore.selectFile(detailState.value.deliverablePath);
}
async function handleDownloadDeliverable() {
  if (!activeTaskId.value || !detailState.value?.deliverablePath) return;
  try {
    const bytes = await workspace.readFileBytes(detailState.value.deliverablePath);
    const arrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeTaskId.value}-deliverable.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    message.success('交付包下载已触发');
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}
async function handleExtractPreview() {
  if (!activeTaskId.value || !detailState.value?.deliverablePath) return;
  try {
    const previewDir = `.cottage/tasks/${activeTaskId.value}/preview`;
    await workspace.extract(detailState.value.deliverablePath, previewDir);
    message.success(`已解压到 ${previewDir}`);
    await workspaceStore.refresh();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}
async function handleAddInstruction() {
  if (!activeTaskId.value || !instruction.value.trim()) return;
  savingInstruction.value = true;
  try {
    await taskStore.addInstruction(activeTaskId.value, instruction.value);
    instruction.value = '';
    await loadDetail();
    message.success(
      isRunning.value ? '补充指令已记录，将在下一轮生效' : '补充指令已记录',
    );
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    savingInstruction.value = false;
  }
}
</script>
<template>
  <NText v-if="!snapshot" depth="3">
    请先打开工作区以使用任务模式
  </NText>
  <div v-else class="task-panel">
    <div class="task-create">
      <NText strong>新建任务</NText>
      <ElInput
        v-model="goal"
        type="textarea"
        placeholder="描述要完成的目标，例如：在工作区生成一份项目 README 和示例配置"
        :autosize="{ minRows: 2, maxRows: 4 }"
        :disabled="Boolean(runningTaskId)"
      />
      <ElInput
        v-model="acceptanceFiles"
        placeholder="验收文件路径（可选，逗号或换行分隔）"
        :disabled="Boolean(runningTaskId)"
      />
      <ElInput
        v-model="acceptanceChecksText"
        type="textarea"
        :autosize="{ minRows: 2, maxRows: 6 }"
        placeholder="结构化验收（可选，每行一条）：
exists|path/to/file
contains|README.md|# Project
regex|config.ts|VERSION\\s*=\\s*\"\d+\.\d+\.\d+\"
json|package.json|scripts.dev|vite
notexists|temp/bad.tmp"
        :disabled="Boolean(runningTaskId)"
      />
      <ElButton
        type="primary"
        :loading="creating"
        :disabled="!goal.trim() || Boolean(runningTaskId)"
        @click="handleCreate"
      >
        <template #icon>
          <NIcon :component="Add" />
        </template>
        创建任务
      </ElButton>
    </div>
    <div class="task-list-section">
      <NText strong>任务列表</NText>
      <NText v-if="tasks.length === 0" depth="3">暂无任务</NText>
      <div v-else class="task-list">
        <div
          v-for="item in tasks"
          :key="item.id"
          :class="[
            'task-list-item',
            { 'task-list-item-active': item.id === activeTaskId },
          ]"
          @click="taskStore.selectTask(item.id)"
        >
          <div>
            <NText strong>{{ item.title }}</NText>
            <NText depth="3" style="display: block; font-size: 12px">
              {{ formatTaskTime(item.updatedAt) }}
            </NText>
          </div>
          <ElTag v-if="runningTaskId === item.id" type="info">
            运行中
          </ElTag>
        </div>
      </div>
    </div>
    <div v-if="activeMeta && detailState" class="task-detail">
      <div class="task-detail-header">
        <NText strong>{{ activeMeta.title }}</NText>
        <ElTag
          v-if="status"
          :type="statusTag[status].type"
        >
          {{ statusTag[status].label }}
        </ElTag>
      </div>
      <NText depth="3" class="task-detail-meta">
        轮次 {{ detailState.turnCount }}
        <template v-if="detailState.lastError"> · {{ detailState.lastError }}</template>
      </NText>
      <TaskPlanBoard
        :state="detailState"
        :plan="detailPlan"
        :spec="detailSpec"
        :is-running="isRunning"
      />
      <div v-if="subtasks.length" class="task-subtasks-section">
        <NText strong>子任务</NText>
        <div
          v-for="item in subtasks"
          :key="item.id"
          class="task-subtask-item"
        >
          <div class="task-subtask-header">
            <ElTag :type="subtaskTag[item.status].type" size="small">
              {{ subtaskTag[item.status].label }}
            </ElTag>
            <ElTag v-if="item.background" size="small" type="info">后台</ElTag>
            <NText depth="3" style="font-size: 11px">
              {{ formatTaskTime(item.updatedAt) }}
            </NText>
          </div>
          <NText class="task-subtask-goal">{{ item.goal }}</NText>
          <NText
            v-if="item.summary"
            depth="3"
            class="task-subtask-summary"
          >
            {{ item.summary }}
          </NText>
          <NText
            v-if="item.error"
            type="danger"
            class="task-subtask-error"
          >
            {{ item.error }}
          </NText>
        </div>
      </div>
      <VerifyResultCard
        v-if="detailVerify"
        :report="detailVerify"
        :fixing="verifyFixing"
      />
      <DeliverableCanvasCard
        v-if="detailCanvas"
        :canvas="detailCanvas.canvas"
        :summary="detailCanvas.summary"
        :completed="status === 'completed'"
      />
      <div class="task-instruction-box">
        <NText strong>人工纠偏</NText>
        <ElInput
          v-model="instruction"
          type="textarea"
          placeholder="补充约束或纠正方向；运行中会在下一轮任务提示中生效"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :disabled="status === 'completed' || status === 'cancelled'"
        />
        <ElButton
          type="primary"
          :loading="savingInstruction"
          :disabled="
            !instruction.trim() ||
            status === 'completed' ||
            status === 'cancelled'
          "
          @click="handleAddInstruction"
        >
          记录指令
        </ElButton>
        <div v-if="detailState.operatorInstructions?.length" class="task-instruction-list">
          <NText
            v-for="item in detailState.operatorInstructions.slice(-3)"
            :key="item.id"
            depth="3"
            class="task-instruction-item"
          >
            {{ item.content }}
          </NText>
        </div>
      </div>
      <NSpace wrap>
        <ElButton
          v-if="status === 'draft' || status === 'paused'"
          type="primary"
          :disabled="Boolean(runningTaskId) && !isRunning"
          @click="
            (status === 'paused'
              ? taskStore.resumeTask(activeTaskId!)
              : taskStore.startTask(activeTaskId!)
            ).catch((e: unknown) =>
              message.error(e instanceof Error ? e.message : String(e)),
            )
          "
        >
          <template #icon>
            <NIcon :component="PlayCircle" />
          </template>
          {{ status === 'paused' ? '继续' : '开始' }}
        </ElButton>
        <template v-if="isRunning">
          <CottageTooltip content="暂停执行，可稍后继续" placement="top" delay="instant">
            <ElButton @click="taskStore.pauseTask(); message.info('正在暂停…')">
              <template #icon>
                <NIcon :component="PauseCircle" />
              </template>
              暂停
            </ElButton>
          </CottageTooltip>
          <CottageTooltip content="取消执行，已生成文件保留" placement="top" delay="instant">
            <ElButton
              type="danger"
              @click="taskStore.cancelTask(); message.info('正在取消…')"
            >
              <template #icon>
                <NIcon :component="StopCircle" />
              </template>
              取消
            </ElButton>
          </CottageTooltip>
        </template>
        <CottageTooltip
          v-if="status === 'failed'"
          content="重置为草稿并重新开始"
          placement="top"
          delay="instant"
        >
          <ElButton
            type="primary"
            @click="
              taskStore.retryTask(activeTaskId!).catch((e) =>
                message.error(e instanceof Error ? e.message : String(e)),
              )
            "
          >
            <template #icon>
              <NIcon :component="PlayCircle" />
            </template>
            重试
          </ElButton>
        </CottageTooltip>
        <template v-if="status === 'completed' && detailState.deliverablePath">
          <ElButton @click="handleOpenDeliverable">
            <template #icon>
              <NIcon :component="DownloadOutline" />
            </template>
            查看交付包
          </ElButton>
          <ElButton @click="handleDownloadDeliverable">下载交付包</ElButton>
          <ElButton @click="handleExtractPreview">解压预览</ElButton>
        </template>
        <ElTag v-if="status === 'completed'" type="success">
          <template #icon>
            <NIcon :component="CheckmarkCircle" />
          </template>
          已交付
        </ElTag>
        <div
          v-if="status === 'completed' && detailManifest?.paths.length"
          style="margin-top: 12px; width: 100%"
        >
          <NText depth="3" style="font-size: 12px">交付清单：</NText>
          <div
            v-for="item in detailManifest.paths"
            :key="item.path"
            style="padding: 4px 0; display: flex; align-items: center; gap: 8px"
          >
            <ElButton
              text
              style="padding: 0"
              @click="workspaceStore.selectFile(item.path)"
            >
              {{ item.path }}
            </ElButton>
            <NText v-if="item.description" depth="3" style="font-size: 12px">
              {{ item.description }}
            </NText>
          </div>
        </div>
      </NSpace>
      <div v-if="isRunning" class="task-live-section">
        <div class="task-live-header">
          <NText strong>执行过程</NText>
          <ElButton text @click="taskStore.focusChatPanel()">
            在对话页查看
          </ElButton>
        </div>
        <TaskLiveLog />
      </div>
      <div v-if="detailEvents.length" class="task-timeline-section">
        <NText strong>时间线</NText>
        <TaskEventTimeline :events="detailEvents" :max-items="20" />
      </div>
      <NText depth="3" class="task-hint">
        任务在浏览器标签页内自动多轮执行；关闭页面后可在「继续」恢复。
      </NText>
    </div>
  </div>
</template>
