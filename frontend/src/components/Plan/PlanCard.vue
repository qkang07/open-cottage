<script setup lang="ts">
import { computed, onUnmounted, reactive, ref, watch } from 'vue';
import {
  ElButton,
  ElCollapse,
  ElCollapseItem,
  ElInput,
  ElInputNumber,
  ElMessage,
  ElMessageBox,
  ElOption,
  ElProgress,
  ElSelect,
  ElSwitch,
  ElTag,
} from 'element-plus';
import { storeToRefs } from 'pinia';
import { useAgentStore } from '../../stores/agent';
import { planProgress } from '../../plan/state';
import {
  workspaceWriteCoordinator,
  type WorkspaceWriteLockState,
} from '../../plan/workspaceLock';
import type {
  AcceptanceCriterion,
  PlanDefinition,
  PlanDraft,
  PlanRun,
  PlanStep,
} from '../../plan/types';
import type { CheckpointObjectIndex } from '../../plan/checkpoints';

const props = defineProps<{
  definition: PlanDefinition;
  run: PlanRun;
}>();

const agentStore = useAgentStore();
const { activePlanId } = storeToRefs(agentStore);
const editing = ref(false);
const saving = ref(false);
const restoring = ref(false);
const instruction = ref('');
const acceptanceNote = ref('');
const lockState = ref<WorkspaceWriteLockState>(workspaceWriteCoordinator.currentState);
const checkpointUsage = ref<CheckpointObjectIndex | null>(null);
const unsubscribeLock = workspaceWriteCoordinator.subscribe((state) => {
  lockState.value = state;
});
onUnmounted(unsubscribeLock);

interface EditableCriterion {
  id?: string;
  providerId: string;
  description: string;
  required: boolean;
  config: Record<string, unknown>;
  configText: string;
  advanced: boolean;
}

interface EditableStep {
  id: string;
  title: string;
  detail: string;
  kind: PlanStep['kind'];
  dependsOn: string[];
  skippable: boolean;
  allowedPathsText: string;
  acceptance: EditableCriterion[];
}

const criterionToEditable = (criterion: AcceptanceCriterion): EditableCriterion => ({
  id: criterion.id,
  providerId: criterion.providerId,
  description: criterion.description,
  required: criterion.required,
  config: { ...criterion.config },
  configText: JSON.stringify(criterion.config, null, 2),
  advanced: false,
});

const editable = reactive({
  goal: '',
  requirementsText: '',
  design: '',
  allowedPathsText: '',
  steps: [] as EditableStep[],
  finalAcceptance: [] as EditableCriterion[],
  preserveStepIds: [] as string[],
  budgets: { maxTurns: 25, maxChangedFiles: 20, maxExternalCalls: 10, maxStepRetries: 2 },
});

function resetEditor() {
  editable.goal = props.definition.goal;
  editable.requirementsText = props.definition.requirements.join('\n');
  editable.design = props.definition.design;
  editable.allowedPathsText = props.definition.allowedPathPrefixes.join('\n');
  editable.steps = props.definition.steps.map((step) => ({
    id: step.id,
    title: step.title,
    detail: step.detail,
    kind: step.kind,
    dependsOn: [...step.dependsOn],
    skippable: step.skippable === true,
    allowedPathsText: (step.allowedPathPrefixes ?? []).join('\n'),
    acceptance: step.acceptance.map(criterionToEditable),
  }));
  editable.finalAcceptance = props.definition.finalAcceptance.map(criterionToEditable);
  editable.preserveStepIds = props.definition.steps
    .filter((step) => ['completed', 'skipped'].includes(props.run.stepStates[step.id]?.status))
    .map((step) => step.id);
  editable.budgets = { ...props.definition.budgets };
}

const isActive = computed(() => activePlanId.value === props.definition.id);

watch(() => props.definition.revision, resetEditor, { immediate: true });
watch(
  () => [props.definition.id, props.run.updatedAt] as const,
  async () => {
    checkpointUsage.value = isActive.value
      ? await agentStore.getPlanCheckpointUsage().catch(() => null)
      : null;
  },
  { immediate: true },
);

