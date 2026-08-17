<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ElCheckbox } from 'element-plus';
import { NText } from '@/ui/element-plus-primitives';
import {
  diffRegions,
  wordDiff,
  shouldInlineHighlight,
  type DiffOperation,
} from '../../domains/coding/ast/diff';

const { t } = useI18n();
const props = defineProps<{
  before?: string;
  after?: string;
  /** Worker 预计算的 unified diff；优先于 before/after 现场计算 */
  diff?: string;
  created?: boolean;
  selectable?: boolean;
}>();
const emit = defineEmits<{
  selectionChange: [regionIds: number[]];
}>();

type Seg = { type: ' ' | '+' | '-'; text: string };
type Row = {
  kind: 'ctx' | 'add' | 'del';
  oldNo: number | null;
  newNo: number | null;
  segs: Seg[] | null;
  text: string;
};
type RegionModel = { id: number; header: string; rows: Row[] };
type Fold = { key: string; count: number; oldStart: number; newStart: number };
type Block =
  | { type: 'region'; region: RegionModel }
  | { type: 'fold'; fold: Fold };

const HEADER_RE = /@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/;

function parseHeader(header: string) {
  const m = HEADER_RE.exec(header);
  if (!m) return { oldStart: 1, oldCount: 0, newStart: 1, newCount: 0 };
  return {
    oldStart: Number(m[1]),
    oldCount: m[2] === '' ? 1 : Number(m[2]),
    newStart: Number(m[3]),
    newCount: m[4] === '' ? 1 : Number(m[4]),
  };
}

/** 把一段操作序列转成带行号与行内高亮的渲染行；del/add 相邻成对时做词级高亮。 */
function buildRows(
  ops: DiffOperation[],
  oldStart: number,
  newStart: number,
): Row[] {
  const rows: Row[] = [];
  let oldNo = oldStart;
  let newNo = newStart;
  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op.type === ' ') {
      rows.push({ kind: 'ctx', oldNo, newNo, segs: null, text: op.line });
      oldNo++;
      newNo++;
      i++;
      continue;
    }
    // 收集连续删除行 + 紧随的连续新增行，视为替换块
    const dels: DiffOperation[] = [];
    while (i < ops.length && ops[i].type === '-') dels.push(ops[i++]);
    const adds: DiffOperation[] = [];
    while (i < ops.length && ops[i].type === '+') adds.push(ops[i++]);
    const pairCount = Math.min(dels.length, adds.length);
    for (let k = 0; k < dels.length; k++) {
      const partner = k < pairCount ? adds[k] : null;
      let segs: Seg[] | null = null;
      if (partner) {
        const wd = wordDiff(dels[k].line, partner.line);
        if (shouldInlineHighlight(wd, dels[k].line, partner.line)) {
          segs = wd.filter((s) => s.type !== '+');
        }
      }
      rows.push({ kind: 'del', oldNo, newNo: null, segs, text: dels[k].line });
      oldNo++;
    }
    for (let k = 0; k < adds.length; k++) {
      const partner = k < pairCount ? dels[k] : null;
      let segs: Seg[] | null = null;
      if (partner) {
        const wd = wordDiff(partner.line, adds[k].line);
        if (shouldInlineHighlight(wd, partner.line, adds[k].line)) {
          segs = wd.filter((s) => s.type !== '-');
        }
      }
      rows.push({ kind: 'add', oldNo: null, newNo, segs, text: adds[k].line });
      newNo++;
    }
  }
  return rows;
}

/** 解析预计算的 unified diff 文本为区域（无 before/after，不可展开上下文）。 */
function parseUnified(text: string): RegionModel[] {
  const hunks: Array<{ header: string; ops: DiffOperation[] }> = [];
  for (const raw of text.split('\n')) {
    if (raw.startsWith('@@')) {
      hunks.push({ header: raw, ops: [] });
      continue;
    }
    if (!hunks.length) hunks.push({ header: '', ops: [] });
    const current = hunks[hunks.length - 1];
    if (raw.startsWith('+')) current.ops.push({ type: '+', line: raw.slice(1) });
    else if (raw.startsWith('-')) current.ops.push({ type: '-', line: raw.slice(1) });
    else current.ops.push({ type: ' ', line: raw.slice(1) });
  }
  return hunks.map((hunk, id) => {
    const { oldStart, newStart } = parseHeader(hunk.header);
    return { id, header: hunk.header, rows: buildRows(hunk.ops, oldStart, newStart) };
  });
}

/** 变更源数据是否来自 before/after（可展开隐藏上下文）。 */
const hasSnapshot = computed(
  () => props.before !== undefined && props.after !== undefined,
);
const afterLines = computed(() =>
  props.after !== undefined ? props.after.split('\n') : null,
);

