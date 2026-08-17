<script setup lang="ts">
import {
  ElEmpty
} from 'element-plus';
import { computed, ref } from 'vue';
import type { SpreadsheetContent } from '../../agent/officeDocuments';
import type { SpreadsheetAnchor } from '../../chat/fileReferences';
import VirtualTable from './VirtualTable.vue';
const props = defineProps<{
  data: SpreadsheetContent;
  onRangeSelect?: (anchor: SpreadsheetAnchor | null) => void;
}>();
const sheetNames = computed(() =>
  props.data.sheetNames.length
    ? props.data.sheetNames
    : Object.keys(props.data.sheets),
);
const activeSheet = ref(sheetNames.value[0] ?? '');
const resolvedActive = computed(() => {
  if (activeSheet.value && sheetNames.value.includes(activeSheet.value)) {
    return activeSheet.value;
  }
  return sheetNames.value[0] ?? '';
});
const rows = computed(
  () => props.data.sheets[resolvedActive.value] ?? [],
);
</script>
<template>
  <ElEmpty v-if="!sheetNames.length" description="表格为空" />
  <div v-else class="office-preview spreadsheet-preview">
    <div
      v-if="sheetNames.length > 1"
      class="spreadsheet-sheet-tabs"
      role="tablist"
    >
      <button
        v-for="name in sheetNames"
        :key="name"
        type="button"
        role="tab"
        :aria-selected="name === resolvedActive"
        :class="
          name === resolvedActive
            ? 'spreadsheet-sheet-tab is-active'
            : 'spreadsheet-sheet-tab'
        "
        @click="activeSheet = name"
      >
        {{ name }}
      </button>
    </div>
    <div v-else class="spreadsheet-sheet-label">{{ resolvedActive }}</div>
    <VirtualTable
      :key="resolvedActive"
      :sheet-name="resolvedActive"
      :rows="rows"
      :on-range-select="onRangeSelect"
    />
  </div>
</template>
