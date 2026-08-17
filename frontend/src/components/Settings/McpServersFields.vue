<script setup lang="ts">
import {
  Add,
  ArrowForwardOutline,
  CheckmarkCircle,
  CloseCircle,
  Flash,
  ReloadOutline,
  Server,
  TrashOutline,
  } from '@vicons/ionicons5';
import {
  ElButton,
  ElCard,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElInput,
  ElSwitch,
  ElTag,
  ElMessage
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import {
  NIcon,
  NSpace,
  NText
} from '@/ui/element-plus-primitives';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ConfigLayer, McpConfig, McpServerConfig } from '../../config/constants';
import {
  loadLayeredCottageConfigWithOptions,
  saveLayeredCottageConfig,
} from '../../config/cottageStorage';
import { mcpRegistry, type McpServerStatus } from '../../mcp/registry';

const props = defineProps<{
  layer: Exclude<ConfigLayer, 'server'>;
}>();

const { t } = useI18n();
const message = ElMessage;
const generateServerId = () =>
  `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const servers = ref<McpServerConfig[]>([]);
const mcpConfig = ref<McpConfig>({});
const statuses = ref<McpServerStatus[]>([]);
const testingId = ref<string | null>(null);
const newUrl = ref('');
const newName = ref('');
const oppositeLayer = props.layer === 'folder' ? 'domain' : 'folder';
const oppositeLayerLabel = computed(() =>
  oppositeLayer === 'folder' ? t('settings.layerWorkspace') : t('settings.layerGlobal'),
);
const layerLabel = computed(() =>
  props.layer === 'folder' ? t('settings.skillsLocal') : t('settings.skillsDomain'),
);

async function loadLayer() {
  const layered = await loadLayeredCottageConfigWithOptions({ syncStore: false });
  const cfg = layered.layers[props.layer]?.mcp ?? {};
  mcpConfig.value = cfg;
  servers.value = cfg.servers ?? [];
}
onMounted(() => {
  void loadLayer();
  statuses.value = mcpRegistry.getServerStatuses();
});
async function saveServers(next: McpServerConfig[]) {
  servers.value = next;
  await saveLayeredCottageConfig(
    {
      mcp: { ...mcpConfig.value, servers: next },
    },
    { level: props.layer },
  );
  await loadLayer();
}
async function handleAdd() {
  if (!newUrl.value.trim()) {
    message.warning(t('settings.mcpEnterUrl'));
    return;
  }
  const server: McpServerConfig = {
    id: generateServerId(),
    name: newName.value.trim() || new URL(newUrl.value.trim()).hostname,
    url: newUrl.value.trim(),
    enabled: true,
  };
  await saveServers([...servers.value, server]);
  newUrl.value = '';
  newName.value = '';
  message.success(t('settings.mcpAdded'));
}
async function handleRemove(id: string) {
  mcpRegistry.disconnectServer(id);
  await saveServers(servers.value.filter((s) => s.id !== id));
  statuses.value = mcpRegistry.getServerStatuses();
}
async function handleToggle(id: string, enabled: boolean) {
  const next = servers.value.map((s) => (s.id === id ? { ...s, enabled } : s));
  await saveServers(next);
  if (!enabled) {
    mcpRegistry.disconnectServer(id);
    statuses.value = mcpRegistry.getServerStatuses();
  }
}
async function handleTest(server: McpServerConfig) {
  testingId.value = server.id;
  try {
    const ok = await mcpRegistry.testServer(server);
    if (ok) message.success(t('settings.mcpConnectOk', { name: server.name }));
    else message.error(t('settings.mcpConnectFail', { name: server.name }));
  } catch (e) {
    message.error(e instanceof Error ? e.message : t('settings.mcpConnectFail', { name: server.name }));
  } finally {
    testingId.value = null;
    statuses.value = mcpRegistry.getServerStatuses();
  }
}
async function handleConnectAll() {
  const enabled = servers.value.filter((s) => s.enabled !== false);
  if (!enabled.length) {
    message.warning(t('settings.mcpNoEnabled'));
    return;
  }
  testingId.value = 'all';
  try {
    await mcpRegistry.connectServers(enabled);
    message.success(t('settings.mcpConnectDone'));
  } catch {
    message.warning(t('settings.mcpPartialFail'));
  } finally {
    testingId.value = null;
    statuses.value = mcpRegistry.getServerStatuses();
  }
}
async function handleTransferServer(server: McpServerConfig, mode: 'copy' | 'move') {
  // 读取对面层的 servers
  const layered = await loadLayeredCottageConfigWithOptions({ syncStore: false });
  const oppositeCfg = layered.layers[oppositeLayer]?.mcp ?? {};
  const oppositeServers = oppositeCfg.servers ?? [];
  // 检查 id 冲突
  const existing = oppositeServers.find((s) => s.id === server.id);
  const nextOpposite = existing
    ? oppositeServers.map((s) => (s.id === server.id ? { ...server } : s))
    : [...oppositeServers, { ...server }];
  await saveLayeredCottageConfig(
    { mcp: { ...oppositeCfg, servers: nextOpposite } },
    { level: oppositeLayer },
  );
  if (mode === 'move') {
    await saveServers(servers.value.filter((s) => s.id !== server.id));
    message.success(
      t('settings.mcpMovedTo', { name: server.name, layer: oppositeLayerLabel.value }),
    );
  } else {
    message.success(
      t('settings.mcpCopiedTo', { name: server.name, layer: oppositeLayerLabel.value }),
    );
  }
}
function getStatusBadge(serverId: string) {
  const s = statuses.value.find((st) => st.id === serverId);
  if (!s) return null;
  switch (s.status) {
    case 'connected':
      return {
        type: 'success' as const,
        label: t('settings.mcpToolsCount', { n: s.toolCount }),
        icon: CheckmarkCircle,
      };
    case 'connecting':
      return { type: 'info' as const, label: t('settings.mcpConnected'), icon: ReloadOutline };
    case 'error':
      return {
        type: 'danger' as const,
        label: t('settings.mcpError'),
        icon: CloseCircle,
        title: s.error ?? '',
      };
    default:
      return { type: 'primary' as const, label: t('settings.mcpNotConnected'), icon: null };
  }
}
</script>
<template>
  <div>
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px">
      <NText tag="h3" class="settings-section-title settings-section-title--inline">
        <NIcon :component="Server" style="margin-right: 4px; vertical-align: -2px" />
        {{ t('settings.mcpServersTitle', { layer: layerLabel }) }}
      </NText>
      <div class="cottage-button-row">
        <ElButton
          type="primary"
          :loading="testingId === 'all'"
          :disabled="!servers.filter((s) => s.enabled !== false).length"
          @click="handleConnectAll"
        >
          <template #icon>
            <NIcon :component="Flash" />
          </template>
          {{ t('settings.mcpConnectAll') }}
        </ElButton>
      </div>
    </div>
    <NText v-if="!servers.length" depth="3" style="display: block; margin-bottom: 8px">
      {{ t('settings.mcpEmpty') }}
    </NText>
    <ElCard
      v-for="server in servers"
      :key="server.id"
      style="margin-bottom: 8px"
      :content-style="{ padding: '8px 12px' }"
    >
      <div style="display: flex; align-items: center; gap: 8px">
        <div style="flex: 1; min-width: 0">
          <NSpace :size="8" align="center">
            <NText strong>{{ server.name }}</NText>
            <CottageTooltip
              v-if="getStatusBadge(server.id)"
              :content="getStatusBadge(server.id)!.title"
              placement="top"
              delay="instant"
            >
              <ElTag :type="getStatusBadge(server.id)!.type">
                <template v-if="getStatusBadge(server.id)!.icon" #icon>
                  <NIcon :component="getStatusBadge(server.id)!.icon!" />
                </template>
                {{ getStatusBadge(server.id)!.label }}
              </ElTag>
            </CottageTooltip>
          </NSpace>
          <NText depth="3" style="display: block; font-size: 11px">{{ server.url }}</NText>
        </div>
        <NSpace :size="4">
          <ElSwitch
            :model-value="server.enabled !== false"
            @update:model-value="(v) => handleToggle(server.id, Boolean(v))"
          />
          <CottageTooltip :content="t('settings.mcpTestTitle')" placement="top" delay="lazy">
            <ElButton
              text
              :loading="testingId === server.id"
              @click="handleTest(server)"
            >
              {{ t('settings.mcpTest') }}
            </ElButton>
          </CottageTooltip>
          <CottageTooltip :content="t('common.delete')" placement="top">
            <ElButton
              text
              type="danger"
              @click="handleRemove(server.id)"
            >
              <template #icon>
                <NIcon :component="TrashOutline" />
              </template>
            </ElButton>
          </CottageTooltip>
          <ElDropdown
            trigger="click"
            @command="(cmd: string) => handleTransferServer(server, cmd as 'copy' | 'move')"
          >
            <span>
              <CottageTooltip :content="t('settings.mcpTransferTitle')" placement="top">
                <ElButton text>
                  <template #icon>
                    <NIcon :component="ArrowForwardOutline" />
                  </template>
                </ElButton>
              </CottageTooltip>
            </span>
            <template #dropdown>
              <ElDropdownMenu>
                <ElDropdownItem command="copy">
                  {{ t('settings.mcpCopyTo', { layer: oppositeLayerLabel }) }}
                </ElDropdownItem>
                <ElDropdownItem command="move">
                  {{ t('settings.mcpMoveTo', { layer: oppositeLayerLabel }) }}
                </ElDropdownItem>
              </ElDropdownMenu>
            </template>
          </ElDropdown>
        </NSpace>
      </div>
    </ElCard>
    <ElCard style="margin-top: 12px" :content-style="{ padding: '8px 12px' }">
      <NText depth="3" style="display: block; margin-bottom: 8px">
        {{ t('settings.mcpAddServer') }}
      </NText>
      <div style="display: flex; gap: 8px; width: 100%">
        <ElInput
          v-model="newName"
          :placeholder="t('settings.mcpNameOptional')"
          style="width: 30%"
        />
        <ElInput
          v-model="newUrl"
          placeholder="URL, e.g. https://mcp.example.com/mcp"
          style="flex: 1"
        />
        <ElButton style="flex-shrink: 0" @click="handleAdd">
          <template #icon>
            <NIcon :component="Add" />
          </template>
          {{ t('common.add') }}
        </ElButton>
      </div>
    </ElCard>
  </div>
</template>