const regionsModel = computed<RegionModel[]>(() => {
  if (props.created) {
    const content = props.after ?? '';
    const contentLines = content.split('\n');
    return [
      {
        id: 0,
        header: `@@ -0,0 +1,${contentLines.length} @@`,
        rows: contentLines.map((line, idx) => ({
          kind: 'add' as const,
          oldNo: null,
          newNo: idx + 1,
          segs: null,
          text: line,
        })),
      },
    ];
  }
  // 优先使用 Worker 预计算的 diff，避免大文件在主线程重算 LCS
  if (props.diff !== undefined && props.diff !== '') {
    return parseUnified(props.diff);
  }
  if (hasSnapshot.value) {
    if (props.before === props.after) return [];
    const regions = diffRegions(props.before as string, props.after as string);
    return regions.map((region) => {
      const { oldStart, newStart } = parseHeader(region.header);
      return {
        id: region.id,
        header: region.header,
        rows: buildRows(region.lines, oldStart, newStart),
      };
    });
  }
  return [];
});

/** 只有直接基于 before/after 现算时才能展开隐藏上下文。 */
const canFold = computed(
  () => !props.created && props.diff === undefined && !!afterLines.value,
);

/** region 之间、首尾的隐藏未变行，仅在可展开时生成折叠条。 */
const blocks = computed<Block[]>(() => {
  const regions = regionsModel.value;
  if (!canFold.value || !afterLines.value) {
    return regions.map((region) => ({ type: 'region' as const, region }));
  }
  const totalNew = afterLines.value.length;
  const out: Block[] = [];
  let prevEndOld = 0;
  let prevEndNew = 0;
  regions.forEach((region, index) => {
    const { oldStart, oldCount, newStart, newCount } = parseHeader(region.header);
    const gap = newStart - (prevEndNew + 1);
    if (gap > 0) {
      out.push({
        type: 'fold',
        fold: {
          key: `fold-${index}`,
          count: gap,
          oldStart: prevEndOld + 1,
          newStart: prevEndNew + 1,
        },
      });
    }
    out.push({ type: 'region', region });
    prevEndOld = oldStart + oldCount - 1;
    prevEndNew = newStart + newCount - 1;
  });
  const tail = totalNew - prevEndNew;
  if (tail > 0) {
    out.push({
      type: 'fold',
      fold: {
        key: 'fold-tail',
        count: tail,
        oldStart: prevEndOld + 1,
        newStart: prevEndNew + 1,
      },
    });
  }
  return out;
});

