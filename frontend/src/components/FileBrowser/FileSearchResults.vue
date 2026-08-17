<script setup lang="ts">
import { NText } from '@/ui/element-plus-primitives';
import type { WorkspaceSearchResultGroup } from '../../workspace/runWorkspaceSearch';

defineProps<{
  groups: WorkspaceSearchResultGroup[];
  query: string;
  caseSensitive?: boolean;
}>();

const emit = defineEmits<{
  openFile: [path: string];
  openAtLine: [path: string, line: number];
}>();

interface HighlightPart {
  text: string;
  highlight: boolean;
}

function highlightParts(
  text: string,
  q: string,
  sensitive: boolean,
): HighlightPart[] {
  if (!q.trim()) return [{ text, highlight: false }];
  const flags = sensitive ? 'g' : 'gi';
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, flags));
  return parts.map((part, i) => ({
    text: part,
    highlight: i % 2 === 1,
  }));
}
</script>

<template>
  <div class="file-search-results">
    <div v-if="!groups.length" class="file-search-results-empty">
      <NText depth="3">无匹配结果</NText>
    </div>
    <div v-for="group in groups" :key="group.path" class="search-result-file">
      <button
        type="button"
        class="search-result-file-header"
        @click="emit('openFile', group.path)"
      >
        {{ group.path }}
      </button>

      <template v-if="group.kind === 'text'">
        <button
          v-for="match in group.matches"
          :key="`${group.path}:${match.line}`"
          type="button"
          class="search-result-line"
          @click="emit('openAtLine', group.path, match.line)"
        >
          <span class="search-result-line-no">{{ match.line }}</span>
          <span class="search-result-line-text">
            <template
              v-for="(part, i) in highlightParts(match.text, query, caseSensitive ?? false)"
              :key="i"
            >
              <mark v-if="part.highlight" class="search-result-highlight">
                {{ part.text }}
              </mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
        </button>
      </template>

      <template v-else>
        <button
          type="button"
          class="search-result-line search-result-line-filename"
          @click="emit('openFile', group.path)"
        >
          <span class="search-result-line-text">{{ group.name }}</span>
        </button>
      </template>
    </div>
  </div>
</template>
