<script setup lang="ts">
import {
  ChevronDownOutline,
  ChevronUpOutline,
  RefreshOutline,
  SearchOutline,
} from '@vicons/ionicons5';
import { ElButton, ElInput } from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import { NIcon } from '@/ui/element-plus-primitives';
import { computed, ref } from 'vue';
import type { InputInstance } from 'element-plus';
import CottageSelect from '@/ui/CottageSelect.vue';
import { FILE_TYPE_PRESETS } from '../../workspace/searchFilters';
import type { WorkspaceSearchMode } from '../../workspace/runWorkspaceSearch';

const query = defineModel<string>('query', { default: '' });
const mode = defineModel<WorkspaceSearchMode>('mode', { default: 'text' });
const caseSensitive = defineModel<boolean>('caseSensitive', { default: false });
const isRegex = defineModel<boolean>('isRegex', { default: false });
const includePattern = defineModel<string>('includePattern', { default: '' });
const excludePattern = defineModel<string>('excludePattern', { default: '' });
const fileTypePreset = defineModel<string>('fileTypePreset', { default: '' });
const minSizeInput = defineModel<string>('minSizeInput', { default: '' });
const maxSizeInput = defineModel<string>('maxSizeInput', { default: '' });

defineProps<{
  searching?: boolean;
  compact?: boolean;
}>();

const emit = defineEmits<{
  search: [];
}>();

const filtersExpanded = ref(false);
const inputRef = ref<InputInstance | null>(null);

function focus() {
  inputRef.value?.focus();
}

defineExpose({ focus });

const fileTypeOptions = computed(() => [
  { label: '全部类型', value: '' },
  ...FILE_TYPE_PRESETS.map((preset) => ({
    label: preset.label,
    value: preset.key,
  })),
]);

const placeholder = computed(() => {
  if (mode.value === 'filename') return '按文件名或路径搜索…';
  return '搜索文件内容…';
});

function applyFileTypePreset(key: string) {
  const preset = FILE_TYPE_PRESETS.find((item) => item.key === key);
  if (!preset) {
    return;
  }
  includePattern.value = `**/*.{${preset.extensions.join(',')}}`;
}
</script>

<template>
  <div :class="['file-search-toolbar', { 'file-search-toolbar-compact': compact }]">
    <ElInput
      ref="inputRef"
      v-model="query"
      class="file-search-toolbar-input"
      :placeholder="placeholder"
      clearable
      :autofocus="!compact"
      @keyup.enter="emit('search')"
    >
      <template #prefix>
        <NIcon :component="SearchOutline" />
      </template>
    </ElInput>

    <div class="file-search-toolbar-row">
      <div class="cottage-button-row file-search-mode-toggle">
        <ElButton
          :type="mode === 'text' ? 'primary' : 'default'"
          :text="mode !== 'text'"
          size="small"
          @click="mode = 'text'"
        >
          文本
        </ElButton>
        <ElButton
          :type="mode === 'filename' ? 'primary' : 'default'"
          :text="mode !== 'filename'"
          size="small"
          @click="mode = 'filename'"
        >
          文件名
        </ElButton>
      </div>

      <div class="file-search-toolbar-actions">
        <CottageTooltip
          v-if="mode === 'text'"
          content="区分大小写"
          placement="top"
        >
          <ElButton
            :type="caseSensitive ? 'primary' : 'default'"
            :text="!caseSensitive"
            size="small"
            class="search-case-toggle"
            @click="caseSensitive = !caseSensitive"
          >
            Aa
          </ElButton>
        </CottageTooltip>
        <CottageTooltip
          v-if="mode === 'text'"
          content="正则表达式"
          placement="top"
        >
          <ElButton
            :type="isRegex ? 'primary' : 'default'"
            :text="!isRegex"
            size="small"
            @click="isRegex = !isRegex"
          >
            .*
          </ElButton>
        </CottageTooltip>
        <ElButton
          class="cottage-icon-btn"
          size="small"
          :disabled="searching || !query.trim()"
          @click="emit('search')"
        >
          <template #icon>
            <NIcon :component="RefreshOutline" />
          </template>
        </ElButton>
        <ElButton
          text
          size="small"
          @click="filtersExpanded = !filtersExpanded"
        >
          <template #icon>
            <NIcon :component="filtersExpanded ? ChevronUpOutline : ChevronDownOutline" />
          </template>
          筛选
        </ElButton>
      </div>
    </div>

    <div v-if="filtersExpanded" class="file-search-filters">
      <div class="file-search-filter-row">
        <label class="file-search-filter-label">文件类型</label>
        <CottageSelect
          v-model="fileTypePreset"
          :options="fileTypeOptions"
          placeholder="全部类型"
          clearable
          @change="(v) => applyFileTypePreset(String(v ?? ''))"
        />
      </div>
      <ElInput
        v-model="includePattern"
        class="file-search-filter-input"
        placeholder="包含，如 **/*.ts, **/*.md"
        clearable
      />
      <ElInput
        v-model="excludePattern"
        class="file-search-filter-input"
        placeholder="排除，如 **/node_modules/**, **/*.min.js"
        clearable
      />
      <div class="file-search-filter-size-row">
        <ElInput
          v-model="minSizeInput"
          class="file-search-filter-input"
          placeholder="最小尺寸，如 1KB"
          clearable
        />
        <span class="file-search-filter-size-sep">—</span>
        <ElInput
          v-model="maxSizeInput"
          class="file-search-filter-input"
          placeholder="最大尺寸，如 10MB"
          clearable
        />
      </div>
      <!-- [HIDDEN] 旧向量索引提示保留，不再渲染。 -->
      <p v-if="false" class="file-search-filter-hint">
        向量搜索需先构建索引（调试面板 → 向量索引）
      </p>
    </div>
  </div>
</template>