const expandedFolds = ref<Set<string>>(new Set());
function toggleFold(key: string) {
  const next = new Set(expandedFolds.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedFolds.value = next;
}
function foldRows(fold: Fold): Row[] {
  const lines = afterLines.value;
  if (!lines) return [];
  const rows: Row[] = [];
  for (let k = 0; k < fold.count; k++) {
    const newNo = fold.newStart + k;
    rows.push({
      kind: 'ctx',
      oldNo: fold.oldStart + k,
      newNo,
      segs: null,
      text: lines[newNo - 1] ?? '',
    });
  }
  return rows;
}

const selectedRegionIds = ref<number[]>([]);
watch(
  () => [props.before, props.after, props.diff, props.created],
  () => {
    selectedRegionIds.value = [];
    expandedFolds.value = new Set();
    emit('selectionChange', []);
  },
);
function setRegionSelected(regionId: number, selected: boolean) {
  selectedRegionIds.value = selected
    ? [...selectedRegionIds.value, regionId]
    : selectedRegionIds.value.filter((id) => id !== regionId);
  emit('selectionChange', selectedRegionIds.value);
}

const stats = computed(() => {
  let add = 0;
  let del = 0;
  for (const region of regionsModel.value) {
    for (const row of region.rows) {
      if (row.kind === 'add') add++;
      else if (row.kind === 'del') del++;
    }
  }
  return { add, del };
});
const summary = computed(() => {
  if (props.created) return t('staged.created');
  if (!regionsModel.value.length) return t('staged.noContentChange');
  return `+${stats.value.add} \u2212${stats.value.del}`;
});
const isEmpty = computed(() => !props.created && !regionsModel.value.length);
</script>

<template>
  <div class="file-write-diff" :data-created="created ? 'true' : 'false'">
    <div class="file-write-diff-header">
      <NText depth="3" class="file-write-diff-title">
        {{ t(created ? 'staged.newFileContent' : 'staged.changePreview') }}
      </NText>
      <NText depth="3" class="file-write-diff-summary">{{ summary }}</NText>
    </div>

    <NText v-if="isEmpty" depth="3" class="file-write-diff-empty">
      {{ t('staged.noContentChange') }}
    </NText>

    <!-- 可勾选区域审批：每个区域一张卡片 -->
    <div v-else-if="selectable" class="file-write-diff-regions">
      <template v-for="block in blocks" :key="block.type === 'fold' ? block.fold.key : `r-${block.region.id}`">
        <button
          v-if="block.type === 'fold'"
          type="button"
          class="file-write-diff-fold"
          @click="toggleFold(block.fold.key)"
        >
          {{
            expandedFolds.has(block.fold.key)
              ? t('staged.collapseContext')
              : t('staged.expandContext', { n: block.fold.count })
          }}
        </button>
        <pre
          v-if="block.type === 'fold' && expandedFolds.has(block.fold.key)"
          class="file-write-diff-body"
        ><code
          v-for="(row, i) in foldRows(block.fold)"
          :key="i"
          class="file-write-diff-line file-write-diff-line-ctx"
        ><span class="file-write-diff-gutter">{{ row.oldNo }}</span><span
          class="file-write-diff-gutter"
        >{{ row.newNo }}</span><span class="file-write-diff-marker"> </span><span
          class="file-write-diff-text"
        >{{ row.text }}</span></code></pre>
        <section
          v-else-if="block.type === 'region'"
          class="file-write-diff-region"
        >
          <div class="file-write-diff-region-header">
            <ElCheckbox
              :model-value="selectedRegionIds.includes(block.region.id)"
              @change="(value) => setRegionSelected(block.region.id, Boolean(value))"
            >
              {{ t('staged.region', { n: block.region.id + 1 }) }}
            </ElCheckbox>
            <span>{{ block.region.header }}</span>
          </div>
          <pre class="file-write-diff-body"><code
            v-for="(row, i) in block.region.rows"
            :key="i"
            :class="`file-write-diff-line file-write-diff-line-${row.kind}`"
          ><span class="file-write-diff-gutter">{{ row.kind === 'add' ? '' : row.oldNo }}</span><span
            class="file-write-diff-gutter"
          >{{ row.kind === 'del' ? '' : row.newNo }}</span><span
            class="file-write-diff-marker"
          >{{ row.kind === 'add' ? '+' : row.kind === 'del' ? '\u2212' : ' ' }}</span><span
            class="file-write-diff-text"
          ><template v-if="row.segs"><span
            v-for="(seg, si) in row.segs"
            :key="si"
            :class="seg.type === '+' ? 'file-write-diff-seg-add' : seg.type === '-' ? 'file-write-diff-seg-del' : ''"
          >{{ seg.text }}</span></template><template v-else>{{ row.text }}</template></span></code></pre>
        </section>
      </template>
    </div>

    <!-- 只读预览：单一连续视图 -->
    <div v-else class="file-write-diff-flat">
      <template v-for="block in blocks" :key="block.type === 'fold' ? block.fold.key : `r-${block.region.id}`">
        <button
          v-if="block.type === 'fold'"
          type="button"
          class="file-write-diff-fold"
          @click="toggleFold(block.fold.key)"
        >
          {{
            expandedFolds.has(block.fold.key)
              ? t('staged.collapseContext')
              : t('staged.expandContext', { n: block.fold.count })
          }}
        </button>
        <pre
          v-if="block.type === 'fold' && expandedFolds.has(block.fold.key)"
          class="file-write-diff-body"
        ><code
          v-for="(row, i) in foldRows(block.fold)"
          :key="i"
          class="file-write-diff-line file-write-diff-line-ctx"
        ><span class="file-write-diff-gutter">{{ row.oldNo }}</span><span
          class="file-write-diff-gutter"
        >{{ row.newNo }}</span><span class="file-write-diff-marker"> </span><span
          class="file-write-diff-text"
        >{{ row.text }}</span></code></pre>
        <pre
          v-else-if="block.type === 'region'"
          class="file-write-diff-body"
        ><code
          v-for="(row, i) in block.region.rows"
          :key="i"
          :class="`file-write-diff-line file-write-diff-line-${row.kind}`"
        ><span class="file-write-diff-gutter">{{ row.kind === 'add' ? '' : row.oldNo }}</span><span
          class="file-write-diff-gutter"
        >{{ row.kind === 'del' ? '' : row.newNo }}</span><span
          class="file-write-diff-marker"
        >{{ row.kind === 'add' ? '+' : row.kind === 'del' ? '\u2212' : ' ' }}</span><span
          class="file-write-diff-text"
        ><template v-if="row.segs"><span
          v-for="(seg, si) in row.segs"
          :key="si"
          :class="seg.type === '+' ? 'file-write-diff-seg-add' : seg.type === '-' ? 'file-write-diff-seg-del' : ''"
        >{{ seg.text }}</span></template><template v-else>{{ row.text }}</template></span></code></pre>
      </template>
    </div>
  </div>
</template>

<style scoped>
.file-write-diff-regions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.file-write-diff-region {
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.file-write-diff-region-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 10px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}
.file-write-diff-empty {
  display: block;
  padding: 6px 0;
  font-size: 12px;
}
</style>
