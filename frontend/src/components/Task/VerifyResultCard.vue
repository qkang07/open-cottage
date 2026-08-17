<script setup lang="ts">
import { computed } from 'vue';
import {
  CheckmarkCircle,
  CloseCircle,
  AlertCircle,
} from '@vicons/ionicons5';
import { ElTag } from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import { NIcon, NText } from '@/ui/element-plus-primitives';
import { useWorkspaceStore } from '../../stores/workspace';
import type { VerifyReport } from '../../platform/verify';

const props = defineProps<{
  report: VerifyReport;
  /** 是否正在等待 Agent 修复（任务运行中且最近一次验收失败） */
  fixing?: boolean;
}>();

const workspaceStore = useWorkspaceStore();
const passed = computed(() => props.report.checks.filter((c) => c.pass));
const isPass = computed(() => props.report.verdict === 'pass');

const typeLabel: Record<string, string> = {
  fileExists: '文件存在',
  contentContains: '内容包含',
  contentMatches: '正则匹配',
  jsonField: 'JSON 字段',
  manifestCoverage: '清单覆盖',
};
</script>

<template>
  <div class="verify-card" :data-verdict="report.verdict">
    <div class="verify-card-header">
      <span class="verify-card-title">
        <NIcon :component="isPass ? CheckmarkCircle : AlertCircle" />
        <NText strong>验收结果</NText>
      </span>
      <span class="verify-card-tags">
        <ElTag v-if="fixing" size="small" type="warning">修复中</ElTag>
        <ElTag v-else-if="isPass" size="small" type="success">通过</ElTag>
        <ElTag v-else size="small" type="danger">未通过</ElTag>
        <ElTag size="small" type="info">
          {{ passed.length }}/{{ report.checks.length }} 项
        </ElTag>
      </span>
    </div>

    <NText v-if="!isPass && report.uncovered.length" depth="2" class="verify-card-uncovered">
      未覆盖：{{ report.uncovered.join('；') }}
    </NText>

    <ul v-if="report.checks.length" class="verify-card-list">
      <li v-for="check in report.checks" :key="check.id">
        <CottageTooltip
          :content="check.target ?? ''"
          placement="top"
          :disabled="!check.target || check.target === 'manifest'"
          delay="lazy"
        >
          <span>
            <button
              type="button"
              class="verify-card-item"
              :class="{
                'verify-card-item-fail': !check.pass,
                'verify-card-item-active':
                  check.target && check.target !== 'manifest' && check.target === workspaceStore.selectedPath,
              }"
              :disabled="!check.target || check.target === 'manifest'"
              @click="
                check.target && check.target !== 'manifest'
                  ? workspaceStore.selectFile(check.target)
                  : null
              "
            >
              <NIcon
                :component="check.pass ? CheckmarkCircle : CloseCircle"
                class="verify-card-item-icon"
                :class="check.pass ? 'verify-card-item-icon-ok' : 'verify-card-item-icon-bad'"
              />
              <span class="verify-card-item-type">{{ typeLabel[check.type] ?? check.type }}</span>
              <span class="verify-card-item-desc">{{ check.description ?? check.id }}</span>
            </button>
          </span>
        </CottageTooltip>
        <NText v-if="!check.pass && check.reason" depth="3" class="verify-card-item-reason">
          {{ check.reason }}
        </NText>
      </li>
    </ul>

    <NText depth="3" class="verify-card-meta">
      共 {{ report.checks.length }} 项 · 清单 {{ report.manifestPathCount }} 路径 ·
      验收文件 {{ report.acceptanceFileCount }} ·
      脚本{{ report.scriptRan ? '已执行' : '未配置' }}
      · {{ new Date(report.runAt).toLocaleString() }}
    </NText>
  </div>
</template>
