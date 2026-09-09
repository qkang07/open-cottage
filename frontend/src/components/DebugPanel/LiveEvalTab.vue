<script setup lang="ts">
import {
  DownloadOutline,
  FolderOpenOutline,
  PlayOutline,
  RefreshOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import {
  ElAlert,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElProgress,
  ElRadioButton,
  ElRadioGroup,
  ElSelect,
  ElTag,
} from 'element-plus';
import { computed, onMounted, ref, shallowRef, watch } from 'vue';
import { createChatModel } from '../../agent/createModel';
import type { LlmModelConfig, ModelPreset } from '../../config/constants';
import { providerLabel } from '../../config/llmProviders';
import {
  getPresetApiKey,
  getSecretForProvider,
  loadProviderSecrets,
} from '../../config/secrets';
import {
  configRevision,
  getCottageConfig,
  getLlmConfig,
} from '../../config/store';
import { createLiveEvalBudgetedModel } from '../../evals/live/budget';
import {
  LIVE_EVAL_CASES,
  LIVE_EVAL_SMOKE_CASE_IDS,
  type LiveEvalCase,
} from '../../evals/live/cases';
import {
  compareLiveEvalReports,
  liveEvalBaselineGroupsForReport,
  selectLiveEvalReportGroup,
  type LiveEvalBaselineGroup,
} from '../../evals/live/compare';
import {
  createLiveEvalBatchId,
  deleteDirectoryLiveEvalBaseline,
  deleteDirectoryLiveEvalRun,
  initializeLiveEvalRoot,
  loadDirectoryLiveEvalBaselines,
  loadDirectoryLiveEvalHistory,
  prepareDirectoryRun,
  rememberLiveEvalRoot,
  restoreLiveEvalRoot,
  saveDirectoryLiveEvalBaseline,
  type DirectoryLiveEvalBaselines,
  type DirectoryStoredLiveEvalReport,
} from '../../evals/live/directoryWorkspace';
import {
  deleteLiveEvalReport,
  loadLiveEvalHistory,
  saveLiveEvalReport,
  type StoredLiveEvalReport,
} from '../../evals/live/history';
import { runLiveEvalSuite } from '../../evals/live/runner';
import type {
  LiveEvalCaseReport,
  LiveEvalConfig,
  LiveEvalReport,
} from '../../evals/live/types';
import { workspace } from '../../workspace/FileSystemWorkspace';
import { NIcon } from '@/ui/element-plus-primitives';

const props = defineProps<{ visible: boolean }>();

interface ModelOption {
  id: string;
  name: string;
  preset?: ModelPreset;
  config: LlmModelConfig;
}

const selectedModelId = ref('');
const workspaceMode = ref<'memory' | 'directory'>(
  localStorage.getItem('cottage:live-eval-workspace-mode') === 'directory'
    ? 'directory'
    : 'memory',
);
const evalRoot = shallowRef<FileSystemDirectoryHandle | null>(null);
const evalRootName = ref('');
const selectedCaseIds = ref<string[]>([...LIVE_EVAL_SMOKE_CASE_IDS]);
const repeatCount = ref(1);
const maxModelCalls = ref(16);
const maxTotalTokens = ref(15_000);
const maxDurationSeconds = ref(300);
const maxOutputTokens = ref(1_000);
const minimumScore = ref(0.8);
const running = ref(false);
const progressCompleted = ref(0);
const progressTotal = ref(0);
const progressLabel = ref('');
const currentReport = ref<LiveEvalReport | null>(null);
const history = ref<StoredLiveEvalReport[]>([]);
const selectedHistoryId = ref('');
const baselines = ref<DirectoryLiveEvalBaselines>({});

const baselineGroupLabel = (group: LiveEvalBaselineGroup) =>
  group === 'agent' ? '普通 Agent' : 'Plan';

const modelOptions = computed<ModelOption[]>(() => {
  void configRevision.value;
  const config = getCottageConfig();
  const presets = config.modelPresets ?? [];
  if (presets.length > 0) {
    return presets.map((preset) => ({
      id: preset.id,
      name: preset.name,
      preset,
      config: preset.config,
    }));
  }
  const active = getLlmConfig();
  return active
    ? [{ id: '__legacy_active__', name: active.model, config: active }]
    : [];
});

const selectedModel = computed(() =>
  modelOptions.value.find((item) => item.id === selectedModelId.value),
);
const estimatedCallLimit = computed(() => maxModelCalls.value * repeatCount.value);
const estimatedTokenLimit = computed(() => maxTotalTokens.value * repeatCount.value);
const progressPercentage = computed(() =>
  progressTotal.value > 0
    ? Math.round((progressCompleted.value / progressTotal.value) * 100)
    : 0,
);
const selectedHistoryEntry = computed(() =>
  history.value.find((entry) => entry.id === selectedHistoryId.value) ?? null,
);
const baselineComparisons = computed(() => {
  const report = currentReport.value;
  if (!report) return [];
  return liveEvalBaselineGroupsForReport(report).flatMap((group) => {
    const baseline = baselines.value[group];
    if (!baseline) return [];
    return [{
      group,
      label: baselineGroupLabel(group),
      baseline,
      comparison: compareLiveEvalReports(
        baseline.report,
        selectLiveEvalReportGroup(report, group),
      ),
    }];
  });
});
const chatEvalCases = computed(() =>
  LIVE_EVAL_CASES.filter((item) => item.mode !== 'plan'),
);
const planEvalCases = computed(() =>
  LIVE_EVAL_CASES.filter((item) => item.mode === 'plan'),
);
const selectedCaseIdSet = computed(() => new Set(selectedCaseIds.value));

const caseGroupFullySelected = (cases: readonly LiveEvalCase[]) =>
  cases.length > 0 && cases.every((item) => selectedCaseIdSet.value.has(item.id));

const caseGroupPartiallySelected = (cases: readonly LiveEvalCase[]) => {
  const selectedCount = cases.filter((item) => selectedCaseIdSet.value.has(item.id)).length;
  return selectedCount > 0 && selectedCount < cases.length;
};

const toggleCaseGroup = (cases: readonly LiveEvalCase[], checked: unknown) => {
  const groupIds = new Set(cases.map((item) => item.id));
  selectedCaseIds.value = checked === true
    ? [...new Set([...selectedCaseIds.value, ...groupIds])]
    : selectedCaseIds.value.filter((id) => !groupIds.has(id));
  if (checked === true) ensureCaseBudget(cases);
};

const estimatedCaseCalls = (item: LiveEvalCase) => {
  if (item.id === 'plan-mode-suggestion') return 2;
  if (item.id === 'plan-out-of-scope-revision') return 20;
  if (item.id === 'plan-turn-budget-exhaustion') return 3;
  if (item.id === 'plan-journal-authoritative') return 8;
  return item.mode === 'plan' ? 12 : 3;
};

const estimatedCaseTokens = (item: LiveEvalCase) => {
  if (item.id === 'plan-mode-suggestion') return 5_000;
  if (item.id === 'plan-out-of-scope-revision') return 80_000;
  if (item.id === 'plan-turn-budget-exhaustion') return 10_000;
  if (item.id === 'plan-journal-authoritative') return 25_000;
  if (item.id === 'plan-multifile-approved-dag') return 70_000;
  return item.mode === 'plan' ? 40_000 : 3_000;
};

const ensureCaseBudget = (cases: readonly LiveEvalCase[]) => {
  const estimatedCalls = cases.reduce((sum, item) => sum + estimatedCaseCalls(item), 0);
  const estimatedTokens = cases.reduce((sum, item) => sum + estimatedCaseTokens(item), 0);
  maxModelCalls.value = Math.max(maxModelCalls.value, estimatedCalls);
  maxTotalTokens.value = Math.max(maxTotalTokens.value, estimatedTokens);
  if (cases.some((item) => item.mode === 'plan')) {
    maxOutputTokens.value = Math.max(maxOutputTokens.value, 3_000);
    maxDurationSeconds.value = Math.max(
      maxDurationSeconds.value,
      cases.length === LIVE_EVAL_CASES.length ? 900 : 600,
    );
  }
};

const selectSmokeCases = () => {
  selectedCaseIds.value = [...LIVE_EVAL_SMOKE_CASE_IDS];
};

const selectAllCases = () => {
  selectedCaseIds.value = LIVE_EVAL_CASES.map((item) => item.id);
  // “全部场景”是显式的高成本操作，同时给出足以完成工具轮次的保守上限。
  ensureCaseBudget(LIVE_EVAL_CASES);
};

const ensureSelectedModel = () => {
  if (!modelOptions.value.some((item) => item.id === selectedModelId.value)) {
    const activeId = getCottageConfig().activePresetId;
    selectedModelId.value =
      modelOptions.value.find((item) => item.id === activeId)?.id ??
      modelOptions.value[0]?.id ??
      '';
  }
};

const refreshHistory = async () => {
  try {
    if (workspaceMode.value === 'directory') {
      if (!evalRoot.value) {
        history.value = [];
        baselines.value = {};
      } else {
        const [reports, savedBaseline] = await Promise.all([
          loadDirectoryLiveEvalHistory(evalRoot.value),
          loadDirectoryLiveEvalBaselines(evalRoot.value),
        ]);
        history.value = reports;
        baselines.value = savedBaseline;
      }
    } else {
      history.value = await loadLiveEvalHistory();
      baselines.value = {};
    }
    if (
      selectedHistoryId.value &&
      !history.value.some((entry) => entry.id === selectedHistoryId.value)
    ) selectedHistoryId.value = '';
  } catch (error) {
    ElMessage.error(`读取评测历史失败：${error instanceof Error ? error.message : String(error)}`);
  }
};

const chooseEvalDirectory = async () => {
  if (!('showDirectoryPicker' in window)) {
    ElMessage.error('当前浏览器不支持本地目录授权');
    return;
  }
  try {
    const picked = await window.showDirectoryPicker({ mode: 'readwrite' });
    if (
      workspace.kind === 'folder' &&
      workspace.rootHandle &&
      await picked.isSameEntry(workspace.rootHandle)
    ) {
      throw new Error('不能把当前项目工作区直接设为评测目录');
    }
    const permission = await picked.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') throw new Error('需要读写权限才能使用专用评测目录');
    await initializeLiveEvalRoot(picked);
    await rememberLiveEvalRoot(picked);
    evalRoot.value = picked;
    evalRootName.value = picked.name;
    workspaceMode.value = 'directory';
    currentReport.value = null;
    selectedHistoryId.value = '';
    await refreshHistory();
    ElMessage.success(`已连接专用评测目录：${picked.name}`);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
};

const restoreEvalDirectory = async () => {
  try {
    const restored = await restoreLiveEvalRoot();
    if (!restored) return;
    await initializeLiveEvalRoot(restored);
    evalRoot.value = restored;
    evalRootName.value = restored.name;
  } catch {
    evalRoot.value = null;
    evalRootName.value = '';
  }
};

const createConfig = (option: ModelOption, baseUrl?: string): LiveEvalConfig => ({
  enabled: true,
  dryRun: false,
  provider: option.config.provider,
  model: option.config.model,
  connectionId: option.config.connectionId ?? `browser-eval:${option.config.provider}`,
  apiKeyEnv: 'browser-provider-secrets',
  apiKey: '',
  ...(baseUrl ? { baseUrl } : {}),
  caseIds: [...selectedCaseIds.value],
  tags: [],
  budget: {
    maxCases: selectedCaseIds.value.length,
    maxModelCalls: maxModelCalls.value,
    maxTotalTokens: maxTotalTokens.value,
    maxDurationMs: maxDurationSeconds.value * 1_000,
    maxOutputTokens: maxOutputTokens.value,
  },
  minimumScore: minimumScore.value,
  reportPath: '',
});

const runEvaluation = async () => {
  const option = selectedModel.value;
  if (!option) {
    ElMessage.warning('请先在设置中配置并选择模型');
    return;
  }
  if (selectedCaseIds.value.length === 0) {
    ElMessage.warning('请至少选择一个评测场景');
    return;
  }
  if (workspaceMode.value === 'directory' && !evalRoot.value) {
    ElMessage.warning('请先选择或重新授权专用评测目录');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `将运行 ${selectedCaseIds.value.length} 个场景 × ${repeatCount.value} 次，` +
        `总预算上限为 ${estimatedCallLimit.value} 次模型调用、${estimatedTokenLimit.value.toLocaleString()} tokens。` +
        (workspaceMode.value === 'directory'
          ? `运行副本和报告将写入“${evalRootName.value}”。`
          : ''),
      '确认运行真实模型评测',
      { confirmButtonText: '开始运行', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }

  running.value = true;
  progressCompleted.value = 0;
  progressTotal.value = selectedCaseIds.value.length * repeatCount.value;
  progressLabel.value = '正在读取模型连接…';
  try {
    if (workspaceMode.value === 'directory' && evalRoot.value) {
      const permission = await evalRoot.value.queryPermission({ mode: 'readwrite' });
      const granted = permission === 'granted'
        ? permission
        : await evalRoot.value.requestPermission({ mode: 'readwrite' });
      if (granted !== 'granted') throw new Error('专用评测目录的读写授权已失效');
      await initializeLiveEvalRoot(evalRoot.value);
    }
    const secrets = await loadProviderSecrets();
    const presetSecret = option.preset
      ? getPresetApiKey(secrets, option.preset.id)
      : undefined;
    const providerSecret = getSecretForProvider(
      secrets,
      option.config.provider,
      option.config.connectionId,
    );
    const secret = {
      apiKey:
        option.config.apiKey?.trim() ||
        presetSecret?.apiKey?.trim() ||
        providerSecret?.apiKey?.trim() ||
        '',
      baseUrl:
        option.config.baseUrl?.trim() ||
        presetSecret?.baseUrl?.trim() ||
        providerSecret?.baseUrl?.trim(),
    };

    const batchId = workspaceMode.value === 'directory'
      ? createLiveEvalBatchId()
      : null;
    for (let runIndex = 0; runIndex < repeatCount.value; runIndex += 1) {
      const config = createConfig(option, secret.baseUrl);
      const directoryRun = evalRoot.value && batchId
        ? await prepareDirectoryRun(
            evalRoot.value,
            batchId,
            runIndex + 1,
            config,
          )
        : null;
      const rawModel = createChatModel(
        { ...option.config, maxTokens: config.budget.maxOutputTokens },
        secret,
      );
      const budgeted = createLiveEvalBudgetedModel(rawModel, config.budget);
      const report = await runLiveEvalSuite({
        config,
        model: budgeted.model,
        usageSnapshot: budgeted.snapshot,
        callsSnapshot: budgeted.callsSnapshot,
        setModelPhase: budgeted.setPhase,
        getBudgetViolation: budgeted.getViolation,
        ...(directoryRun ? { createWorkspace: directoryRun.createWorkspace } : {}),
        onCaseStart(item) {
          progressLabel.value = `第 ${runIndex + 1}/${repeatCount.value} 轮：${item.title}`;
        },
        onCaseComplete() {
          progressCompleted.value += 1;
        },
      });
      currentReport.value = report;
      selectedHistoryId.value = '';
      if (directoryRun) await directoryRun.writeReport(report);
      else await saveLiveEvalReport(report);
    }
    await refreshHistory();
    selectedHistoryId.value = history.value.find(
      (entry) => entry.generatedAt === currentReport.value?.generatedAt,
    )?.id ?? '';
    progressLabel.value = currentReport.value?.summary.passed
      ? '评测完成，全部通过'
      : '评测完成，存在未通过项';
    if (currentReport.value?.summary.passed) ElMessage.success('真实模型评测通过');
    else ElMessage.warning('评测已完成，请查看未通过项');
  } catch (error) {
    progressLabel.value = '运行失败';
    ElMessage.error(`评测运行失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    running.value = false;
  }
};

const showHistoryReport = (entry: StoredLiveEvalReport) => {
  currentReport.value = entry.report;
  selectedHistoryId.value = entry.id;
};

const setBaseline = async (
  entry: StoredLiveEvalReport,
  group: LiveEvalBaselineGroup,
) => {
  if (workspaceMode.value !== 'directory' || !evalRoot.value) return;
  const directoryEntry = entry as DirectoryStoredLiveEvalReport;
  if (!liveEvalBaselineGroupsForReport(entry.report).includes(group)) return;
  const existing = baselines.value[group];
  if (existing && existing.source.reportId !== entry.id) {
    try {
      await ElMessageBox.confirm(
        `将替换${baselineGroupLabel(group)}分组的当前基线。旧基线来源运行不会被删除。`,
        `替换${baselineGroupLabel(group)}基线？`,
        { confirmButtonText: '设为新基线', cancelButtonText: '取消', type: 'warning' },
      );
    } catch {
      return;
    }
  }
  try {
    const saved = await saveDirectoryLiveEvalBaseline(evalRoot.value, directoryEntry, group);
    baselines.value = { ...baselines.value, [group]: saved };
    currentReport.value = entry.report;
    selectedHistoryId.value = entry.id;
    ElMessage.success(`已保存${baselineGroupLabel(group)}分组基线`);
  } catch (error) {
    ElMessage.error(`保存基线失败：${error instanceof Error ? error.message : String(error)}`);
  }
};

const clearBaseline = async (group: LiveEvalBaselineGroup) => {
  if (!evalRoot.value || !baselines.value[group]) return;
  try {
    await ElMessageBox.confirm(
      `只会删除${baselineGroupLabel(group)}分组基线，其他分组、来源运行和历史报告仍会保留。`,
      `清除${baselineGroupLabel(group)}基线？`,
      { confirmButtonText: '清除基线', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await deleteDirectoryLiveEvalBaseline(evalRoot.value, group);
    const next = { ...baselines.value };
    delete next[group];
    baselines.value = next;
    ElMessage.success(`已清除${baselineGroupLabel(group)}分组基线`);
  } catch (error) {
    ElMessage.error(`清除基线失败：${error instanceof Error ? error.message : String(error)}`);
  }
};

const baselineGroupsForEntry = (entry: StoredLiveEvalReport) =>
  (['agent', 'plan'] as const).filter(
    (group) => baselines.value[group]?.source.reportId === entry.id,
  );

const unsetBaselineGroupsForEntry = (entry: StoredLiveEvalReport) =>
  liveEvalBaselineGroupsForReport(entry.report).filter(
    (group) => baselines.value[group]?.source.reportId !== entry.id,
  );

const downloadReport = (report: LiveEvalReport) => {
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `live-eval-${report.generatedAt.replace(/[:.]/g, '-')}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

const removeHistory = async (entry: StoredLiveEvalReport) => {
  try {
    await ElMessageBox.confirm(
      entry.id.startsWith('directory:')
        ? '将删除这轮评测的报告和隔离工作区副本；fixture、其他轮次和模型配置不受影响。'
        : '只会删除这份浏览器评测报告，不影响模型配置或工作区。',
      '删除评测历史？',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  if (entry.id.startsWith('directory:') && evalRoot.value) {
    await deleteDirectoryLiveEvalRun(
      evalRoot.value,
      entry as DirectoryStoredLiveEvalReport,
    );
  } else {
    await deleteLiveEvalReport(entry.id);
  }
  if (currentReport.value === entry.report) currentReport.value = null;
  if (selectedHistoryId.value === entry.id) selectedHistoryId.value = '';
  await refreshHistory();
};

const formatDate = (value: string) => new Date(value).toLocaleString();
const formatScore = (value: number) => `${Math.round(value * 100)}%`;
const maxModelContextCharacters = (item: LiveEvalCaseReport) =>
  Math.max(0, ...(item.modelCallDetails ?? []).map((call) => call.messageCharacters));
const failedCheckLabels = (item: LiveEvalCaseReport) =>
  item.checks.filter((check) => !check.passed).map((check) => check.id).join('、');
const formatDelta = (value: number, unit = '') =>
  `${value > 0 ? '+' : ''}${value}${unit}`;
const formatScoreDelta = (value: number) =>
  formatDelta(Math.round(value * 100), ' 个百分点');
const trendLabel = (trend: 'improved' | 'regressed' | 'unchanged') =>
  trend === 'improved' ? '改善' : trend === 'regressed' ? '退化' : '持平';

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return;
    ensureSelectedModel();
    void refreshHistory();
  },
);
watch(modelOptions, ensureSelectedModel);
watch(
  selectedCaseIds,
  (ids) => ensureCaseBudget(LIVE_EVAL_CASES.filter((item) => ids.includes(item.id))),
  { deep: true },
);
watch(workspaceMode, (mode) => {
  localStorage.setItem('cottage:live-eval-workspace-mode', mode);
  currentReport.value = null;
  selectedHistoryId.value = '';
  void refreshHistory();
});
onMounted(async () => {
  ensureSelectedModel();
  await restoreEvalDirectory();
  if (props.visible) void refreshHistory();
});
</script>

<template>
  <section class="live-eval-tab">
    <div class="live-eval-heading">
      <div>
        <h3>真实模型评测</h3>
        <p>复用当前浏览器模型配置，在隔离内存或专用本地目录中运行统一回归场景。</p>
      </div>
      <ElButton :disabled="running" @click="refreshHistory">
        <template #icon><NIcon :component="RefreshOutline" /></template>
        刷新历史
      </ElButton>
    </div>

    <ElAlert
      title="运行会产生真实模型调用和费用；API Key 仅从本机 IndexedDB 读取，不写入报告。"
      type="warning"
      :closable="false"
      show-icon
    />

    <div class="live-eval-card">
      <div class="live-eval-workspace-mode">
        <div class="live-eval-field">
          <span>评测工作区</span>
          <ElRadioGroup v-model="workspaceMode" :disabled="running">
            <ElRadioButton value="memory">隔离内存</ElRadioButton>
            <ElRadioButton value="directory">专用本地目录</ElRadioButton>
          </ElRadioGroup>
        </div>
        <div v-if="workspaceMode === 'directory'" class="live-eval-directory">
          <div>
            <strong>{{ evalRootName || '尚未选择目录' }}</strong>
            <span>
              {{ evalRoot
                ? 'fixture、隔离运行副本和报告都会保存在此目录。'
                : '首次仅接受空目录；授权失效后需要重新选择。' }}
            </span>
          </div>
          <ElButton :disabled="running" @click="chooseEvalDirectory">
            <template #icon><NIcon :component="FolderOpenOutline" /></template>
            {{ evalRoot ? '更换目录' : '选择目录' }}
          </ElButton>
        </div>
      </div>

      <label class="live-eval-field live-eval-field--wide">
        <span>模型预设</span>
        <ElSelect v-model="selectedModelId" :disabled="running" placeholder="请先配置模型">
          <ElOption
            v-for="option in modelOptions"
            :key="option.id"
            :label="`${option.name} · ${providerLabel(option.config.provider)} / ${option.config.model}`"
            :value="option.id"
          />
        </ElSelect>
      </label>

      <div class="live-eval-field live-eval-field--wide">
        <div class="live-eval-case-selector-head">
          <span>评测场景（已选 {{ selectedCaseIds.length }}/{{ LIVE_EVAL_CASES.length }}）</span>
          <div>
            <ElButton text size="small" :disabled="running" @click="selectSmokeCases">
              核心冒烟
            </ElButton>
            <ElButton text size="small" :disabled="running" @click="selectAllCases">
              选择全部
            </ElButton>
          </div>
        </div>
        <div class="live-eval-case-groups">
          <section class="live-eval-case-group">
            <div class="live-eval-case-group-head">
              <ElCheckbox
                :model-value="caseGroupFullySelected(chatEvalCases)"
                :indeterminate="caseGroupPartiallySelected(chatEvalCases)"
                :disabled="running"
                @change="toggleCaseGroup(chatEvalCases, $event)"
              >
                普通 Agent
              </ElCheckbox>
              <ElTag size="small" effect="plain">{{ chatEvalCases.length }} 项</ElTag>
            </div>
            <ElCheckboxGroup v-model="selectedCaseIds" :disabled="running" class="live-eval-cases">
              <ElCheckbox v-for="item in chatEvalCases" :key="item.id" :value="item.id">
                <span class="live-eval-case-copy">
                  <span class="live-eval-case-title">{{ item.title }}</span>
                  <span class="live-eval-case-id">{{ item.id }}</span>
                </span>
              </ElCheckbox>
            </ElCheckboxGroup>
          </section>
          <section class="live-eval-case-group">
            <div class="live-eval-case-group-head">
              <ElCheckbox
                :model-value="caseGroupFullySelected(planEvalCases)"
                :indeterminate="caseGroupPartiallySelected(planEvalCases)"
                :disabled="running"
                @change="toggleCaseGroup(planEvalCases, $event)"
              >
                Plan Mode
              </ElCheckbox>
              <ElTag size="small" effect="plain">{{ planEvalCases.length }} 项</ElTag>
            </div>
            <ElCheckboxGroup v-model="selectedCaseIds" :disabled="running" class="live-eval-cases">
              <ElCheckbox v-for="item in planEvalCases" :key="item.id" :value="item.id">
                <span class="live-eval-case-copy">
                  <span class="live-eval-case-title">{{ item.title }}</span>
                  <span class="live-eval-case-id">{{ item.id }}</span>
                </span>
              </ElCheckbox>
            </ElCheckboxGroup>
          </section>
        </div>
      </div>

      <div class="live-eval-grid">
        <label class="live-eval-field">
          <span>重复次数</span>
          <ElInputNumber v-model="repeatCount" :min="1" :max="5" :disabled="running" />
        </label>
        <label class="live-eval-field">
          <span>每轮模型调用上限</span>
          <ElInputNumber v-model="maxModelCalls" :min="1" :max="200" :disabled="running" />
        </label>
        <label class="live-eval-field">
          <span>每轮 Token 上限</span>
          <ElInputNumber v-model="maxTotalTokens" :min="100" :step="1000" :disabled="running" />
        </label>
        <label class="live-eval-field">
          <span>每轮时长上限（秒）</span>
          <ElInputNumber v-model="maxDurationSeconds" :min="10" :max="1800" :disabled="running" />
        </label>
        <label class="live-eval-field">
          <span>单次输出 Token 上限</span>
          <ElInputNumber v-model="maxOutputTokens" :min="100" :step="100" :disabled="running" />
        </label>
        <label class="live-eval-field">
          <span>最低通过分</span>
          <ElInputNumber v-model="minimumScore" :min="0" :max="1" :step="0.05" :precision="2" :disabled="running" />
        </label>
      </div>

      <div class="live-eval-actions">
        <span>本次总上限：{{ estimatedCallLimit }} 次调用 / {{ estimatedTokenLimit.toLocaleString() }} tokens</span>
        <ElButton
          type="primary"
          :loading="running"
          :disabled="modelOptions.length === 0 || (workspaceMode === 'directory' && !evalRoot)"
          @click="runEvaluation"
        >
          <template #icon><NIcon :component="PlayOutline" /></template>
          运行真实评测
        </ElButton>
      </div>

      <div v-if="running || progressLabel" class="live-eval-progress">
        <ElProgress :percentage="progressPercentage" :status="currentReport && !currentReport.summary.passed ? 'exception' : undefined" />
        <span>{{ progressLabel }}</span>
      </div>
    </div>

    <div v-if="currentReport" class="live-eval-card">
      <div class="live-eval-result-head">
        <div>
          <ElTag :type="currentReport.summary.passed ? 'success' : 'danger'">
            {{ currentReport.summary.passed ? '通过' : '未通过' }}
          </ElTag>
          <strong>{{ currentReport.model.model }}</strong>
          <span>{{ formatDate(currentReport.generatedAt) }}</span>
        </div>
        <div class="live-eval-result-actions">
          <ElButton
            v-for="group in workspaceMode === 'directory' && selectedHistoryEntry
              ? liveEvalBaselineGroupsForReport(selectedHistoryEntry.report)
              : []"
            :key="group"
            text
            :disabled="baselines[group]?.source.reportId === selectedHistoryEntry?.id"
            @click="selectedHistoryEntry && setBaseline(selectedHistoryEntry, group)"
          >
            {{ baselines[group]?.source.reportId === selectedHistoryEntry?.id
              ? `当前${baselineGroupLabel(group)}基线`
              : `设为${baselineGroupLabel(group)}基线` }}
          </ElButton>
          <ElButton text @click="downloadReport(currentReport)">
            <template #icon><NIcon :component="DownloadOutline" /></template>
            导出 JSON
          </ElButton>
        </div>
      </div>
      <div class="live-eval-metrics">
        <span>通过 {{ currentReport.summary.passedCount }}/{{ currentReport.summary.caseCount }}</span>
        <span>平均分 {{ formatScore(currentReport.summary.averageScore) }}</span>
        <span>{{ currentReport.summary.usage.modelCalls }} 次调用</span>
        <span>{{ currentReport.summary.usage.totalTokens ?? 0 }} tokens</span>
        <span>{{ (currentReport.summary.usage.durationMs / 1000).toFixed(1) }} 秒</span>
      </div>
      <div class="live-eval-results">
        <article v-for="item in currentReport.cases" :key="item.caseId" class="live-eval-result-row">
          <div>
            <ElTag size="small" :type="item.passed ? 'success' : 'danger'">
              {{ item.passed ? '通过' : '失败' }}
            </ElTag>
            <strong>{{ item.title }}</strong>
            <span>{{ formatScore(item.score) }}</span>
          </div>
          <p v-if="item.error" class="live-eval-error">{{ item.error }}</p>
          <p v-else-if="!item.passed" class="live-eval-error">
            未通过检查：{{ failedCheckLabels(item) || '评分未达到阈值' }}
          </p>
          <p>{{ item.responseExcerpt || '（无文本回复）' }}</p>
          <small>
            工具：{{ item.toolCalls.map((call) => `${call.name}:${call.status}`).join('、') || '无' }}；
            变更：{{ item.changedPaths.join('、') || '无' }}
          </small>
          <small>
            模型：{{ item.usage.modelCalls }} 次调用，{{ item.usage.totalTokens ?? 0 }} tokens
            （缓存输入 {{ item.usage.cachedInputTokens ?? 0 }}）；最大消息上下文
            {{ maxModelContextCharacters(item) }} 字符
          </small>
          <small v-if="item.plan?.finalRun">
            Plan 状态：{{ item.plan.finalRun.status }}；revision {{ item.plan.finalDefinition?.revision ?? '—' }}
          </small>
        </article>
      </div>

      <section v-if="baselineComparisons.length" class="live-eval-comparison">
        <div class="live-eval-comparison-head">
          <strong>与分组基线比较</strong>
        </div>
        <section
          v-for="item in baselineComparisons"
          :key="item.group"
          class="live-eval-baseline-group"
        >
          <div class="live-eval-baseline-group-head">
            <div>
              <strong>{{ item.label }}</strong>
              <span>
                {{ item.baseline.report.model.model }} · {{ formatDate(item.baseline.source.generatedAt) }}
              </span>
            </div>
            <ElButton text type="danger" @click="clearBaseline(item.group)">清除该组基线</ElButton>
          </div>
          <ElAlert
            v-if="!item.comparison.compatible"
            :title="item.comparison.reason"
            type="warning"
            :closable="false"
            show-icon
          />
          <template v-else>
            <div class="live-eval-comparison-metrics">
              <div>
                <span>通过数</span>
                <strong>{{ item.comparison.metrics.passedCount.baseline }} → {{ item.comparison.metrics.passedCount.current }}</strong>
                <small>{{ formatDelta(item.comparison.metrics.passedCount.delta) }}</small>
              </div>
              <div>
                <span>平均分</span>
                <strong>{{ formatScore(item.comparison.metrics.averageScore.baseline) }} → {{ formatScore(item.comparison.metrics.averageScore.current) }}</strong>
                <small>{{ formatScoreDelta(item.comparison.metrics.averageScore.delta) }}</small>
              </div>
              <div>
                <span>模型调用</span>
                <strong>{{ item.comparison.metrics.modelCalls.baseline }} → {{ item.comparison.metrics.modelCalls.current }}</strong>
                <small>{{ formatDelta(item.comparison.metrics.modelCalls.delta) }}</small>
              </div>
              <div>
                <span>Token</span>
                <strong>{{ item.comparison.metrics.totalTokens.baseline }} → {{ item.comparison.metrics.totalTokens.current }}</strong>
                <small>{{ formatDelta(item.comparison.metrics.totalTokens.delta) }}</small>
              </div>
              <div>
                <span>耗时</span>
                <strong>{{ (item.comparison.metrics.durationMs.baseline / 1000).toFixed(1) }}s → {{ (item.comparison.metrics.durationMs.current / 1000).toFixed(1) }}s</strong>
                <small>{{ formatDelta(Number((item.comparison.metrics.durationMs.delta / 1000).toFixed(1)), 's') }}</small>
              </div>
            </div>
            <div class="live-eval-comparison-cases">
              <div v-for="caseItem in item.comparison.cases" :key="caseItem.caseId" class="live-eval-comparison-case-row">
                <ElTag
                  size="small"
                  :type="caseItem.trend === 'improved' ? 'success' : caseItem.trend === 'regressed' ? 'danger' : 'info'"
                >
                  {{ trendLabel(caseItem.trend) }}
                </ElTag>
                <span>{{ caseItem.title }}</span>
                <small>分数 {{ formatScore(caseItem.score.baseline) }} → {{ formatScore(caseItem.score.current) }}</small>
                <small>Token {{ caseItem.totalTokens.baseline }} → {{ caseItem.totalTokens.current }}</small>
              </div>
            </div>
          </template>
        </section>
      </section>
    </div>

    <div class="live-eval-card">
      <div class="live-eval-history-head">
        <h4>{{ workspaceMode === 'directory' ? '目录历史' : '浏览器历史' }}</h4>
        <span>
          {{ workspaceMode === 'directory'
            ? '直接读取专用目录中的最近 50 份报告。'
            : 'IndexedDB 最多保留 50 份，不包含密钥和完整请求。' }}
        </span>
      </div>
      <div v-if="history.length" class="live-eval-history">
        <div
          v-for="entry in history"
          :key="entry.id"
          class="live-eval-history-row"
          :class="{ 'is-selected': selectedHistoryId === entry.id }"
          role="button"
          tabindex="0"
          @click="showHistoryReport(entry)"
          @keydown.enter="showHistoryReport(entry)"
        >
          <ElTag size="small" :type="entry.report.summary.passed ? 'success' : 'danger'">
            {{ entry.report.summary.passed ? '通过' : '失败' }}
          </ElTag>
          <span class="live-eval-history-model">{{ entry.report.model.model }}</span>
          <span>{{ entry.report.summary.passedCount }}/{{ entry.report.summary.caseCount }}</span>
          <span>{{ entry.report.summary.usage.totalTokens ?? 0 }} tokens</span>
          <time>{{ formatDate(entry.generatedAt) }}</time>
          <div class="live-eval-history-actions">
            <template v-if="workspaceMode === 'directory' && baselineGroupsForEntry(entry).length">
              <ElTag
                v-for="group in baselineGroupsForEntry(entry)"
                :key="group"
                size="small"
                type="success"
              >{{ baselineGroupLabel(group) }} 基线</ElTag>
            </template>
            <ElButton
              v-for="group in workspaceMode === 'directory' ? unsetBaselineGroupsForEntry(entry) : []"
              :key="`set-${group}`"
              text
              size="small"
              @click.stop="setBaseline(entry, group)"
            >设为{{ baselineGroupLabel(group) }}基线</ElButton>
            <ElButton text size="small" aria-label="删除这份评测历史" @click.stop="removeHistory(entry)">
              <NIcon :component="TrashOutline" />
            </ElButton>
          </div>
        </div>
      </div>
      <p v-else class="live-eval-empty">
        {{ workspaceMode === 'directory' && !evalRoot
          ? '选择专用评测目录后显示文件历史。'
          : '暂无评测历史。' }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.live-eval-tab {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
  box-sizing: border-box;
  color: var(--cottage-ink);
  overflow-y: auto;
  padding-right: 4px;
}
.live-eval-tab > * { flex: 0 0 auto; }
.live-eval-heading, .live-eval-result-head, .live-eval-history-head, .live-eval-actions {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.live-eval-heading { min-height: 42px; }
.live-eval-heading h3, .live-eval-history-head h4 { margin: 0; line-height: 1.3; }
.live-eval-heading p, .live-eval-history-head span, .live-eval-empty { margin: 4px 0 0; color: var(--cottage-muted); font-size: 12px; }
.live-eval-tab :deep(.el-alert) { min-height: 44px; padding: 9px 12px; align-items: center; }
.live-eval-tab :deep(.el-alert__content) { padding: 0; }
.live-eval-tab :deep(.el-alert__title) { line-height: 1.45; }
.live-eval-card { border: 1px solid var(--cottage-border); border-radius: 12px; padding: 16px; background: var(--cottage-surface); display: grid; align-content: start; gap: 16px; }
.live-eval-field { display: grid; gap: 6px; font-size: 12px; color: var(--cottage-muted); }
.live-eval-field--wide { width: 100%; }
.live-eval-workspace-mode { display: grid; gap: 10px; }
.live-eval-directory {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--cottage-border);
  border-radius: 9px;
  background: var(--cottage-surface-sunken);
}
.live-eval-directory > div { display: grid; min-width: 0; gap: 2px; }
.live-eval-directory strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.live-eval-directory span { color: var(--cottage-muted); font-size: 11px; line-height: 1.45; }
.live-eval-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.live-eval-grid :deep(.el-input-number) { width: 100%; }
.live-eval-case-selector-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.live-eval-case-selector-head > div { display: flex; align-items: center; gap: 2px; }
.live-eval-case-groups { display: grid; gap: 14px; }
.live-eval-case-group { display: grid; gap: 8px; }
.live-eval-case-group-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.live-eval-case-group-head :deep(.el-checkbox) { height: auto; margin-right: 0; color: var(--cottage-ink); font-weight: 600; }
.live-eval-cases { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.live-eval-cases :deep(.el-checkbox) {
  width: 100%;
  height: auto;
  min-height: 54px;
  box-sizing: border-box;
  margin-right: 0;
  padding: 9px 10px;
  align-items: flex-start;
  border: 1px solid var(--cottage-border);
  border-radius: 9px;
  background: var(--cottage-surface-sunken);
}
.live-eval-cases :deep(.el-checkbox:hover),
.live-eval-cases :deep(.el-checkbox.is-checked) {
  border-color: color-mix(in srgb, var(--cottage-accent) 55%, var(--cottage-border));
  background: var(--cottage-accent-bg);
}
.live-eval-cases :deep(.el-checkbox__input) { margin-top: 2px; }
.live-eval-cases :deep(.el-checkbox__label) {
  min-width: 0;
  padding-left: 8px;
  line-height: 1.35;
  white-space: normal;
}
.live-eval-case-copy { display: grid; min-width: 0; gap: 2px; }
.live-eval-case-title { color: var(--cottage-ink); }
.live-eval-case-id { color: var(--cottage-muted); font-size: 11px; overflow-wrap: anywhere; }
.live-eval-actions > span { color: var(--cottage-muted); font-size: 12px; }
.live-eval-progress { display: grid; gap: 5px; color: var(--cottage-muted); font-size: 12px; }
.live-eval-result-head > div { display: flex; align-items: center; gap: 9px; min-width: 0; }
.live-eval-result-head span { color: var(--cottage-muted); font-size: 12px; }
.live-eval-result-actions { display: flex; align-items: center; gap: 4px; }
.live-eval-metrics { display: flex; flex-wrap: wrap; gap: 8px; }
.live-eval-metrics span { border-radius: 999px; background: var(--cottage-surface-sunken); padding: 4px 9px; font-size: 12px; }
.live-eval-results { display: grid; gap: 9px; }
.live-eval-result-row { border-top: 1px solid var(--cottage-border); padding-top: 9px; }
.live-eval-result-row > div { display: flex; align-items: center; gap: 8px; }
.live-eval-result-row p { margin: 7px 0; font-size: 12px; line-height: 1.6; }
.live-eval-result-row small { color: var(--cottage-muted); }
.live-eval-error { color: var(--el-color-danger); }
.live-eval-comparison { display: grid; gap: 12px; border-top: 1px solid var(--cottage-border); padding-top: 14px; }
.live-eval-comparison-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.live-eval-baseline-group { display: grid; gap: 10px; padding-top: 10px; border-top: 1px solid var(--cottage-border); }
.live-eval-baseline-group-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.live-eval-baseline-group-head > div { display: grid; gap: 3px; }
.live-eval-baseline-group-head span { color: var(--cottage-muted); font-size: 11px; }
.live-eval-comparison-metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.live-eval-comparison-metrics > div { display: grid; gap: 3px; min-width: 0; padding: 9px 10px; border-radius: 9px; background: var(--cottage-surface-sunken); }
.live-eval-comparison-metrics span, .live-eval-comparison-metrics small { color: var(--cottage-muted); font-size: 11px; }
.live-eval-comparison-metrics strong { font-size: 13px; white-space: nowrap; }
.live-eval-comparison-cases { display: grid; gap: 6px; }
.live-eval-comparison-case-row { display: grid; grid-template-columns: auto minmax(120px, 1fr) auto auto; align-items: center; gap: 8px; min-height: 34px; padding: 5px 7px; border-radius: 7px; }
.live-eval-comparison-case-row:hover { background: var(--cottage-surface-sunken); }
.live-eval-comparison-cases small { color: var(--cottage-muted); }
.live-eval-history { display: grid; align-content: start; gap: 4px; }
.live-eval-history-row { width: 100%; min-height: 42px; box-sizing: border-box; border: 1px solid transparent; border-radius: 8px; background: transparent; color: inherit; padding: 7px 8px; display: grid; grid-template-columns: auto minmax(100px, 1fr) auto auto auto minmax(112px, auto); align-items: center; gap: 8px; text-align: left; cursor: pointer; }
.live-eval-history-row:hover, .live-eval-history-row.is-selected { background: var(--cottage-surface-sunken); }
.live-eval-history-row.is-selected { border-color: var(--cottage-border); }
.live-eval-history-model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.live-eval-history-row time { color: var(--cottage-muted); font-size: 11px; }
.live-eval-history-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 2px; }
@media (max-width: 860px) {
  .live-eval-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .live-eval-cases { grid-template-columns: 1fr; }
  .live-eval-comparison-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .live-eval-comparison-case-row { grid-template-columns: auto minmax(100px, 1fr) auto; }
  .live-eval-comparison-case-row > :last-child { display: none; }
  .live-eval-history-row { grid-template-columns: auto minmax(100px, 1fr) auto minmax(112px, auto); }
  .live-eval-history-row > :nth-child(4), .live-eval-history-row > time { display: none; }
}
@media (max-width: 600px) {
  .live-eval-heading, .live-eval-result-head, .live-eval-history-head, .live-eval-actions {
    align-items: flex-start;
    flex-direction: column;
  }
  .live-eval-directory { align-items: stretch; flex-direction: column; }
  .live-eval-directory :deep(.el-button) { width: 100%; }
  .live-eval-grid { grid-template-columns: 1fr; }
  .live-eval-comparison-head { align-items: flex-start; flex-direction: column; }
  .live-eval-baseline-group-head { align-items: flex-start; flex-direction: column; }
  .live-eval-comparison-metrics { grid-template-columns: 1fr; }
  .live-eval-comparison-case-row { grid-template-columns: auto minmax(0, 1fr); }
  .live-eval-comparison-case-row small { display: none; }
  .live-eval-history-row { grid-template-columns: auto minmax(0, 1fr) auto; }
  .live-eval-history-row > :nth-child(3) { display: none; }
  .live-eval-history-actions :deep(.el-button:first-of-type) { display: none; }
  .live-eval-case-selector-head { align-items: flex-start; flex-direction: column; }
  .live-eval-actions :deep(.el-button), .live-eval-heading :deep(.el-button) { width: 100%; }
}
</style>
