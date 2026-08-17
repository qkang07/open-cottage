<script setup lang="ts">
import {
  Add,
  CreateOutline,
  EyeOutline,
  FlashOutline,
  TrashOutline,
  } from '@vicons/ionicons5';
import {
  ElButton,
  ElCard,
  ElEmpty,
  ElInput,
  ElDialog,
  ElSelect,
  ElOption,
  ElSwitch,
  ElTag,
  ElMessageBox,
  ElMessage
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NSpace,
  NText
} from '@/ui/element-plus-primitives';
import { computed, onMounted, ref } from 'vue';
import {
  loadWorkspaceSkillsIndex,
  parseSkillFrontmatter,
  type WorkspaceSkillIndexEntry,
} from '../../agent/workspaceSkills';
import { WORKSPACE_SKILLS_DIR } from '../../config/constants';
import { getCottageConfig } from '../../config/store';
import { saveCottageConfigToWorkspace } from '../../config/cottageStorage';
import { installFromUrl } from '../../platform/packs/remoteInstall';
import { useCottageServiceStore } from '../../stores/cottageService';
import { workspace } from '../../workspace/FileSystemWorkspace';
interface SkillEntry extends WorkspaceSkillIndexEntry {
  enabled: boolean;
  content?: string;
}
const message = ElMessage;
const skills = ref<SkillEntry[]>([]);
const loading = ref(false);
const viewContent = ref<{ path: string; content: string } | null>(null);
const editState = ref<{ path: string; content: string } | null>(null);
const showViewModal = ref(false);
const showEditModal = ref(false);
const createModal = ref(false);
const newName = ref('');
const newDesc = ref('');
const config = getCottageConfig();
const respectEnabled = config.skills?.respectFrontmatterEnabled ?? true;

