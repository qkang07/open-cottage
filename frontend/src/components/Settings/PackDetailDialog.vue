<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  ElCollapse,
  ElCollapseItem,
  ElDialog,
  ElTag
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import { NText } from '@/ui/element-plus-primitives';
import type { PackDetail } from '../../platform/packs/detail';
import type { CapabilityRiskLevel } from '../../platform/capabilities/types';

const props = defineProps<{
  modelValue: boolean;
  detail: PackDetail | null;
}>();
const emit = defineEmits<{ 'update:modelValue': [boolean] }>();

const { t } = useI18n();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const dialogTitle = computed(() =>
  props.detail
    ? t('settings.packDetailTitle', { name: props.detail.name })
    : t('settings.packDetail'),
);

const SOURCE_I18N: Record<PackDetail['source'], string> = {
  base: 'settings.sourceBase',
  builtin: 'settings.sourceBuiltin',
  external: 'settings.sourceExternal',
};

const RISK_I18N: Record<CapabilityRiskLevel, string> = {
  read: 'settings.riskRead',
  write: 'settings.riskWrite',
  external: 'settings.riskExternal',
  destructive: 'settings.riskDestructive',
};

type TagType = 'success' | 'info' | 'warning' | 'danger' | 'primary';
const RISK_TAG_TYPE: Record<CapabilityRiskLevel, TagType> = {
  read: 'info',
  write: 'warning',
  external: 'primary',
  destructive: 'danger',
};
const riskTagType = (level?: CapabilityRiskLevel): TagType =>
  level ? RISK_TAG_TYPE[level] : 'info';
const riskLabel = (level: CapabilityRiskLevel) => t(RISK_I18N[level]);
</script>

<template>
  <ElDialog
    v-model="visible"
    :title="dialogTitle"
    width="640px"
    append-to-body
  >
    <div v-if="detail" class="pack-detail">
      <div class="pack-detail-head">
        <ElTag size="small" type="info">{{ t(SOURCE_I18N[detail.source]) }}</ElTag>
        <ElTag v-if="detail.alwaysOn" size="small" type="success">
          {{ t('settings.alwaysAvailable') }}
        </ElTag>
        <ElTag v-if="detail.domain" size="small">{{ detail.domain }}</ElTag>
        <ElTag v-if="detail.riskLevel" size="small" type="warning">
          {{ riskLabel(detail.riskLevel) }}
        </ElTag>
        <ElTag v-if="detail.version" size="small">v{{ detail.version }}</ElTag>
      </div>

      <NText v-if="detail.description" depth="3" class="pack-detail-desc">
        {{ detail.description }}
      </NText>

      <!-- 配置（仅基础能力包等提供配置插槽时显示） -->
      <section v-if="$slots.config" class="pack-detail-section">
        <NText tag="h4" class="pack-detail-title">{{ t('settings.config') }}</NText>
        <slot name="config" />
      </section>

      <!-- 工具 -->
      <section class="pack-detail-section">
        <NText tag="h4" class="pack-detail-title">
          {{ t('settings.toolsCount', { n: detail.tools.length }) }}
        </NText>
        <div v-if="detail.tools.length" class="pack-detail-tools">
          <div
            v-for="tool in detail.tools"
            :key="tool.name"
            class="pack-detail-tool"
          >
            <div class="pack-detail-tool-head">
              <code class="pack-detail-tool-name">{{ tool.name }}</code>
              <ElTag
                v-if="tool.riskLevel"
                size="small"
                :type="riskTagType(tool.riskLevel)"
                disable-transitions
              >
                {{ riskLabel(tool.riskLevel) }}
              </ElTag>
            </div>
            <NText v-if="tool.description" depth="3" class="pack-detail-tool-desc">
              {{ tool.description }}
            </NText>
          </div>
        </div>
        <NText v-else depth="3">{{ t('settings.noToolsViaCaps') }}</NText>
      </section>

      <!-- 能力声明 -->
      <section
        v-if="detail.capabilities && detail.capabilities.length"
        class="pack-detail-section"
      >
        <NText tag="h4" class="pack-detail-title">
          {{ t('settings.capabilitiesCount', { n: detail.capabilities.length }) }}
        </NText>
        <div class="pack-detail-tags">
          <ElTag
            v-for="cap in detail.capabilities"
            :key="cap"
            size="small"
            type="info"
          >
            {{ cap }}
          </ElTag>
        </div>
      </section>

      <!-- MCP -->
      <section
        v-if="detail.mcpServerNames && detail.mcpServerNames.length"
        class="pack-detail-section"
      >
        <NText tag="h4" class="pack-detail-title">
          {{ t('settings.mcpServersCount', { n: detail.mcpServerNames.length }) }}
        </NText>
        <div class="pack-detail-tags">
          <ElTag
            v-for="name in detail.mcpServerNames"
            :key="name"
            size="small"
            type="success"
          >
            {{ name }}
          </ElTag>
        </div>
      </section>

      <!-- Skills -->
      <section
        v-if="detail.skills.length"
        class="pack-detail-section"
      >
        <NText tag="h4" class="pack-detail-title">
          {{ t('settings.skillsCount', { n: detail.skills.length }) }}
        </NText>
        <ElCollapse>
          <ElCollapseItem
            v-for="skill in detail.skills"
            :key="skill.file"
            :name="skill.file"
          >
            <template #title>
              <CottageTooltip :content="skill.file" placement="top" delay="lazy">
                <span>{{ skill.file }}</span>
              </CottageTooltip>
            </template>
            <pre class="pack-detail-pre">{{ skill.content || t('settings.emptyContent') }}</pre>
          </ElCollapseItem>
        </ElCollapse>
      </section>

      <!-- 提示词 -->
      <section v-if="detail.promptOverlay" class="pack-detail-section">
        <NText tag="h4" class="pack-detail-title">{{ t('settings.promptOverlay') }}</NText>
        <pre class="pack-detail-pre">{{ detail.promptOverlay }}</pre>
      </section>
    </div>
  </ElDialog>
</template>

<style scoped>
.pack-detail-head {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pack-detail-desc {
  display: block;
  margin-top: 10px;
}

.pack-detail-section {
  margin-top: 18px;
}

.pack-detail-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
}

.pack-detail-tools {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.pack-detail-tool {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank, transparent);
}

.pack-detail-tool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pack-detail-tool-name {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-primary);
  word-break: break-all;
}

.pack-detail-tool-desc {
  font-size: 12px;
  line-height: 1.5;
}

.pack-detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pack-detail-pre {
  margin: 0;
  padding: 10px 12px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.6;
  background: var(--el-fill-color-light);
  border-radius: 8px;
}
</style>
