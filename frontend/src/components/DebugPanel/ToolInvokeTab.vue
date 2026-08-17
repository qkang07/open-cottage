<script setup lang="ts">
import { CaretForwardOutline, StopOutline } from '@vicons/ionicons5';
import {
  ElButton,
  ElEmpty,
  ElInput,
  ElMessageBox,
  ElOption,
  ElOptionGroup,
  ElScrollbar,
  ElSelect,
  ElTag,
} from 'element-plus';
import { NIcon } from '@/ui/element-plus-primitives';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
import type {
  ToolCatalogEntry,
  ToolInvocationOutcome,
} from '../../agent/toolInvocation';
import { getToolRiskLevel } from '../../platform/plan';
import type { TraceToolStatus } from '../../platform/trace';
import {
  invokeManually,
  listInvokableTools,
  ManualToolInvokeError,
} from '../../platform/debug/manualToolInvoke';
import { useAgentStore } from '../../stores/agent';

defineProps<{
  visible: boolean;
}>();

const { chat } = storeToRefs(useAgentStore());

const tools = ref<ToolCatalogEntry[]>([]);
const selectedName = ref<string | null>(null);
const argsJson = ref('{}');
const running = ref(false);
const outcome = ref<ToolInvocationOutcome | null>(null);
const invokeError = ref<string | null>(null);

let abortController: AbortController | null = null;

const toolGroups = computed(() => {
  const groups: Array<{ key: string; label: string; items: ToolCatalogEntry[] }> = [
    { key: 'mounted', label: '已挂载工具', items: [] },
    { key: 'deferred', label: '延后目录（无需 loadTools）', items: [] },
    { key: 'mcp', label: 'MCP 外部工具', items: [] },
  ];
  for (const tool of tools.value) {
    const group = groups.find((g) => g.key === tool.group);
    if (group) group.items.push(tool);
  }
  return groups.filter((g) => g.items.length > 0);
});

const selectedEntry = computed(
  () => tools.value.find((t) => t.name === selectedName.value) ?? null,
);

/** 选中工具的 JSON Schema 展示文本（只读） */
const schemaText = computed(() => {
  const schema = selectedEntry.value?.schema;
  if (!schema) return '';
  try {
    return JSON.stringify(zodToJsonSchema(schema as ZodTypeAny), null, 2);
  } catch {
    return '';
  }
});

type JsonSchemaNode = Record<string, unknown>;

/** 按 JSON Schema 生成参数骨架：object 只填 required 字段，其余给类型默认值 */
function skeletonValue(node: JsonSchemaNode | undefined): unknown {
  if (!node) return null;
  const props = node.properties as Record<string, JsonSchemaNode> | undefined;
  if (node.type === 'object' || props) {
    const required = Array.isArray(node.required)
      ? new Set(node.required as string[])
      : null;
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(props ?? {})) {
      if (required && !required.has(key)) continue;
      out[key] = skeletonValue(prop);
    }
    return out;
  }
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  switch (type) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    default:
      return null;
  }
}

/** 骨架预填参数文本；无 schema 时给空对象 */
function prefillArgs(entry: ToolCatalogEntry | null): string {
  if (!entry?.schema) return '{}';
  try {
    const jsonSchema = zodToJsonSchema(entry.schema as ZodTypeAny) as JsonSchemaNode;
    return JSON.stringify(skeletonValue(jsonSchema) ?? {}, null, 2);
  } catch {
    return '{}';
  }
}

function reloadCatalog() {
  tools.value = listInvokableTools(chat.value);
  if (selectedName.value && !tools.value.some((t) => t.name === selectedName.value)) {
    selectedName.value = null;
  }
}

watch(
  chat,
  () => {
    reloadCatalog();
    selectedName.value = null;
    argsJson.value = '{}';
    outcome.value = null;
    invokeError.value = null;
  },
  { immediate: true },
);

watch(selectedName, (name) => {
  outcome.value = null;
  invokeError.value = null;
  const entry = name ? tools.value.find((t) => t.name === name) ?? null : null;
  argsJson.value = prefillArgs(entry);
});

const STATUS_META: Record<TraceToolStatus, { label: string; type: 'success' | 'warning' | 'danger' | 'info' }> = {
  ok: { label: '成功', type: 'success' },
  blocked_policy: { label: '策略拦截', type: 'warning' },
  blocked_plan: { label: '计划闸门拦截', type: 'warning' },
  duplicate: { label: '重复调用拦截', type: 'warning' },
  doom_loop: { label: '循环告警', type: 'danger' },
  unknown_tool: { label: '未知工具', type: 'danger' },
  error: { label: '错误', type: 'danger' },
  aborted: { label: '已停止', type: 'info' },
};

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

async function run() {
  const agent = chat.value;
  const name = selectedName.value;
  if (!agent || !name || running.value) return;

  // destructive 工具：执行前二次确认（与 policyGate 的审批相互独立）
  if (getToolRiskLevel(name) === 'destructive') {
    try {
      await ElMessageBox.confirm(
        `工具「${name}」为破坏性操作，可能直接修改或删除工作区文件。确认执行？`,
        '破坏性操作确认',
        {
          confirmButtonText: '执行',
          cancelButtonText: '取消',
          type: 'warning',
        },
      );
    } catch {
      return;
    }
  }

  running.value = true;
  invokeError.value = null;
  outcome.value = null;
  const controller = new AbortController();
  abortController = controller;
  try {
    outcome.value = await invokeManually(agent, name, argsJson.value, controller.signal);
  } catch (error) {
    outcome.value = null;
    invokeError.value =
      error instanceof ManualToolInvokeError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
  } finally {
    running.value = false;
    abortController = null;
  }
}