// 注入过滤：选中的标签白名单（持久化到 config.skills.activeTags）
const activeTags = ref<string[]>([...(config.skills?.activeTags ?? [])]);
const savingTags = ref(false);
// 所有技能中出现过的标签（去重排序），供过滤器下拉选择
const allTags = computed(() => {
  const set = new Set<string>();
  for (const s of skills.value) {
    for (const t of s.tags ?? []) set.add(t);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
});
// 依据当前过滤规则，判断某技能是否会被注入系统提示词
function isInjected(skill: SkillEntry): boolean {
  if (!activeTags.value.length) return true;
  if (!skill.tags?.length) return true;
  const set = new Set(activeTags.value.map((t) => t.toLowerCase()));
  return skill.tags.some((t) => set.has(t.toLowerCase()));
}

// 远程安装
const remoteModal = ref(false);
const remoteUrl = ref('');
const remoteInstalling = ref(false);
const SKILL_TEMPLATE = (name: string, description: string) => `---
name: ${name}
description: ${description}
enabled: true
---
# ${name}
${description}
## 使用说明
请在此处编写技能的详细使用说明。
`;
async function loadSkills() {
  if (!workspace.isOpen) return;
  loading.value = true;
  try {
    const entries = await loadWorkspaceSkillsIndex();
    const enriched: SkillEntry[] = [];
    for (const entry of entries) {
      const { content } = await workspace.readFile(entry.path);
      const meta = parseSkillFrontmatter(content);
      const enabled = meta.enabled !== 'false';
      enriched.push({ ...entry, enabled, content });
    }
    skills.value = enriched;
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  void loadSkills();
});
async function handleView(path: string) {
  const { content } = await workspace.readFile(path);
  viewContent.value = { path, content };
  showViewModal.value = true;
}
async function handleEdit(path: string) {
  const { content } = await workspace.readFile(path);
  editState.value = { path, content };
  showEditModal.value = true;
}
async function handleSaveEdit() {
  if (!editState.value) return false;
  await workspace.writeFile(editState.value.path, editState.value.content);
  message.success('技能已保存');
  editState.value = null;
  void loadSkills();
  return true;
}
function handleDelete(path: string) {
  void ElMessageBox.confirm(
    `删除技能文件 ${path}？此操作不可恢复。`,
    '确认删除',
    {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    },
  ).then(async () => {
    await workspace.deleteFile(path);
    message.success('已删除');
    void loadSkills();
  }).catch(() => undefined);
}
async function handleToggleEnabled(skill: SkillEntry, enabled: boolean) {
  if (!skill.content) return;
  const frontmatterRe = /^---\r?\n([\s\S]*?)\r?\n---/;
  const match = skill.content.match(frontmatterRe);
  let newContent: string;
  if (match) {
    const fmContent = match[1];
    const enabledLine = /^enabled:\s*.*$/m;
    let newFm: string;
    if (enabledLine.test(fmContent)) {
      newFm = fmContent.replace(enabledLine, `enabled: ${enabled}`);
    } else {
      newFm = `${fmContent}\nenabled: ${enabled}`;
    }
    newContent = skill.content.replace(frontmatterRe, `---\n${newFm}\n---`);
  } else {
    newContent = `---\nenabled: ${enabled}\n---\n\n${skill.content}`;
  }
  await workspace.writeFile(skill.path, newContent);
  message.success(enabled ? '已启用' : '已停用');
  void loadSkills();
}
async function handleCreate() {
  const name = newName.value.trim();
  if (!name) {
    message.warning('请输入技能名称');
    return false;
  }
  const fileName = `${name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')}.md`;
  const path = `${WORKSPACE_SKILLS_DIR}/${fileName}`;
  const kind = await workspace.getEntryKind(WORKSPACE_SKILLS_DIR);
  if (kind !== 'directory') {
    await workspace.mkdir(WORKSPACE_SKILLS_DIR);
  }
  const content = SKILL_TEMPLATE(name, newDesc.value.trim() || name);
  await workspace.writeFile(path, content);
  message.success(`技能 "${name}" 已创建`);
  createModal.value = false;
  newName.value = '';
  newDesc.value = '';
  void loadSkills();
  return true;
}

async function handleSaveActiveTags(tags: string[]) {
  activeTags.value = tags;
  savingTags.value = true;
  try {
    await saveCottageConfigToWorkspace({ skills: { activeTags: tags } });
    message.success(
      tags.length
        ? `已限定注入标签：${tags.join('、')}`
        : '已恢复注入全部技能',
    );
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    savingTags.value = false;
  }
}

async function handleRemoteInstall() {
  const url = remoteUrl.value.trim();
  if (!url) {
    message.warning('请输入技能或能力包的 URL');
    return false;
  }
  const svc = useCottageServiceStore();
  const fetcher =
    svc.isConnected() && svc.useFetch ? svc.getClient() : null;
  remoteInstalling.value = true;
  try {
    const result = await installFromUrl(url, {
      level: 'folder',
      fetcher,
      confirmOverwrite: async (path) => {
        try {
          await ElMessageBox.confirm(
            `已存在 ${path}，是否覆盖？`,
            '确认覆盖',
            { type: 'warning', confirmButtonText: '覆盖', cancelButtonText: '取消' },
          );
          return true;
        } catch {
          return false;
        }
      },
    });
    if (result.kind === 'pack') {
      message.success(`能力包已安装：${result.name}`);
    } else {
      message.success(
        `技能已${result.overwritten ? '更新' : '安装'}：${result.name}`,
      );
    }
    remoteModal.value = false;
    remoteUrl.value = '';
    void loadSkills();
    return true;
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    remoteInstalling.value = false;
  }
}
</script>
<template>
  <div style="padding: 0 4px">
    <div
      style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      "
    >
      <NText strong style="font-size: 16px">
        <NIcon :component="FlashOutline" style="margin-right: 8px; vertical-align: -2px" />
        工作区技能
      </NText>
      <NSpace :size="8">
        <ElButton @click="remoteModal = true">
          远程安装
        </ElButton>
        <ElButton type="primary" @click="createModal = true">
          <template #icon>
            <NIcon :component="Add" />
          </template>
          新建
        </ElButton>
      </NSpace>
    </div>
    <div
      v-if="allTags.length"
      style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px"
    >
      <NText depth="3" style="font-size: 12px; white-space: nowrap">
        注入标签
      </NText>
      <ElSelect
        :model-value="activeTags"
        multiple
        clearable
        collapse-tags
        :loading="savingTags"
        placeholder="空 = 注入全部；选择后仅注入含所选标签或无标签的技能"
        style="flex: 1"
        @update:model-value="(v: string[]) => handleSaveActiveTags(v)"
      >
        <ElOption v-for="tag in allTags" :key="tag" :label="tag" :value="tag" />
      </ElSelect>
    </div>
    <ElEmpty
      v-if="!skills.length && !loading"
      description="工作区 SKILLS/ 目录下暂无 .md 技能文件"
    />
    <div v-else>
      <ElCard
        v-for="skill in skills"
        :key="skill.path"
        style="margin-bottom: 8px"
        :content-style="{ padding: '8px 12px' }"
      >
        <div style="display: flex; align-items: center; justify-content: space-between">
          <div style="flex: 1; min-width: 0">
            <NSpace :size="8" align="center">
              <NText strong>
                {{ skill.name || skill.path.split('/').pop()?.replace('.md', '') }}
              </NText>
              <ElTag v-if="respectEnabled && !skill.enabled">已停用</ElTag>
              <CottageTooltip
                v-else-if="activeTags.length && !isInjected(skill)"
                content="当前注入标签未命中，不会写入系统提示词"
                placement="top"
                delay="instant"
              >
                <ElTag type="info">未注入</ElTag>
              </CottageTooltip>
              <ElTag
                v-for="tag in skill.tags"
                :key="tag"
                size="small"
                type="success"
                effect="plain"
              >{{ tag }}</ElTag>
            </NSpace>
            <NText
              depth="3"
              :ellipsis="{ tooltip: true }"
              style="margin: 2px 0 0; font-size: 12px; display: block"
            >
              {{ skill.description }}
            </NText>
            <NText depth="3" style="font-size: 11px">{{ skill.path }}</NText>
          </div>
          <NSpace :size="4">
            <ElSwitch
              v-if="respectEnabled"
              :value="skill.enabled"
              @update:value="(v: boolean) => handleToggleEnabled(skill, v)"
            />
            <CottageTooltip content="查看" placement="top">
              <ElButton text @click="handleView(skill.path)">
                <template #icon>
                  <NIcon :component="EyeOutline" />
                </template>
              </ElButton>
            </CottageTooltip>
            <CottageTooltip content="编辑" placement="top">
              <ElButton text @click="handleEdit(skill.path)">
                <template #icon>
                  <NIcon :component="CreateOutline" />
                </template>
              </ElButton>
            </CottageTooltip>
            <CottageTooltip content="删除" placement="top">
              <ElButton
                text
                type="danger"
                @click="handleDelete(skill.path)"
              >
                <template #icon>
                  <NIcon :component="TrashOutline" />
                </template>
              </ElButton>
            </CottageTooltip>
          </NSpace>
        </div>
      </ElCard>
    </div>
    <ElDialog
      v-model:show="showViewModal"
      preset="card"
      :title="viewContent?.path"
      style="width: 680px"
      @after-leave="() => { viewContent = null; }"
    >
      <pre
        v-if="viewContent"
        style="max-height: 500px; overflow: auto; white-space: pre-wrap; font-size: 13px"
      >{{ viewContent.content }}</pre>
    </ElDialog>
    <ElDialog
      v-model:show="showEditModal"
      preset="dialog"
      :title="`编辑 ${editState?.path}`"
      positive-text="保存"
      negative-text="取消"
      style="width: 680px"
      @positive-click="handleSaveEdit"
      @after-leave="() => { editState = null; }"
    >
      <ElInput
        v-if="editState"
        v-model="editState.content"
        type="textarea"
        :rows="18"
        style="font-family: monospace; font-size: 13px"
      />
    </ElDialog>
    <ElDialog
      v-model:show="createModal"
      preset="dialog"
      title="新建技能"
      positive-text="创建"
      negative-text="取消"
      @positive-click="handleCreate"
    >
      <NSpace vertical style="width: 100%">
        <ElInput v-model="newName" placeholder="技能名称" />
        <ElInput
          v-model="newDesc"
          type="textarea"
          placeholder="技能描述（可选）"
          :rows="3"
        />
      </NSpace>
    </ElDialog>
    <ElDialog
      v-model:show="remoteModal"
      preset="dialog"
      title="远程安装"
      positive-text="安装"
      negative-text="取消"
      :loading="remoteInstalling"
      @positive-click="handleRemoteInstall"
    >
      <NSpace vertical style="width: 100%">
        <ElInput
          v-model="remoteUrl"
          placeholder="https://… 技能 .md 或能力包 manifest.json 的地址"
          :disabled="remoteInstalling"
        />
        <NText depth="3" style="font-size: 12px">
          支持 Markdown 技能（写入 SKILLS/）与能力包 JSON（自动识别）。若目标地址受 CORS 限制，请先连接 Cottage Service 并开启抓取。
        </NText>
      </NSpace>
    </ElDialog>
  </div>
</template>
