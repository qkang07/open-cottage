<script setup lang="ts">
import { computed } from 'vue';
import { CheckmarkOutline, DocumentOutline } from '@vicons/ionicons5';
import { ElTag } from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import { NIcon, NText } from '@/ui/element-plus-primitives';
import { useWorkspaceStore } from '../../stores/workspace';

type PathEntry = { path: string; description?: string };

const props = defineProps<{
  paths: PathEntry[];
  summary?: string;
  /** 是否已完成（taskComplete 已返回 ok） */
  completed?: boolean;
  running?: boolean;
}>();

const workspaceStore = useWorkspaceStore();
const count = computed(() => props.paths.length);
</script>

<template>
  <div class="deliverable-card" :data-completed="completed ? 'true' : 'false'">
    <div class="deliverable-card-header">
      <span class="deliverable-card-title">
        <NIcon :component="CheckmarkOutline" />
        <NText strong>交付清单</NText>
      </span>
      <span class="deliverable-card-tags">
        <ElTag v-if="running && !completed" size="small" type="warning">提交中</ElTag>
        <ElTag v-else-if="completed" size="small" type="success">已完成</ElTag>
        <ElTag size="small" type="info">{{ count }} 项</ElTag>
      </span>
    </div>
    <NText v-if="summary" depth="2" class="deliverable-card-summary">
      {{ summary }}
    </NText>
    <ul v-if="count" class="deliverable-card-list">
      <li v-for="entry in paths" :key="entry.path">
        <CottageTooltip :content="entry.path" placement="top" delay="lazy">
          <button
            type="button"
            class="deliverable-card-item"
            :class="
              entry.path === workspaceStore.selectedPath
                ? 'deliverable-card-item-active'
                : ''
            "
            @click="workspaceStore.selectFile(entry.path)"
          >
            <NIcon :component="DocumentOutline" class="deliverable-card-item-icon" />
            <span class="deliverable-card-item-path">{{ entry.path }}</span>
            <NText
              v-if="entry.description"
              depth="3"
              class="deliverable-card-item-desc"
            >
              {{ entry.description }}
            </NText>
          </button>
        </CottageTooltip>
      </li>
    </ul>
  </div>
</template>
