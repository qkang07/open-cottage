<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElButton, ElTag, ElInput } from 'element-plus';
import { NText, NSpace } from '@/ui/element-plus-primitives';
import {
  approvePendingStagedEntry,
  discardPendingStagedEntry,
  getPendingStagedApproval,
  pendingStagedApprovalRevision,
  resolvePendingStagedApproval,
  updatePendingStagedAfter,
} from '../../platform/staging';
import type { StagedEntry } from '../../platform/staging';
import { applySelectedDiffRegions, diffRegions } from '../../domains/coding/ast/diff';
import FileWriteDiff from './FileWriteDiff.vue';

const { t } = useI18n();

const props = defineProps<{
  /** 显式绑定待审批项所属的会话（当前展示的 Agent）；缺省回退到当前活跃交互会话 */
  sessionId?: string | null;
}>();

// 订阅 pending 状态变化（审批发起 / 单文件改/弃 / 批准/丢弃后都会 bump）
void pendingStagedApprovalRevision;

const pending = computed(() => {
  void pendingStagedApprovalRevision.value;
  return getPendingStagedApproval(props.sessionId);
});
const entries = computed<StagedEntry[]>(() => {
  void pendingStagedApprovalRevision.value;
  return pending.value?.store.pendingEntriesList() ?? [];
});
const fileCount = computed(() => entries.value.length);
const allCreated = computed(
  () =>
    fileCount.value > 0 &&
    entries.value.every((entry) => entry.created && !entry.deleted),
);

/** 单文件 +新增 / −删除 行数统计 */
function entryStats(entry: StagedEntry): { add: number; del: number } {
  if (entry.deleted) {
    return { add: 0, del: entry.before ? entry.before.split('\n').length : 0 };
  }
  if (entry.created) {
    return { add: entry.after ? entry.after.split('\n').length : 0, del: 0 };
  }
  if (entry.before === entry.after) return { add: 0, del: 0 };
  let add = 0;
  let del = 0;
  for (const region of diffRegions(entry.before, entry.after)) {
    for (const line of region.lines) {
      if (line.type === '+') add++;
      else if (line.type === '-') del++;
    }
  }
  return { add, del };
}
const totalStats = computed(() => {
  let add = 0;
  let del = 0;
  for (const entry of entries.value) {
    const s = entryStats(entry);
    add += s.add;
    del += s.del;
  }
  return { add, del };
});

