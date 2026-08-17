<script setup lang="ts">
import { ElButton, ElDialog, ElInput, ElMessage, ElTree } from 'element-plus';
import { NText } from '@/ui/element-plus-primitives';
import type { TreeOption } from '@/ui/element-plus-types';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useNewEntryDialogStore } from '../../stores/newEntryDialog';
import { useWorkspaceStore } from '../../stores/workspace';
import {
  basenameOf,
  defaultNewFolderPath,
  defaultNewTextFilePath,
  joinPathInDir,
} from '../../workspace/suggestEntryPath';
import type { WorkspaceFileNode } from '../../workspace/types';

const message = ElMessage;
const { t } = useI18n();
const dialogStore = useNewEntryDialogStore();
const workspaceStore = useWorkspaceStore();
const { request } = storeToRefs(dialogStore);
const { snapshot } = storeToRefs(workspaceStore);

const name = ref('');
const dir = ref('');
const acting = ref(false);

const mode = computed(() => request.value?.mode ?? 'file');
const lockDir = computed(() => request.value?.lockDir ?? false);
const existingFiles = computed(() => snapshot.value?.files ?? []);
const rootLabel = computed(() => snapshot.value?.rootName ?? t('files.workspace'));

const showDialog = computed({
  get: () => request.value !== null,
  set: (open) => {
    if (!open) dialogStore.close();
  },
});

const title = computed(() =>
  mode.value === 'file' ? t('files.newFile') : t('files.newFolder'),
);

const lockedDirLabel = computed(() =>
  dir.value ? dir.value : t('files.rootDir', { name: rootLabel.value }),
);

/** 仅保留目录节点，构建供 ElTree 选择的树 */
const toDirNodes = (nodes: WorkspaceFileNode[]): TreeOption[] =>
  nodes
    .filter((node) => !node.isLeaf)
    .map((node) => ({
      key: node.key,
      label: node.title,
      children: node.children ? toDirNodes(node.children) : [],
    }));

const dirTreeData = computed<TreeOption[]>(() => {
  // 对话框关闭时不读取 snapshot.tree，避免每次 snapshot 变化都递归整棵树
  if (!showDialog.value) return [];
  return [
    {
      key: '',
      label: t('files.rootDir', { name: rootLabel.value }),
      children: snapshot.value ? toDirNodes(snapshot.value.tree) : [],
    },
  ];
});

function computeDefaultName(targetDir: string): string {
  const fullPath =
    mode.value === 'file'
      ? defaultNewTextFilePath(existingFiles.value, targetDir)
      : defaultNewFolderPath(existingFiles.value, targetDir);
  return basenameOf(fullPath);
}

watch(request, (req) => {
  if (!req) return;
  dir.value = req.dir;
  name.value = computeDefaultName(req.dir);
});

function handleDirSelect(node: TreeOption) {
  if (lockDir.value) return;
  dir.value = String(node.key);
}

async function handleConfirm() {
  const value = name.value.trim();
  if (!value) {
    message.warning(t('files.enterName'));
    return;
  }
  let path: string;
  try {
    path = joinPathInDir(dir.value, value);
  } catch (error) {
    message.warning(error instanceof Error ? error.message : String(error));
    return;
  }
  acting.value = true;
  try {
    if (mode.value === 'file') {
      await workspaceStore.createFile(path, '');
      message.success(t('files.createdFile'));
    } else {
      await workspaceStore.createFolder(path);
      message.success(t('files.createdFolder'));
    }
    dialogStore.close();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  } finally {
    acting.value = false;
  }
}
</script>
<template>
  <ElDialog
    v-model="showDialog"
    :title="title"
    width="480px"
    destroy-on-close
    :close-on-click-modal="!acting"
    :close-on-press-escape="!acting"
  >
    <div class="new-entry-dialog-body">
      <div class="new-entry-dialog-field">
        <NText depth="3" class="new-entry-dialog-label">{{ t('files.nameLabel') }}</NText>
        <ElInput
          v-model="name"
          :placeholder="mode === 'file' ? t('files.fileNamePlaceholder') : t('files.folderNamePlaceholder')"
          autofocus
          @keyup.enter="handleConfirm"
        />
      </div>
      <div class="new-entry-dialog-field">
        <NText depth="3" class="new-entry-dialog-label">{{ t('files.locationLabel') }}</NText>
        <ElInput
          v-if="lockDir"
          :model-value="lockedDirLabel"
          disabled
        />
        <div v-else class="new-entry-dialog-tree">
          <ElTree
            :data="dirTreeData"
            node-key="key"
            :props="{ label: 'label', children: 'children' }"
            :current-node-key="dir"
            :default-expanded-keys="['']"
            :expand-on-click-node="false"
            highlight-current
            @node-click="handleDirSelect"
          />
        </div>
      </div>
    </div>
    <template #footer>
      <ElButton :disabled="acting" @click="dialogStore.close()">{{ t('common.cancel') }}</ElButton>
      <ElButton type="primary" :loading="acting" @click="handleConfirm">
        {{ t('common.confirm') }}
      </ElButton>
    </template>
  </ElDialog>
</template>
<style scoped>
.new-entry-dialog-body {
  display: flex;
  flex-direction: column;
  gap: var(--cottage-space-lg);
}
.new-entry-dialog-field {
  display: flex;
  flex-direction: column;
  gap: var(--cottage-space-xs);
}
.new-entry-dialog-label {
  font-size: var(--cottage-font-xs);
}
.new-entry-dialog-tree {
  max-height: 240px;
  overflow: auto;
  border: 1px solid var(--cottage-border);
  border-radius: var(--cottage-radius);
  padding: var(--cottage-space-xs);
}
</style>