function stop() {
  abortController?.abort();
}
</script>

<template>
  <div class="tool-invoke-tab">
    <ElEmpty
      v-if="!chat"
      description="当前没有活跃的聊天 Agent，先开启或选择一个会话"
      class="tool-invoke-tab__empty"
    />
    <ElScrollbar v-else class="tool-invoke-tab__scroll">
      <div class="tool-invoke-tab__inner">
        <div class="tool-invoke-tab__toolbar">
          <ElSelect
            v-model="selectedName"
            class="tool-invoke-tab__select"
            placeholder="选择要调用的工具"
            filterable
            clearable
            :disabled="running"
          >
            <ElOptionGroup
              v-for="group in toolGroups"
              :key="group.key"
              :label="group.label"
            >
              <ElOption
                v-for="tool in group.items"
                :key="tool.name"
                :label="tool.name"
                :value="tool.name"
              />
            </ElOptionGroup>
          </ElSelect>
          <ElButton
            v-if="!running"
            type="primary"
            :disabled="!selectedName"
            @click="run"
          >
            <template #icon>
              <NIcon :component="CaretForwardOutline" />
            </template>
            执行
          </ElButton>
          <ElButton v-else type="danger" @click="stop">
            <template #icon>
              <NIcon :component="StopOutline" />
            </template>
            停止
          </ElButton>
        </div>

        <ElEmpty
          v-if="!tools.length"
          description="当前会话没有可手工调用的工具"
          :image-size="64"
        />

        <template v-else-if="selectedEntry">
          <p class="tool-invoke-tab__desc">{{ selectedEntry.description }}</p>

          <div class="tool-invoke-tab__grid">
            <section class="tool-invoke-tab__pane">
              <div class="tool-invoke-tab__pane-title">参数（JSON）</div>
              <ElInput
                v-model="argsJson"
                type="textarea"
                class="tool-invoke-tab__args"
                :rows="10"
                spellcheck="false"
                :disabled="running"
                placeholder='{}'
              />
            </section>
            <section class="tool-invoke-tab__pane">
              <div class="tool-invoke-tab__pane-title">参数 Schema</div>
              <pre v-if="schemaText" class="tool-invoke-tab__schema">{{ schemaText }}</pre>
              <div v-else class="tool-invoke-tab__schema-empty">该工具未声明参数 schema</div>
            </section>
          </div>

          <div v-if="invokeError" class="tool-invoke-tab__error">
            {{ invokeError }}
          </div>

          <section v-if="outcome" class="tool-invoke-tab__result">
            <div class="tool-invoke-tab__result-head">
              <ElTag :type="STATUS_META[outcome.status].type" size="small" disable-transitions>
                {{ STATUS_META[outcome.status].label }}
              </ElTag>
              <span class="tool-invoke-tab__result-meta">
                耗时 {{ formatDuration(outcome.durationMs) }}
              </span>
              <span class="tool-invoke-tab__result-meta tool-invoke-tab__result-id">
                {{ outcome.callId }}
              </span>
            </div>
            <div
              v-if="outcome.imagePaths.length"
              class="tool-invoke-tab__images"
            >
              <ElTag
                v-for="path in outcome.imagePaths"
                :key="path"
                size="small"
                effect="plain"
                disable-transitions
              >
                {{ path }}
              </ElTag>
            </div>
            <pre class="tool-invoke-tab__result-text">{{ outcome.resultText }}</pre>
            <p class="tool-invoke-tab__result-note">
              本次调用经统一执行器（source: manual）并已记录到 trace 时间线，不会写入聊天 transcript。
            </p>
          </section>
        </template>
      </div>
    </ElScrollbar>
  </div>
</template>

<style scoped>
.tool-invoke-tab {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tool-invoke-tab__empty {
  margin: auto;
}

.tool-invoke-tab__scroll {
  flex: 1;
  min-height: 0;
}

.tool-invoke-tab__inner {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 8px;
}

.tool-invoke-tab__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tool-invoke-tab__select {
  flex: 1;
}

.tool-invoke-tab__desc {
  margin: 0;
  font-size: var(--cottage-font-sm);
  color: var(--cottage-muted);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-invoke-tab__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.tool-invoke-tab__pane {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-invoke-tab__pane-title {
  font-size: var(--cottage-font-xs);
  font-weight: 600;
  color: var(--cottage-muted);
  letter-spacing: 0.04em;
}

.tool-invoke-tab__schema {
  margin: 0;
  max-height: 240px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--cottage-border);
  border-radius: var(--cottage-radius-control);
  background: var(--cottage-surface-sunken);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre;
}

.tool-invoke-tab__schema-empty {
  padding: 10px 12px;
  border: 1px dashed var(--cottage-border);
  border-radius: var(--cottage-radius-control);
  font-size: var(--cottage-font-xs);
  color: var(--cottage-muted);
}

.tool-invoke-tab__error {
  padding: 8px 12px;
  border-radius: var(--cottage-radius-control);
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
  font-size: var(--cottage-font-sm);
  line-height: 1.6;
  word-break: break-word;
}

.tool-invoke-tab__result {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-invoke-tab__result-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tool-invoke-tab__result-meta {
  font-size: var(--cottage-font-xs);
  color: var(--cottage-muted);
}

.tool-invoke-tab__result-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-invoke-tab__images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tool-invoke-tab__result-text {
  margin: 0;
  max-height: 360px;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--cottage-border);
  border-radius: var(--cottage-radius-control);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-invoke-tab__result-note {
  margin: 0;
  font-size: var(--cottage-font-xs);
  color: var(--cottage-muted);
}
</style>