/** 折叠起来的文件路径（默认全部展开） */
const collapsedPaths = ref<Set<string>>(new Set());
function toggleCollapse(path: string) {
  const next = new Set(collapsedPaths.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  collapsedPaths.value = next;
}

/** 正在就地编辑的文件路径 -> 编辑文本 */
const editingPath = ref<string | null>(null);
const editingText = ref('');
const selectedRegions = ref(new Map<string, number[]>());

function startEdit(entry: StagedEntry) {
  editingPath.value = entry.path;
  editingText.value = entry.after;
}
function commitEdit(path: string) {
  updatePendingStagedAfter(path, editingText.value, props.sessionId);
  editingPath.value = null;
  editingText.value = '';
}
function cancelEdit() {
  editingPath.value = null;
  editingText.value = '';
}
function discard(path: string) {
  if (editingPath.value === path) cancelEdit();
  discardPendingStagedEntry(path, props.sessionId);
}
function updateSelectedRegions(path: string, regionIds: number[]) {
  const next = new Map(selectedRegions.value);
  next.set(path, regionIds);
  selectedRegions.value = next;
}
function approveFile(entry: StagedEntry) {
  if (editingPath.value === entry.path) commitEdit(entry.path);
  approvePendingStagedEntry(entry.path, undefined, props.sessionId);
}
function approveSelectedRegions(entry: StagedEntry) {
  const selected = selectedRegions.value.get(entry.path) ?? [];
  if (!selected.length) return;
  const approvedAfter = entry.created
    ? entry.after
    : applySelectedDiffRegions(entry.before, entry.after, new Set(selected));
  approvePendingStagedEntry(entry.path, approvedAfter, props.sessionId);
}
function approveAll() {
  if (editingPath.value) commitEdit(editingPath.value);
  resolvePendingStagedApproval('approved', props.sessionId);
}
function discardAll() {
  for (const entry of [...entries.value]) {
    discardPendingStagedEntry(entry.path, props.sessionId);
  }
}

// pending 消失时重置编辑态
watch(
  () => pending.value,
  (p) => {
    if (!p) cancelEdit();
  },
);
</script>

<template>
  <div v-if="pending && fileCount > 0" class="staged-panel staged-panel-preview">
    <div class="staged-panel-header">
      <div class="staged-panel-heading">
        <NText strong class="staged-panel-title">
          {{ t(allCreated ? 'staged.createTitle' : 'staged.title') }}
        </NText>
        <NText depth="3" class="staged-panel-hint">
          {{ t(allCreated ? 'staged.createHint' : 'staged.hint', { n: fileCount }) }}
        </NText>
      </div>
      <div class="staged-panel-overview">
        <NText depth="2" class="staged-panel-overview-stat">
          {{ t('staged.fileSummary', { n: fileCount }) }}
          <span class="staged-stat-add">+{{ totalStats.add }}</span>
          <span class="staged-stat-del">−{{ totalStats.del }}</span>
        </NText>
        <NSpace :size="8">
          <ElButton type="primary" size="small" @click="approveAll">
            {{ t(allCreated ? 'staged.approveCreateAll' : 'staged.approveMerge') }}
          </ElButton>
          <ElButton size="small" @click="discardAll">{{ t('staged.discardAll') }}</ElButton>
        </NSpace>
      </div>
    </div>

    <div
      v-for="entry in entries"
      :key="entry.path"
      class="staged-entry"
    >
      <div class="staged-entry-header">
        <button
          type="button"
          class="staged-entry-toggle"
          @click="toggleCollapse(entry.path)"
        >
          <span class="staged-entry-caret" :data-collapsed="collapsedPaths.has(entry.path)">›</span>
          <NText depth="2" class="staged-entry-path">{{ entry.path }}</NText>
          <NText depth="3" class="staged-entry-stat">
            <span class="staged-stat-add">+{{ entryStats(entry).add }}</span>
            <span class="staged-stat-del">−{{ entryStats(entry).del }}</span>
          </NText>
        </button>
        <NSpace wrap :size="6">
          <ElTag v-if="entry.deleted" type="danger" size="small">{{ t('staged.willDelete') }}</ElTag>
          <ElTag v-else-if="entry.created" type="success" size="small">{{ t('staged.created') }}</ElTag>
          <ElTag v-else type="warning" size="small">{{ t('staged.modified') }}</ElTag>
          <ElButton
            v-if="!entry.deleted && editingPath !== entry.path"
            size="small"
            @click="startEdit(entry)"
          >
            {{ t('common.edit') }}
          </ElButton>
          <ElButton
            v-if="!entry.deleted && editingPath === entry.path"
            type="primary"
            size="small"
            @click="commitEdit(entry.path)"
          >
            {{ t('staged.saveEdit') }}
          </ElButton>
          <ElButton
            v-if="editingPath === entry.path"
            size="small"
            @click="cancelEdit"
          >
            {{ t('staged.cancelEdit') }}
          </ElButton>
          <ElButton size="small" type="primary" plain @click="approveFile(entry)">
            {{ t(entry.created ? 'staged.approveCreateFile' : 'staged.approveFile') }}
          </ElButton>
          <ElButton size="small" type="danger" plain @click="discard(entry.path)">
            {{ t('staged.discard') }}
          </ElButton>
        </NSpace>
      </div>

      <div v-show="!collapsedPaths.has(entry.path)" class="staged-entry-body">
        <div v-if="entry.deleted" class="staged-entry-deleted">
          <NText depth="3">{{ t('staged.deleteOnMerge') }}</NText>
        </div>
        <div v-else-if="editingPath === entry.path" class="staged-entry-edit">
          <ElInput
            v-model="editingText"
            type="textarea"
            :autosize="{ minRows: 6, maxRows: 24 }"
            monospace
          />
        </div>
        <FileWriteDiff
          v-else
          :before="entry.before"
          :after="entry.after"
          :created="entry.created"
          :selectable="!entry.created"
          @selection-change="(ids) => updateSelectedRegions(entry.path, ids)"
        />
        <div
          v-if="!entry.created && !entry.deleted && editingPath !== entry.path"
          class="staged-entry-region-actions"
        >
          <NText depth="3" class="staged-region-hint">
            {{ t('staged.regionHint') }}
          </NText>
          <ElButton
            size="small"
            :disabled="!(selectedRegions.get(entry.path)?.length)"
            @click="approveSelectedRegions(entry)"
          >
            {{ t('staged.approveSelectedRegions') }}
          </ElButton>
        </div>
      </div>
    </div>

    <div class="staged-panel-footer">
      <NSpace :size="10">
        <ElButton type="primary" @click="approveAll">
          {{ t(allCreated ? 'staged.approveCreateAll' : 'staged.approveMerge') }}
        </ElButton>
        <ElButton @click="discardAll">{{ t('staged.discardAll') }}</ElButton>
      </NSpace>
    </div>
  </div>
</template>

<style scoped>
.staged-panel {
  flex: 1;
  height: 100%;
  min-height: 0;
  padding: 20px 24px;
  overflow: auto;
  background: var(--el-fill-color-light);
}
.staged-panel-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.staged-panel-overview {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.staged-panel-overview-stat {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.staged-stat-add {
  margin-left: 6px;
  color: var(--cottage-success);
}
.staged-stat-del {
  margin-left: 6px;
  color: var(--cottage-danger);
}
.staged-panel-title {
  font-size: 18px;
}
.staged-panel-hint {
  display: block;
  margin-top: 4px;
  font-size: 12px;
}
.staged-entry {
  margin-bottom: 16px;
  padding: 12px;
  border-radius: 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
}
.staged-entry-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.staged-entry-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 2px 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.staged-entry-caret {
  flex: none;
  color: var(--el-text-color-secondary);
  transition: transform 0.15s ease;
  transform: rotate(90deg);
}
.staged-entry-caret[data-collapsed='true'] {
  transform: rotate(0deg);
}
.staged-entry-stat {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.staged-entry-path {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 13px;
  word-break: break-all;
}
.staged-entry-deleted {
  padding: 4px 0;
}
.staged-entry-edit {
  margin-top: 4px;
}
.staged-entry-region-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 10px;
}
.staged-region-hint {
  font-size: 12px;
}
.staged-panel-footer {
  position: sticky;
  bottom: -20px;
  margin: 16px -24px -20px;
  padding: 12px 24px;
  border-top: 1px solid var(--el-border-color);
  background: var(--el-bg-color);
}
</style>
