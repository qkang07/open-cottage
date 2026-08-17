<script setup lang="ts">

import CottageTooltip from '@/ui/CottageTooltip.vue';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { SpreadsheetAnchor } from '../../chat/fileReferences';
import {
  spreadsheetAnchorFromCells,
  type CellCoord,
} from '../../chat/previewSelection';
type CellValue = string | number | boolean | null;
const ROW_HEIGHT = 28;
const OVERSCAN = 6;
const props = defineProps<{
  sheetName: string;
  rows: CellValue[][];
  onRangeSelect?: (anchor: SpreadsheetAnchor | null) => void;
}>();
const scrollRef = ref<HTMLDivElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(320);
const anchorCell = ref<CellCoord | null>(null);
const focusCell = ref<CellCoord | null>(null);
const dragging = ref(false);
const colCount = computed(() =>
  props.rows.reduce((max, row) => Math.max(max, row.length), 0),
);
const formatCell = (value: CellValue | undefined) =>
  value === null || value === undefined ? '' : String(value);
const isSelectedCell = (
  row: number,
  col: number,
  anchor: CellCoord | null,
  focus: CellCoord | null,
): boolean => {
  if (!anchor || !focus) return false;
  const r1 = Math.min(anchor.row, focus.row);
  const r2 = Math.max(anchor.row, focus.row);
  const c1 = Math.min(anchor.col, focus.col);
  const c2 = Math.max(anchor.col, focus.col);
  return row >= r1 && row <= r2 && col >= c1 && col <= c2;
};
const emitRange = (anchor: CellCoord | null, focus: CellCoord | null) => {
  if (!props.onRangeSelect) return;
  if (!anchor || !focus) {
    props.onRangeSelect(null);
    return;
  }
  props.onRangeSelect(
    spreadsheetAnchorFromCells(props.sheetName, anchor, focus),
  );
};
const stopDrag = () => {
  dragging.value = false;
};
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  window.addEventListener('mouseup', stopDrag);
  const el = scrollRef.value;
  if (!el) return;
  const sync = () => {
    viewportHeight.value = el.clientHeight;
  };
  sync();
  resizeObserver = new ResizeObserver(sync);
  resizeObserver.observe(el);
});
onUnmounted(() => {
  window.removeEventListener('mouseup', stopDrag);
  resizeObserver?.disconnect();
});
const handleCellDown = (row: number, col: number, extend: boolean) => {
  const coord = { row, col };
  if (extend && anchorCell.value) {
    focusCell.value = coord;
    emitRange(anchorCell.value, coord);
  } else {
    anchorCell.value = coord;
    focusCell.value = coord;
    emitRange(coord, coord);
    dragging.value = true;
  }
};
const handleCellEnter = (row: number, col: number) => {
  if (!dragging.value || !anchorCell.value) return;
  const coord = { row, col };
  focusCell.value = coord;
  emitRange(anchorCell.value, coord);
};
const virtualWindow = computed(() => {
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN,
  );
  const visibleCount =
    Math.ceil(viewportHeight.value / ROW_HEIGHT) + OVERSCAN * 2;
  const endIndex = Math.min(props.rows.length, startIndex + visibleCount);
  return {
    start: startIndex,
    end: endIndex,
    paddingTop: startIndex * ROW_HEIGHT,
    paddingBottom: Math.max(0, (props.rows.length - endIndex) * ROW_HEIGHT),
    visibleRows: props.rows.slice(startIndex, endIndex),
  };
});
const onScroll = (event: Event) => {
  const target = event.currentTarget;
  if (target instanceof HTMLElement) {
    scrollTop.value = target.scrollTop;
  }
};
</script>
<template>
  <div v-if="!colCount" class="virtual-table-empty">无数据</div>
  <div
    v-else
    ref="scrollRef"
    class="virtual-table-scroll"
    @scroll="onScroll"
  >
    <table class="virtual-table">
      <thead>
        <tr>
          <th class="virtual-table-corner">#</th>
          <th v-for="colIndex in colCount" :key="colIndex">{{ colIndex }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-if="virtualWindow.paddingTop > 0"
          class="virtual-table-spacer"
          aria-hidden="true"
        >
          <td
            :colspan="colCount + 1"
            :style="{ height: `${virtualWindow.paddingTop}px` }"
          />
        </tr>
        <tr
          v-for="(row, offset) in virtualWindow.visibleRows"
          :key="virtualWindow.start + offset"
          :style="{ height: `${ROW_HEIGHT}px` }"
        >
          <td class="virtual-table-row-num">
            {{ virtualWindow.start + offset + 1 }}
          </td>
          <td
            v-for="colIndex in colCount"
            :key="colIndex"
            :class="
              isSelectedCell(
                virtualWindow.start + offset + 1,
                colIndex,
                anchorCell,
                focusCell,
              )
                ? 'virtual-table-cell-selected'
                : undefined
            "
            @mousedown.prevent="
              handleCellDown(
                virtualWindow.start + offset + 1,
                colIndex,
                $event.shiftKey,
              )
            "
            @mouseenter="
              handleCellEnter(virtualWindow.start + offset + 1, colIndex)
            "
          >
            <CottageTooltip
              :content="formatCell(row[colIndex - 1])"
              placement="top"
              :disabled="!formatCell(row[colIndex - 1])"
              delay="lazy"
            >
              <span
                class="virtual-table-cell-text"
                style="display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
              >
                {{ formatCell(row[colIndex - 1]) }}
              </span>
            </CottageTooltip>
          </td>
        </tr>
        <tr
          v-if="virtualWindow.paddingBottom > 0"
          class="virtual-table-spacer"
          aria-hidden="true"
        >
          <td
            :colspan="colCount + 1"
            :style="{ height: `${virtualWindow.paddingBottom}px` }"
          />
        </tr>
      </tbody>
    </table>
  </div>
</template>