const canEdit = computed(
  () =>
    isActive.value &&
    !props.run.repositoryCorrupt &&
    ['awaiting_approval', 'paused', 'waiting_for_user'].includes(props.run.status),
);
const progress = computed(() => planProgress(props.run));
const currentStep = computed(() =>
  props.definition.steps.find((step) => step.id === props.run.currentStepId),
);
const allAcceptanceCriteria = computed(() => [
  ...props.definition.steps.flatMap((step) => step.acceptance),
  ...props.definition.finalAcceptance,
]);
const heldByAnotherPlan = computed(
  () =>
    lockState.value.status === 'held' &&
    lockState.value.workspaceId === props.definition.workspaceId &&
    lockState.value.tabId !== workspaceWriteCoordinator.tabId,
);

const statusLabel: Record<PlanRun['status'], string> = {
  draft: '草稿',
  awaiting_approval: '待批准',
  running: '执行中',
  waiting_for_user: '等待用户',
  paused: '已暂停',
  verifying: '验证中',
  awaiting_acceptance: '待验收',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const statusType = computed(() => {
  if (props.run.status === 'completed') return 'success';
  if (props.run.status === 'failed' || props.run.status === 'cancelled') return 'danger';
  if (props.run.status === 'awaiting_approval' || props.run.status === 'awaiting_acceptance') return 'warning';
  return 'info';
});

const capabilityState = (providerId: string) => {
  if (providerId === 'user.acceptance') return { label: '需要人工验收', type: 'warning' as const };
  const cap = props.definition.verificationCapabilitySnapshot.find(
    (item) => item.providerId === providerId,
  );
  return cap?.available
    ? {
        label: `${cap.assurance ?? 'structural'} · v${cap.version ?? '1'}`,
        type: cap.assurance === 'functional' ? 'success' as const : 'info' as const,
      }
    : { label: '当前不可用', type: 'danger' as const };
};

function addCriterion(target: EditableCriterion[]) {
  target.push({
    providerId: 'user.acceptance',
    description: '',
    required: true,
    config: {},
    configText: '{}',
    advanced: false,
  });
}

function addStep() {
  editable.steps.push({
    id: crypto.randomUUID(),
    title: '',
    detail: '',
    kind: 'implementation',
    dependsOn: [],
    skippable: false,
    allowedPathsText: '',
    acceptance: [],
  });
}

const lines = (value: string) =>
  value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

const parseCriterion = (value: EditableCriterion) => {
  let config: Record<string, unknown>;
  try {
    const parsed = JSON.parse(value.configText || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    config = { ...parsed, ...value.config };
  } catch {
    throw new Error(`验收项「${value.description || value.providerId}」的配置必须是 JSON 对象`);
  }
  return {
    id: value.id,
    providerId: value.providerId,
    description: value.description,
    required: value.required,
    config,
  };
};

const providerSchemaFields = (providerId: string) => {
  const capability = props.definition.verificationCapabilitySnapshot.find(
    (item) => item.providerId === providerId,
  );
  const properties = capability?.configSchema?.properties;
  return properties && typeof properties === 'object'
    ? Object.keys(properties as Record<string, unknown>)
    : [];
};

const providerSchemaFieldType = (providerId: string, field: string) => {
  const capability = props.definition.verificationCapabilitySnapshot.find(
    (item) => item.providerId === providerId,
  );
  const properties = capability?.configSchema?.properties as
    | Record<string, { type?: string }>
    | undefined;
  return properties?.[field]?.type ?? 'string';
};

async function saveEdits() {
  saving.value = true;
  try {
    const draft: PlanDraft = {
      planId: props.definition.id,
      baseRevision: props.definition.revision,
      goal: editable.goal,
      requirements: lines(editable.requirementsText),
      design: editable.design,
      allowedPathPrefixes: lines(editable.allowedPathsText),
      steps: editable.steps.map((step) => ({
        id: step.id,
        title: step.title,
        detail: step.detail,
        kind: step.kind,
        dependsOn: [...step.dependsOn],
        skippable: step.skippable,
        allowedPathPrefixes: lines(step.allowedPathsText),
        acceptance: step.acceptance.map(parseCriterion),
      })),
      finalAcceptance: editable.finalAcceptance.map(parseCriterion),
      budgets: { ...editable.budgets },
      preserveStepIds: [...editable.preserveStepIds],
    };
    await agentStore.savePlanEdits(props.definition.id, draft);
    editing.value = false;
    ElMessage.success('已保存为新的计划版本，请重新批准');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}

async function restoreCurrentStep() {
  if (!props.run.currentStepId) return;
  try {
    const preview = await agentStore.previewPlanRestore(props.run.currentStepId);
    const impact = [
      ...preview.create.map((path) => `创建：${path}`),
      ...preview.overwrite.map((path) => `覆盖：${path}`),
      ...preview.delete.map((path) => `删除：${path}`),
      ...preview.move.map((item) => `移动：${item.from} → ${item.to}`),
    ];
    await ElMessageBox.confirm(
      `恢复将执行以下操作：\n${impact.length ? impact.join('\n') : '没有文件变化'}\n\n是否继续？`,
      '确认恢复步骤检查点',
      { confirmButtonText: '确认恢复', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  restoring.value = true;
  try {
    await agentStore.restorePlanStep(props.run.currentStepId);
    ElMessage.success('已恢复到步骤开始前的检查点');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    restoring.value = false;
  }
}

async function skipCurrentStep() {
  if (!props.run.currentStepId) return;
  try {
    await ElMessageBox.confirm(
      '当前工作区修改会保留，该步骤将标记为未验证并跳过，后续步骤可以继续。是否确认？',
      '保留修改并跳过',
      { confirmButtonText: '确认跳过', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  await agentStore.skipPlanStep(props.run.currentStepId);
  await agentStore.continuePlan();
}

async function deleteCheckpoint(stepId?: string) {
  const targetStepId = stepId ?? props.run.currentStepId;
  if (!targetStepId) return;
  const paths = props.run.stepStates[targetStepId]?.changedFiles ?? [];
  try {
    await ElMessageBox.confirm(
      `将删除此步骤的恢复数据，涉及范围：\n${paths.join('\n') || '检查点记录的路径'}\n删除后无法恢复到步骤开始前。`,
      '删除步骤检查点',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  await agentStore.deletePlanCheckpoint(targetStepId);
  checkpointUsage.value = await agentStore.getPlanCheckpointUsage();
}

async function archiveCurrentPlan() {
  try {
    await ElMessageBox.confirm(
      '归档只会从活动执行链移除该计划，不会删除 definition、commit、checkpoint 或旧数据。',
      '归档计划',
      { confirmButtonText: '确认归档', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  await agentStore.archivePlan();
}

async function submitInstruction() {
  if (!instruction.value.trim()) return;
  await agentStore.queuePlanInstruction(instruction.value);
  instruction.value = '';
  ElMessage.success('指令已排队，将在安全边界生效');
}
</script>

<template>
  <section class="plan-card">
    <header class="plan-header">
      <div class="plan-title">
        <strong>{{ definition.goal }}</strong>
        <ElTag size="small" :type="statusType">{{ statusLabel[run.status] }}</ElTag>
        <ElTag size="small" effect="plain">revision {{ definition.revision }}</ElTag>
      </div>
      <div v-if="isActive && !run.repositoryCorrupt" class="plan-actions">
        <ElButton v-if="canEdit && !editing" size="small" @click="editing = true">编辑</ElButton>
        <ElButton
          v-if="run.status === 'awaiting_approval'"
          size="small"
          type="primary"
          @click="agentStore.approvePlan()"
        >批准并执行</ElButton>
        <ElButton
          v-if="run.status === 'running'"
          size="small"
          @click="agentStore.pausePlan()"
        >暂停</ElButton>
        <ElButton
          v-if="['paused', 'waiting_for_user'].includes(run.status)"
          size="small"
          type="primary"
          @click="agentStore.continuePlan()"
        >继续</ElButton>
        <ElButton
          v-if="run.status === 'awaiting_acceptance'"
          size="small"
          type="success"
          @click="agentStore.acceptPlan(acceptanceNote)"
        >验收完成</ElButton>
        <ElButton
          v-if="!['completed', 'failed', 'cancelled'].includes(run.status)"
          size="small"
          type="danger"
          plain
          @click="agentStore.cancelPlan()"
        >取消</ElButton>
        <ElButton
          v-if="!run.archivedAt && run.status !== 'running' && run.status !== 'verifying'"
          size="small"
          plain
          @click="archiveCurrentPlan"
        >归档</ElButton>
      </div>
    </header>

    <template v-if="editing">
      <div class="editor-grid">
        <label>目标<ElInput v-model="editable.goal" /></label>
        <label>需求（每行一项）<ElInput v-model="editable.requirementsText" type="textarea" :rows="3" /></label>
        <label>设计改动<ElInput v-model="editable.design" type="textarea" :rows="4" /></label>
        <label>允许写入路径前缀（每行一项）<ElInput v-model="editable.allowedPathsText" type="textarea" :rows="3" /></label>
      </div>

      <div class="section-title">步骤与依赖</div>
      <label v-if="editable.preserveStepIds.length || definition.steps.some((step) => ['completed', 'skipped'].includes(run.stepStates[step.id]?.status))">
        显式保留未变化步骤的既有证据
        <ElSelect v-model="editable.preserveStepIds" multiple clearable>
          <ElOption
            v-for="step in definition.steps.filter((item) => ['completed', 'skipped'].includes(run.stepStates[item.id]?.status))"
            :key="step.id"
            :label="step.title"
            :value="step.id"
          />
        </ElSelect>
      </label>
      <div v-for="(step, index) in editable.steps" :key="step.id" class="step-editor">
        <div class="step-editor-head">
          <code>{{ step.id }}</code>
          <ElButton text type="danger" @click="editable.steps.splice(index, 1)">删除</ElButton>
        </div>
        <ElInput v-model="step.title" placeholder="步骤标题" />
        <ElInput v-model="step.detail" type="textarea" :rows="2" placeholder="具体改动" />
        <ElSelect v-model="step.kind">
          <ElOption label="研究（只读）" value="research" />
          <ElOption label="实现" value="implementation" />
          <ElOption label="验证" value="verification" />
        </ElSelect>
        <ElSelect v-model="step.dependsOn" multiple clearable placeholder="选择依赖步骤">
          <ElOption
            v-for="candidate in editable.steps.filter((item) => item.id !== step.id)"
            :key="candidate.id"
            :label="candidate.title || candidate.id"
            :value="candidate.id"
          />
        </ElSelect>
        <small v-if="step.dependsOn.length">
          依赖预览：{{ step.dependsOn.join(' + ') }} → {{ step.id }}
        </small>
        <label class="required-switch">
          允许跳过 <ElSwitch v-model="step.skippable" />
        </label>
        <ElInput v-model="step.allowedPathsText" type="textarea" :rows="2" placeholder="步骤路径前缀；留空继承计划范围" />
        <div v-for="(criterion, criterionIndex) in step.acceptance" :key="criterion.id ?? criterionIndex" class="criterion-editor">
          <ElInput v-model="criterion.description" placeholder="步骤验收描述" />
          <ElSelect v-model="criterion.providerId">
            <ElOption
              v-for="cap in definition.verificationCapabilitySnapshot"
              :key="cap.providerId"
              :label="`${cap.label}${cap.available ? '' : '（不可用）'}`"
              :value="cap.providerId"
            />
          </ElSelect>
          <label
            v-for="field in providerSchemaFields(criterion.providerId)"
            :key="field"
          >
            {{ field }}
            <ElSelect
              v-if="providerSchemaFieldType(criterion.providerId, field) === 'array'"
              :model-value="Array.isArray(criterion.config[field]) ? criterion.config[field] : []"
              multiple
              allow-create
              filterable
              @update:model-value="criterion.config[field] = $event"
            />
            <ElInput
              v-else
              :model-value="String(criterion.config[field] ?? '')"
              @update:model-value="criterion.config[field] = $event"
            />
          </label>
          <details>
            <summary>高级配置（未知字段）</summary>
            <ElInput v-model="criterion.configText" type="textarea" :rows="2" />
          </details>
          <label class="required-switch">必需验证 <ElSwitch v-model="criterion.required" /></label>
          <ElButton text type="danger" @click="step.acceptance.splice(criterionIndex, 1)">删除验收项</ElButton>
        </div>
        <ElButton text @click="addCriterion(step.acceptance)">+ 步骤验收项</ElButton>
      </div>
      <ElButton text @click="addStep">+ 添加步骤</ElButton>

      <div class="section-title">最终验收</div>
      <div v-for="(criterion, index) in editable.finalAcceptance" :key="criterion.id ?? index" class="criterion-editor">
        <ElInput v-model="criterion.description" placeholder="最终验收描述" />
        <ElSelect v-model="criterion.providerId">
          <ElOption
            v-for="cap in definition.verificationCapabilitySnapshot"
            :key="cap.providerId"
            :label="`${cap.label}${cap.available ? '' : '（不可用）'}`"
            :value="cap.providerId"
          />
        </ElSelect>
        <label
          v-for="field in providerSchemaFields(criterion.providerId)"
          :key="field"
        >
          {{ field }}
          <ElSelect
            v-if="providerSchemaFieldType(criterion.providerId, field) === 'array'"
            :model-value="Array.isArray(criterion.config[field]) ? criterion.config[field] : []"
            multiple
            allow-create
            filterable
            @update:model-value="criterion.config[field] = $event"
          />
          <ElInput
            v-else
            :model-value="String(criterion.config[field] ?? '')"
            @update:model-value="criterion.config[field] = $event"
          />
        </label>
        <details>
          <summary>高级配置（未知字段）</summary>
          <ElInput v-model="criterion.configText" type="textarea" :rows="2" />
        </details>
        <label class="required-switch">必需验证 <ElSwitch v-model="criterion.required" /></label>
        <ElButton text type="danger" @click="editable.finalAcceptance.splice(index, 1)">删除</ElButton>
      </div>
      <ElButton text @click="addCriterion(editable.finalAcceptance)">+ 最终验收项</ElButton>

      <div class="budget-grid">
        <label>最大轮次<ElInputNumber v-model="editable.budgets.maxTurns" :min="1" /></label>
        <label>最大修改文件<ElInputNumber v-model="editable.budgets.maxChangedFiles" :min="1" /></label>
        <label>最大外部调用<ElInputNumber v-model="editable.budgets.maxExternalCalls" :min="0" /></label>
        <label>步骤重试<ElInputNumber v-model="editable.budgets.maxStepRetries" :min="0" /></label>
      </div>
      <div class="editor-actions">
        <ElButton @click="resetEditor(); editing = false">取消编辑</ElButton>
        <ElButton type="primary" :loading="saving" @click="saveEdits">保存新版本</ElButton>
      </div>
    </template>

    <template v-else>
      <ElProgress :percentage="progress.percent" :stroke-width="8" />
      <div v-if="heldByAnotherPlan" class="pending-reason">
        当前工作区正由另一标签页或计划执行；本页只读，锁释放后会重新读取 head。
        <ElButton
          size="small"
          @click="workspaceWriteCoordinator.requestTakeover(definition.workspaceId, definition.id)"
        >请求接管</ElButton>
      </div>
      <div v-if="run.invalidatedStepIds?.length" class="pending-reason">
        新 revision 将使以下步骤证据失效：{{ run.invalidatedStepIds.join(', ') }}
      </div>
      <div v-if="run.revisionDiff" class="revision-diff">
        <strong>revision {{ run.revisionDiff.fromRevision }} → {{ run.revisionDiff.toRevision }}</strong>
        <small v-if="run.revisionDiff.addedPaths.length">路径增加：{{ run.revisionDiff.addedPaths.join(', ') }}</small>
        <small v-if="run.revisionDiff.removedPaths.length">路径移除：{{ run.revisionDiff.removedPaths.join(', ') }}</small>
        <small v-for="(change, key) in run.revisionDiff.budgetChanges" :key="key">
          预算 {{ key }}：{{ change?.before }} → {{ change?.after }}
        </small>
        <small v-for="change in run.revisionDiff.providerChanges" :key="change.providerId">
          {{ change.providerId }}：v{{ change.beforeVersion ?? '1' }}/{{ change.beforeAssurance ?? 'structural' }}
          → v{{ change.afterVersion ?? '1' }}/{{ change.afterAssurance ?? 'structural' }}
        </small>
      </div>
      <div v-if="run.pendingReason" class="pending-reason">{{ run.pendingReason }}</div>
      <ElInput
        v-if="isActive && run.status === 'awaiting_acceptance'"
        v-model="acceptanceNote"
        placeholder="验收备注（可选）"
      />
      <div v-if="currentStep" class="current-step">
        <span>当前步骤</span>
        <strong>{{ currentStep.title }}</strong>
        <small>{{ currentStep.detail }}</small>
      </div>
      <div v-if="isActive && !run.repositoryCorrupt && ['running', 'paused', 'waiting_for_user'].includes(run.status)" class="instruction-box">
        <ElInput v-model="instruction" placeholder="追加执行指令（在当前工具调用结束后生效）" />
        <ElButton :disabled="!instruction.trim()" @click="submitInstruction">追加</ElButton>
      </div>

      <ElCollapse>
        <ElCollapseItem title="计划详情" name="details">
          <div v-if="definition.requirements.length" class="section-title">需求</div>
          <ul v-if="definition.requirements.length">
            <li v-for="item in definition.requirements" :key="item">{{ item }}</li>
          </ul>
          <div v-if="definition.design" class="section-title">设计改动</div>
          <div v-if="definition.design" class="plan-design">{{ definition.design }}</div>
          <div class="section-title">允许路径</div>
          <div class="tag-list">
            <ElTag v-for="path in definition.allowedPathPrefixes" :key="path" effect="plain">{{ path }}</ElTag>
          </div>
          <div class="section-title">步骤</div>
          <div v-for="step in definition.steps" :key="step.id" class="step-row">
            <ElTag size="small" effect="plain">{{ run.stepStates[step.id]?.status ?? 'pending' }}</ElTag>
            <div>
              <strong>{{ step.title }}</strong>
              <small v-if="step.dependsOn.length">依赖：{{ step.dependsOn.join(', ') }}</small>
              <small>
                验证：{{ run.stepStates[step.id]?.verificationState ?? 'not_checked' }}
              </small>
              <div v-for="criterion in step.acceptance" :key="criterion.id" class="criterion-row">
                <span>{{ criterion.description }}</span>
                <ElTag size="small" :type="capabilityState(criterion.providerId).type">
                  {{ capabilityState(criterion.providerId).label }}
                </ElTag>
              </div>
              <small
                v-for="result in run.stepStates[step.id]?.checkResults ?? []"
                :key="result.id"
              >
                {{ result.status ?? (result.pass ? 'passed' : 'failed') }}：{{ result.description ?? result.id }}
              </small>
              <small
                v-for="evidence in run.stepStates[step.id]?.evidence ?? []"
                :key="evidence.id"
              >证据：{{ evidence.summary }}</small>
              <ElButton
                v-if="isActive && !run.repositoryCorrupt"
                size="small"
                text
                type="danger"
                @click="deleteCheckpoint(step.id)"
              >删除检查点</ElButton>
              <div
                v-for="(report, reportIndex) in run.stepStates[step.id]?.mutationReports ?? []"
                :key="`${step.id}-mutation-${reportIndex}`"
                class="mutation-report"
              >
                <small v-for="entry in report.created" :key="`created-${entry.path}`">
                  created {{ entry.path }} · after {{ entry.afterHash ?? 'n/a' }}
                </small>
                <small v-for="entry in report.modified" :key="`modified-${entry.path}`">
                  modified {{ entry.path }} · {{ entry.beforeHash ?? 'n/a' }} → {{ entry.afterHash ?? 'n/a' }}
                </small>
                <small v-for="entry in report.deleted" :key="`deleted-${entry.path}`">
                  deleted {{ entry.path }} · before {{ entry.beforeHash ?? 'n/a' }}
                </small>
                <small v-for="entry in report.moved" :key="`moved-${entry.from.path}-${entry.to.path}`">
                  moved {{ entry.from.path }} → {{ entry.to.path }} · {{ entry.to.afterHash ?? 'n/a' }}
                </small>
              </div>
            </div>
          </div>
          <div class="section-title">实际修改文件</div>
          <div v-if="run.changedFiles.length" class="file-list">
            <code v-for="path in run.changedFiles" :key="path">{{ path }}</code>
          </div>
          <small v-else>尚无经过范围闸门登记的修改。</small>
          <div class="section-title">剩余预算</div>
          <div class="budget-summary">
            <span>轮次 {{ Math.max(0, definition.budgets.maxTurns - run.counters.turns) }}</span>
            <span>文件 {{ Math.max(0, definition.budgets.maxChangedFiles - run.counters.changedFiles) }}</span>
            <span>外部调用 {{ Math.max(0, definition.budgets.maxExternalCalls - run.counters.externalCalls) }}</span>
          </div>
          <div class="section-title">恢复数据</div>
          <small v-if="checkpointUsage">
            {{ checkpointUsage.entries.length }} 个对象，{{ checkpointUsage.totalBytes }} bytes；
            损坏/缺失 {{ checkpointUsage.entries.filter((item) => item.integrity !== 'ok').length }} 个
          </small>
          <div class="section-title">验收能力</div>
          <div v-for="criterion in allAcceptanceCriteria" :key="criterion.id" class="criterion-row">
            <span>{{ criterion.description }}</span>
            <ElTag size="small" :type="capabilityState(criterion.providerId).type">
              {{ capabilityState(criterion.providerId).label }}
            </ElTag>
            <ElTag v-if="run.acceptanceRecords?.[criterion.id]" size="small" type="success">
              已由 {{ run.acceptanceRecords[criterion.id]?.acceptedBy }} 验收
            </ElTag>
            <ElButton
              v-else-if="isActive && !run.repositoryCorrupt && run.status === 'awaiting_acceptance' && criterion.providerId === 'user.acceptance'"
              size="small"
              @click="agentStore.acceptPlanCriteria([criterion.id], acceptanceNote)"
            >接受此项</ElButton>
          </div>
          <div v-if="run.finalVerification" class="verification-summary">
            <strong>最终验证：{{ run.finalVerification.verdict }}</strong>
            <span v-for="item in run.finalVerification.uncovered" :key="item">{{ item }}</span>
          </div>
          <div class="section-title">事件时间线</div>
          <div class="event-timeline">
            <small v-for="(event, index) in [...(run.recentEvents ?? [])].reverse()" :key="`${event.at}-${index}`">
              {{ new Date(event.at).toLocaleString() }} · {{ event.type }}
              <template v-if="event.stepId"> · {{ event.stepId }}</template>
            </small>
          </div>
        </ElCollapseItem>
      </ElCollapse>

      <div v-if="isActive && !run.repositoryCorrupt && run.currentStepId && ['paused', 'waiting_for_user'].includes(run.status)" class="recovery-actions">
        <ElButton v-if="currentStep?.skippable" size="small" @click="skipCurrentStep">
          保留修改并跳过
        </ElButton>
        <ElButton size="small" :loading="restoring" @click="restoreCurrentStep">
          恢复到当前步骤开始前
        </ElButton>
        <ElButton size="small" type="danger" plain @click="deleteCheckpoint()">
          删除此步骤恢复数据
        </ElButton>
      </div>
    </template>
  </section>
</template>

<style scoped>
.plan-card { border: 1px solid var(--el-border-color); border-radius: 12px; padding: 14px; background: var(--el-bg-color); }
.plan-header, .plan-title, .plan-actions, .step-editor-head, .editor-actions { display: flex; align-items: center; gap: 8px; }
.plan-header { justify-content: space-between; flex-wrap: wrap; }
.plan-title { min-width: 0; flex-wrap: wrap; }
.plan-title strong { overflow-wrap: anywhere; }
.plan-actions { flex-wrap: wrap; }
.editor-grid, .step-editor, .criterion-editor { display: grid; gap: 10px; margin-top: 12px; }
.editor-grid label, .budget-grid label { display: grid; gap: 5px; color: var(--el-text-color-secondary); font-size: 12px; }
.section-title { margin-top: 14px; margin-bottom: 8px; font-weight: 600; }
.step-editor { padding: 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.step-editor-head { justify-content: space-between; }
.step-editor-head code { overflow-wrap: anywhere; }
.criterion-editor { padding: 8px; border-left: 3px solid var(--el-border-color); }
.required-switch { display: flex; align-items: center; gap: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
.budget-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
.editor-actions { justify-content: flex-end; margin-top: 14px; }
.pending-reason { margin: 10px 0; padding: 8px 10px; border-radius: 8px; background: var(--el-color-warning-light-9); color: var(--el-color-warning-dark-2); }
.revision-diff { display: grid; gap: 4px; margin: 10px 0; padding: 8px 10px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.current-step { display: grid; gap: 3px; margin: 10px 0; }
.current-step span, .current-step small, .step-row small { color: var(--el-text-color-secondary); }
.tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
.step-row, .criterion-row { display: flex; align-items: flex-start; gap: 8px; margin: 8px 0; }
.step-row > div { display: grid; gap: 2px; }
.criterion-row { justify-content: space-between; }
.verification-summary { display: grid; gap: 4px; margin-top: 12px; }
.mutation-report { display: grid; gap: 2px; padding: 6px; background: var(--el-fill-color-light); border-radius: 6px; }
.event-timeline { display: grid; gap: 4px; max-height: 180px; overflow: auto; }
.file-list { display: grid; gap: 4px; }
.file-list code { overflow-wrap: anywhere; }
.budget-summary { display: flex; flex-wrap: wrap; gap: 12px; color: var(--el-text-color-secondary); }
.plan-design { white-space: pre-wrap; color: var(--el-text-color-secondary); }
.recovery-actions { margin-top: 10px; }
.instruction-box { display: flex; gap: 8px; margin: 10px 0; }
@media (max-width: 640px) {
  .budget-grid { grid-template-columns: 1fr; }
  .plan-actions { width: 100%; }
}
</style>
