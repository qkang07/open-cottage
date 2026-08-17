<script setup lang="ts">
import {
  ArrowForwardOutline,
  CloudDownloadOutline,
  TrashOutline,
} from '@vicons/ionicons5';
import {
  ElButton,
  ElCard,
  ElCheckbox,
  ElForm,
  ElFormItem,
  ElInputNumber,
  ElSwitch,
  ElTag,
  ElMessage
} from 'element-plus';
import CottageTooltip from '@/ui/CottageTooltip.vue';
import CottageSelect from '@/ui/CottageSelect.vue';
import {
  NIcon,
  NText,
} from '@/ui/element-plus-primitives';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAgentStore } from '../../stores/agent';
import { useWorkspaceStore } from '../../stores/workspace';
import {
  installCapabilityPack,
  setCapabilityPackEnabled,
  uninstallCapabilityPack,
} from '../../platform/packs/install';
import { loadAllPackManifests } from '../../platform/packs/loader';
import { SAMPLE_WRITING_REVIEW_PACK } from '../../platform/packs/sampleManifest';
import type { CapabilityPackManifest } from '../../platform/packs/types';
import { validateCapabilityPackManifest } from '../../platform/packs/validate';
import {
  BASE_PACK,
  BUILTIN_PACKS,
  isBuiltinPackAvailable,
  type BuiltinCapabilityPack,
} from '../../platform/packs/builtins';
import {
  basePackDetail,
  builtinPackDetail,
  externalPackDetail,
  type PackDetail,
} from '../../platform/packs/detail';
import type { CapabilityRiskLevel } from '../../platform/capabilities/types';
import { getCottageConfig, setCottageConfig } from '../../config/store';
import { saveCottageConfigToWorkspace, saveLayeredCottageConfig } from '../../config/cottageStorage';
import type { CottageConfig, LayeredCottageConfigSchema } from '../../config/constants';
import PackDetailDialog from './PackDetailDialog.vue';
import WebSearchFields from './WebSearchFields.vue';
import McpServersFields from './McpServersFields.vue';
import LayerTabs from './LayerTabs.vue';
import { useCottageServiceStore } from '../../stores/cottageService';
import { storeToRefs } from 'pinia';

const { t } = useI18n();
/** 将 pack id 转为 i18n 键（builtin.deep-research → builtin_deep_research） */
const packI18nKey = (id: string) => id.replace(/[.-]/g, '_');
const packName = (id: string, fallback: string) => t(`settings.builtinPack.${packI18nKey(id)}.name`, fallback);
const packDesc = (id: string, fallback: string) => t(`settings.builtinPack.${packI18nKey(id)}.description`, fallback);

const props = defineProps<{
  config: CottageConfig;
  layeredConfig?: LayeredCottageConfigSchema['layers'];
}>();

const emit = defineEmits<{ refreshLayered: [] }>();

type BasicSection = 'overview' | 'web-search' | 'mcp' | 'skills' | 'script' | 'governance';
type MainSection = 'basic' | 'builtin' | 'external';

type PackRow = {
  id: string;
  enabled: boolean;
  installedAt: number;
  version?: string;
  manifest: CapabilityPackManifest | null;
};

const BASIC_NAV: { key: BasicSection; labelKey: string }[] = [
  { key: 'overview', labelKey: 'settings.navFilesTools' },
  { key: 'web-search', labelKey: 'settings.navWebSearch' },
  { key: 'mcp', labelKey: 'settings.navMcp' },
  { key: 'skills', labelKey: 'settings.navSkills' },
  { key: 'script', labelKey: 'settings.navScript' },
  { key: 'governance', labelKey: 'settings.navGovernance' },
];

const RISK_I18N: Record<CapabilityRiskLevel, string> = {
  read: 'settings.riskRead',
  write: 'settings.riskWrite',
  external: 'settings.riskExternal',
  destructive: 'settings.riskDestructive',
};

const pyodideSourceOptions = computed(() => [
  { value: 'cdn', label: t('settings.pyodideCdn') },
  { value: 'bundled', label: t('settings.pyodideBundled') },
]);

const message = ElMessage;
const workspaceStore = useWorkspaceStore();
const agentStore = useAgentStore();
const cottageServiceStore = useCottageServiceStore();
const { status: cottageStatus, capabilities: cottageCapabilities } =
  storeToRefs(cottageServiceStore);

const cottageAvailability = computed(() => ({
  connected: cottageStatus.value === 'connected',
  capabilities: cottageCapabilities.value,
}));

const loading = ref(false);
const loadingDomain = ref(false);
const rows = ref<PackRow[]>([]);
const domainRows = ref<PackRow[]>([]);
const fileInputRef = ref<HTMLInputElement | null>(null);
const fileInputDomainRef = ref<HTMLInputElement | null>(null);

const mainSection = ref<MainSection>('basic');
const basicSection = ref<BasicSection>('overview');

const builtinPacks = BUILTIN_PACKS;
const baseDetail = computed(() => basePackDetail(BASE_PACK));

/** 当前被禁用的内置能力包 id 集合（从配置读取） */
const disabledBuiltinPackSet = computed(() => {
  const list = props.config.packs?.disabledBuiltinPacks ?? [];
  return new Set(list);
});

/** 当前尚未就绪、不在设置页展示的内置能力包 id */
const HIDDEN_BUILTIN_PACK_IDS = new Set(['builtin.data-analysis']);

/** 设置页展示的内置能力包（过滤掉暂未就绪的） */
const visibleBuiltinPacks = computed(() =>
  builtinPacks.filter((p) => !HIDDEN_BUILTIN_PACK_IDS.has(p.id)),
);

/** 判断某个内置能力包是否已启用 */
function isBuiltinPackEnabled(pack: BuiltinCapabilityPack): boolean {
  return !disabledBuiltinPackSet.value.has(pack.id);
}

/** 依赖 Cottage Service 的包在未连接（或缺能力）时不可切换 */
function isBuiltinPackCottageReady(pack: BuiltinCapabilityPack): boolean {
  return isBuiltinPackAvailable(pack, cottageAvailability.value);
}

/** 切换内置能力包启用/禁用 */
async function handleToggleBuiltinPack(pack: BuiltinCapabilityPack, enabled: boolean) {
  if (!isBuiltinPackCottageReady(pack)) {
    message.warning(t('settings.packRequiresCottageService'));
    return;
  }
  try {
    const cfg = getCottageConfig();
    const currentDisabled = new Set(cfg.packs?.disabledBuiltinPacks ?? []);

    if (enabled) {
      currentDisabled.delete(pack.id);
    } else {
      currentDisabled.add(pack.id);
    }

    // 同步 enabledTools：移除被禁用包的工具，添加被启用包的工具
    const currentTools = new Set(cfg.enabledTools ?? []);
    if (enabled) {
      for (const t of pack.toolNames) currentTools.add(t);
    } else {
      for (const t of pack.toolNames) currentTools.delete(t);
    }

    const merged = await saveCottageConfigToWorkspace({
      packs: {
        ...(cfg.packs ?? {}),
        disabledBuiltinPacks: [...currentDisabled],
      },
      enabledTools: [...currentTools],
    });

    // 同步更新内存缓存，使 ChatComposer 等响应式组件感知变化
    setCottageConfig(merged);

    message.success(enabled ? t('settings.packEnabled') : t('settings.packDisabled'));
    emit('refreshLayered');
    await remountAgent();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

const detailVisible = ref(false);
const activeDetail = ref<PackDetail | null>(null);

const python = () => props.config.python;
const layerConfigValue = (layer: 'folder' | 'domain') => props.layeredConfig?.[layer];
const layerSkills = (layer: 'folder' | 'domain') => layerConfigValue(layer)?.skills;

const activeNavLabel = computed(() => {
  if (mainSection.value === 'builtin') return t('settings.capNavBuiltin');
  if (mainSection.value === 'external') return t('settings.capNavExternal');
  const item = BASIC_NAV.find((nav) => nav.key === basicSection.value);
  return item ? t(item.labelKey) : t('settings.capNavBasic');
});

function selectBasic(section: BasicSection) {
  mainSection.value = 'basic';
  basicSection.value = section;
}

function selectMain(section: MainSection) {
  mainSection.value = section;
}

function openDetail(detail: PackDetail) {
  activeDetail.value = detail;
  detailVisible.value = true;
}

const openBuiltinDetail = (pack: BuiltinCapabilityPack) =>
  openDetail(builtinPackDetail(pack));
const openExternalDetail = (row: PackRow) =>
  openDetail(externalPackDetail(row.id, row.manifest, row.version));

const RISK_LEVELS: CapabilityRiskLevel[] = [
  'read',
  'write',
  'external',
  'destructive',
];
type RiskTagType = 'success' | 'info' | 'warning' | 'danger' | 'primary';
const RISK_TAG_TYPE: Record<CapabilityRiskLevel, RiskTagType> = {
  read: 'info',
  write: 'warning',
  external: 'primary',
  destructive: 'danger',
};
const riskLabel = (level: CapabilityRiskLevel) => t(RISK_I18N[level]);
const riskTagType = (level?: CapabilityRiskLevel): RiskTagType =>
  level ? RISK_TAG_TYPE[level] : 'info';
const requireApprovalFor = ref<CapabilityRiskLevel[]>([]);
const stagingReviewEnabled = ref(true);

function loadGovernance() {
  const platform = getCottageConfig().platform;
  requireApprovalFor.value = platform?.governance?.requireApprovalFor ?? [];
  stagingReviewEnabled.value = platform?.stagingReview?.enabled !== false;
}

async function toggleStagingReview(val: string | number | boolean) {
  const enabled = Boolean(val);
  stagingReviewEnabled.value = enabled;
  try {
    await saveCottageConfigToWorkspace({
      platform: { stagingReview: { enabled } },
    });
    message.success(enabled ? t('settings.stagingEnabled') : t('settings.stagingDisabled'));
    await remountAgent();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function toggleRisk(level: CapabilityRiskLevel, checked: boolean) {
  const set = new Set(requireApprovalFor.value);
  if (checked) set.add(level);
  else set.delete(level);
  requireApprovalFor.value = [...set];
  try {
    await saveCottageConfigToWorkspace({
      platform: { governance: { requireApprovalFor: requireApprovalFor.value } },
    });
    message.success(t('settings.approvalUpdated'));
    await remountAgent();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function refresh() {
  loading.value = true;
  try {
    const list = await loadAllPackManifests('folder');
    rows.value = list.map(({ ref, manifest }) => ({
      id: ref.id,
      enabled: ref.enabled !== false,
      installedAt: ref.installedAt,
      version: ref.version ?? manifest?.version,
      manifest,
    }));
  } finally {
    loading.value = false;
  }
}

async function refreshDomain() {
  loadingDomain.value = true;
  try {
    const list = await loadAllPackManifests('domain');
    domainRows.value = list.map(({ ref, manifest }) => ({
      id: ref.id,
      enabled: ref.enabled !== false,
      installedAt: ref.installedAt,
      version: ref.version ?? manifest?.version,
      manifest,
    }));
  } finally {
    loadingDomain.value = false;
  }
}

onMounted(() => {
  loadGovernance();
  void refresh();
  void refreshDomain();
});

async function remountAgent() {
  if (!agentStore.activeChatId) return;
  await agentStore.reloadSecrets({ remount: true });
}

async function updateSkillsLayer(
  layer: 'folder' | 'domain',
  patch: Partial<NonNullable<CottageConfig['skills']>>,
  options?: { silent?: boolean },
) {
  await saveLayeredCottageConfig(
    { skills: { ...(layerSkills(layer) ?? {}), ...patch } },
    { level: layer },
  );
  if (!options?.silent) {
    message.success(
      t('settings.skillsUpdated', {
        layer: layer === 'folder' ? t('settings.skillsLocal') : t('settings.skillsDomain'),
      }),
    );
  }
  emit('refreshLayered');
}

async function transferSkillSetting(
  key: 'builtinCatalogEnabled' | 'respectFrontmatterEnabled',
  fromLayer: 'folder' | 'domain',
) {
  const value = layerSkills(fromLayer)?.[key] ?? true;
  const oppositeLayer = fromLayer === 'folder' ? 'domain' : 'folder';
  await updateSkillsLayer(oppositeLayer, { [key]: value }, { silent: true });
  const keyLabel =
    key === 'builtinCatalogEnabled'
      ? t('settings.enableBuiltinSkills')
      : t('settings.respectFrontmatterEnabled');
  message.success(
    t('settings.skillSynced', {
      key: keyLabel,
      action: value ? t('settings.skillActionOn') : t('settings.skillActionOff'),
      layer:
        oppositeLayer === 'folder' ? t('settings.layerWorkspace') : t('settings.layerGlobal'),
    }),
  );
}

/**
 * 两侧均已显式写入且值相同时才禁用同步。
 * 不能对 undefined 套相同默认值再比较，否则「工作区 true / 全局未配置」会被误判为相同，
 * 导致「同步到全局」永远点不了。
 */
function isSkillSettingSame(
  key: 'builtinCatalogEnabled' | 'respectFrontmatterEnabled',
): boolean {
  const folderVal = layerSkills('folder')?.[key];
  const domainVal = layerSkills('domain')?.[key];
  if (folderVal === undefined || domainVal === undefined) return false;
  return folderVal === domainVal;
}

async function handleInstallSample(layer?: 'folder' | 'domain') {
  try {
    await installCapabilityPack(SAMPLE_WRITING_REVIEW_PACK, { level: layer ?? 'folder' });
    message.success(t('settings.samplePackInstalled'));
    if (layer === 'domain') await refreshDomain();
    else await refresh();
    await remountAgent();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

function openFilePicker(layer?: 'folder' | 'domain') {
  if (layer === 'domain') fileInputDomainRef.value?.click();
  else fileInputRef.value?.click();
}

async function handleImportFile(event: Event, layer?: 'folder' | 'domain') {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const raw = JSON.parse(text) as unknown;
    validateCapabilityPackManifest(raw);
    await installCapabilityPack(raw, { level: layer ?? 'folder' });
    message.success(t('settings.packInstalled', { name: file.name }));
    if (layer === 'domain') await refreshDomain();
    else await refresh();
    await remountAgent();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function handleToggle(row: PackRow, enabled: boolean, layer?: 'folder' | 'domain') {
  try {
    await setCapabilityPackEnabled(row.id, enabled, layer);
    row.enabled = enabled;
    message.success(enabled ? t('settings.packEnabled') : t('settings.packDisabled'));
    await remountAgent();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function handleUninstall(row: PackRow, layer?: 'folder' | 'domain') {
  try {
    await uninstallCapabilityPack(row.id, layer);
    message.success(t('settings.packRemoved'));
    if (layer === 'domain') await refreshDomain();
    else await refresh();
    await remountAgent();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

async function handleTransferPack(row: PackRow, fromLayer: 'folder' | 'domain') {
  if (!row.manifest) {
    message.error(t('settings.cannotReadManifest'));
    return;
  }
  const toLayer = fromLayer === 'folder' ? 'domain' : 'folder';
  const toLabel = toLayer === 'folder' ? t('settings.layerWorkspace') : t('settings.layerGlobal');
  try {
    await installCapabilityPack(row.manifest, { level: toLayer });
    message.success(t('settings.packCopiedTo', { name: row.manifest.name, layer: toLabel }));
    if (toLayer === 'domain') await refreshDomain();
    else await refresh();
    await remountAgent();
  } catch (error) {
    message.error(error instanceof Error ? error.message : String(error));
  }
}

const formatDate = (ts: number) => new Date(ts).toLocaleString();
</script>

<template>
  <div class="capability-config">
    <aside class="capability-config-sidebar">
      <div class="capability-config-nav-group">
        <NText class="capability-config-nav-heading">{{ t('settings.capNavBasic') }}</NText>
        <button
          v-for="item in BASIC_NAV"
          :key="item.key"
          type="button"
          class="capability-config-nav-item"
          :class="{
            'capability-config-nav-item--active':
              mainSection === 'basic' && basicSection === item.key,
          }"
          @click="selectBasic(item.key)"
        >
          {{ t(item.labelKey) }}
        </button>
      </div>

      <div class="capability-config-nav-group">
        <button
          type="button"
          class="capability-config-nav-item capability-config-nav-item--section"
          :class="{ 'capability-config-nav-item--active': mainSection === 'builtin' }"
          @click="selectMain('builtin')"
        >
          {{ t('settings.capNavBuiltin') }}
        </button>
        <button
          type="button"
          class="capability-config-nav-item capability-config-nav-item--section"
          :class="{ 'capability-config-nav-item--active': mainSection === 'external' }"
          @click="selectMain('external')"
        >
          {{ t('settings.capNavExternal') }}
        </button>
      </div>
    </aside>

    <div class="capability-config-main">
      <NText tag="h2" class="capability-config-main-title">{{ activeNavLabel }}</NText>

      <!-- 基础能力：文件与工具（直接列出工具，不弹详情） -->
      <template v-if="mainSection === 'basic' && basicSection === 'overview'">
        <NText depth="3" class="settings-panel-lead">
          {{ t('settings.overviewLead') }}
        </NText>
        <div class="settings-section-block capability-packs-section">
          <div class="capability-packs-card-header">
            <div>
              <NText strong>{{ packName(baseDetail.id, baseDetail.name) }}</NText>
              <NText depth="3" class="capability-packs-meta">
                {{ t('settings.toolsCount', { n: baseDetail.tools.length }) }}
              </NText>
            </div>
            <ElTag size="small" type="success">{{ t('settings.alwaysAvailable') }}</ElTag>
          </div>
          <NText depth="3" class="capability-packs-desc">
            {{ packDesc(baseDetail.id, baseDetail.description ?? '') }}
          </NText>
          <div v-if="baseDetail.tools.length" class="capability-base-tools">
            <div
              v-for="tool in baseDetail.tools"
              :key="tool.name"
              class="capability-base-tool"
            >
              <div class="capability-base-tool-head">
                <code class="capability-base-tool-name">{{ tool.name }}</code>
                <ElTag
                  v-if="tool.riskLevel"
                  size="small"
                  :type="riskTagType(tool.riskLevel)"
                  disable-transitions
                >
                  {{ riskLabel(tool.riskLevel) }}
                </ElTag>
              </div>
              <NText v-if="tool.description" depth="3" class="capability-base-tool-desc">
                {{ tool.description }}
              </NText>
            </div>
          </div>
          <NText v-else depth="3">{{ t('settings.noToolsViaCaps') }}</NText>
        </div>
      </template>

      <!-- 基础能力：联网搜索 -->
      <template v-else-if="mainSection === 'basic' && basicSection === 'web-search'">
        <NText depth="3" class="settings-panel-lead">
          {{ t('settings.webSearchLead') }}
        </NText>
        <div class="settings-section-block">
          <WebSearchFields />
        </div>
      </template>

      <!-- 基础能力：MCP -->
      <template v-else-if="mainSection === 'basic' && basicSection === 'mcp'">
        <NText depth="3" class="settings-panel-lead">
          {{ t('settings.mcpLead') }}
        </NText>
        <LayerTabs>
          <template #folder>
            <McpServersFields layer="folder" />
          </template>
          <template #domain>
            <McpServersFields layer="domain" />
          </template>
        </LayerTabs>
      </template>

      <!-- 基础能力：技能 -->
      <template v-else-if="mainSection === 'basic' && basicSection === 'skills'">
        <NText depth="3" class="settings-panel-lead">
          {{ t('settings.skillsLead') }}
        </NText>
        <LayerTabs>
          <template #folder>
            <div class="settings-section-block settings-section-block--flat">
              <ElForm label-position="top" class="ai-settings-form">
                <ElFormItem :label="t('settings.enableBuiltinSkills')">
                  <div style="display: flex; align-items: center; gap: 8px">
                    <ElSwitch
                      :model-value="layerSkills('folder')?.builtinCatalogEnabled ?? true"
                      @update:model-value="(v) => updateSkillsLayer('folder', { builtinCatalogEnabled: Boolean(v) })"
                    />
                    <CottageTooltip :content="t('settings.syncToGlobal')" placement="top">
                      <span>
                        <ElButton
                          text
                          size="small"
                          :disabled="isSkillSettingSame('builtinCatalogEnabled')"
                          @click="transferSkillSetting('builtinCatalogEnabled', 'folder')"
                        >
                          <template #icon><NIcon :component="ArrowForwardOutline" /></template>
                        </ElButton>
                      </span>
                    </CottageTooltip>
                  </div>
                </ElFormItem>
                <ElFormItem :label="t('settings.respectFrontmatterEnabled')">
                  <div style="display: flex; align-items: center; gap: 8px">
                    <ElSwitch
                      :model-value="layerSkills('folder')?.respectFrontmatterEnabled ?? true"
                      @update:model-value="(v) => updateSkillsLayer('folder', { respectFrontmatterEnabled: Boolean(v) })"
                    />
                    <CottageTooltip :content="t('settings.syncToGlobal')" placement="top">
                      <span>
                        <ElButton
                          text
                          size="small"
                          :disabled="isSkillSettingSame('respectFrontmatterEnabled')"
                          @click="transferSkillSetting('respectFrontmatterEnabled', 'folder')"
                        >
                          <template #icon><NIcon :component="ArrowForwardOutline" /></template>
                        </ElButton>
                      </span>
                    </CottageTooltip>
                  </div>
                  <NText depth="3" class="settings-form-item-hint">
                    {{ t('settings.skillsFrontmatterHint') }}
                  </NText>
                </ElFormItem>
              </ElForm>
            </div>
          </template>
          <template #domain>
            <div class="settings-section-block settings-section-block--flat">
              <ElForm label-position="top" class="ai-settings-form">
                <ElFormItem :label="t('settings.enableBuiltinSkills')">
                  <div style="display: flex; align-items: center; gap: 8px">
                    <ElSwitch
                      :model-value="layerSkills('domain')?.builtinCatalogEnabled ?? true"
                      @update:model-value="(v) => updateSkillsLayer('domain', { builtinCatalogEnabled: Boolean(v) })"
                    />
                    <CottageTooltip :content="t('settings.syncToWorkspace')" placement="top">
                      <span>
                        <ElButton
                          text
                          size="small"
                          :disabled="isSkillSettingSame('builtinCatalogEnabled')"
                          @click="transferSkillSetting('builtinCatalogEnabled', 'domain')"
                        >
                          <template #icon><NIcon :component="ArrowForwardOutline" /></template>
                        </ElButton>
                      </span>
                    </CottageTooltip>
                  </div>
                </ElFormItem>
                <ElFormItem :label="t('settings.respectFrontmatterEnabled')">
                  <div style="display: flex; align-items: center; gap: 8px">
                    <ElSwitch
                      :model-value="layerSkills('domain')?.respectFrontmatterEnabled ?? true"
                      @update:model-value="(v) => updateSkillsLayer('domain', { respectFrontmatterEnabled: Boolean(v) })"
                    />
                    <CottageTooltip :content="t('settings.syncToWorkspace')" placement="top">
                      <span>
                        <ElButton
                          text
                          size="small"
                          :disabled="isSkillSettingSame('respectFrontmatterEnabled')"
                          @click="transferSkillSetting('respectFrontmatterEnabled', 'domain')"
                        >
                          <template #icon><NIcon :component="ArrowForwardOutline" /></template>
                        </ElButton>
                      </span>
                    </CottageTooltip>
                  </div>
                  <NText depth="3" class="settings-form-item-hint">
                    {{ t('settings.skillsFrontmatterHint') }}
                  </NText>
                </ElFormItem>
              </ElForm>
            </div>
          </template>
        </LayerTabs>
      </template>

      <!-- 基础能力：执行脚本（runScript JS/TS）；Python/Pyodide 配置见下方 [HIDDEN] -->
      <template v-else-if="mainSection === 'basic' && basicSection === 'script'">
        <NText depth="3" class="settings-panel-lead">
          {{ t('settings.scriptLead') }}
        </NText>
        <!-- [HIDDEN] Python 数据分析：随 builtin.data-analysis 隐藏；恢复时去掉 v-if="false" -->
        <div v-if="false" class="settings-section-block settings-section-block--flat">
          <ElForm label-position="top" class="ai-settings-form">
            <div class="ai-settings-switch-group">
              <ElFormItem :label="t('settings.enablePython')">
                <ElSwitch :model-value="python()?.enabled ?? false" disabled />
              </ElFormItem>
              <ElFormItem :label="t('settings.allowMicropip')">
                <ElSwitch :model-value="python()?.allowMicropip ?? false" disabled />
              </ElFormItem>
            </div>
            <ElFormItem :label="t('settings.pyodideSource')">
              <CottageSelect
                disabled
                :model-value="python()?.pyodideSource ?? 'cdn'"
                :options="pyodideSourceOptions"
              />
            </ElFormItem>
            <ElFormItem :label="t('settings.scriptTimeout')">
              <ElInputNumber
                disabled
                :value="python()?.timeoutMs ?? 120_000"
              />
            </ElFormItem>
          </ElForm>
        </div>
      </template>

      <!-- 基础能力：治理策略 -->
      <template v-else-if="mainSection === 'basic' && basicSection === 'governance'">
        <NText depth="3" class="settings-panel-lead">
          {{ t('settings.governanceLead') }}
        </NText>
        <div class="settings-section-block capability-packs-section">
          <NText tag="h3" class="settings-section-title">{{ t('settings.riskLevelsTitle') }}</NText>
          <NText depth="3" class="capability-packs-hint">
            {{ t('settings.riskLevelsHint') }}
          </NText>
          <div class="capability-packs-risks" style="margin-top: 8px">
            <ElCheckbox
              v-for="level in RISK_LEVELS"
              :key="level"
              :model-value="requireApprovalFor.includes(level)"
              :disabled="!workspaceStore.snapshot"
              @update:model-value="(v) => toggleRisk(level, Boolean(v))"
            >
              {{ riskLabel(level) }}
            </ElCheckbox>
          </div>
        </div>

        <div class="settings-section-block capability-packs-section">
          <NText tag="h3" class="settings-section-title">{{ t('settings.stagingReviewTitle') }}</NText>
          <NText depth="3" class="capability-packs-hint">
            {{ t('settings.stagingReviewHint') }}
          </NText>
          <div class="capability-packs-plan-gate settings-toggle-row" style="margin-top: 10px">
            <NText class="settings-field-label">{{ t('settings.enableStagingReview') }}</NText>
            <ElSwitch
              :model-value="stagingReviewEnabled"
              :disabled="!workspaceStore.snapshot"
              @update:model-value="toggleStagingReview"
            />
          </div>
        </div>
      </template>

      <!-- 内置能力 -->
      <template v-else-if="mainSection === 'builtin'">
        <NText depth="3" class="settings-panel-lead">
          {{ t('settings.builtinLead') }}
        </NText>
        <div class="capability-packs-list">
          <ElCard
            v-for="pack in visibleBuiltinPacks"
            :key="pack.id"
            shadow="never"
            class="capability-packs-card capability-packs-card--clickable"
            @click="openBuiltinDetail(pack)"
          >
            <div class="capability-packs-card-header">
              <div>
                <NText strong>{{ packName(pack.id, pack.name) }}</NText>
                <NText depth="3" class="capability-packs-meta">
                  {{ pack.domain }} · {{ t('settings.toolCount', { n: pack.toolNames.length }) }}
                </NText>
              </div>
              <CottageTooltip
                :content="t('settings.packRequiresCottageService')"
                :disabled="isBuiltinPackCottageReady(pack)"
                placement="top"
                delay="instant"
              >
                <span>
                  <ElSwitch
                    :model-value="isBuiltinPackEnabled(pack) && isBuiltinPackCottageReady(pack)"
                    :disabled="!isBuiltinPackCottageReady(pack)"
                    @click.stop
                    @update:model-value="(v) => handleToggleBuiltinPack(pack, Boolean(v))"
                  />
                </span>
              </CottageTooltip>
            </div>
            <NText depth="3" class="capability-packs-desc">
              {{ packDesc(pack.id, pack.description) }}
            </NText>
            <NText
              v-if="pack.requiresCottageServiceCapabilities?.length && !isBuiltinPackCottageReady(pack)"
              depth="3"
              class="capability-packs-meta"
              style="display: block; margin-top: 6px"
            >
              {{ t('settings.packRequiresCottageService') }}
            </NText>
          </ElCard>
        </div>
      </template>

      <!-- 第三方能力 -->
      <template v-else-if="mainSection === 'external'">
        <NText depth="3" class="settings-panel-lead">
          {{ t('settings.externalLead') }}
        </NText>

        <LayerTabs>
          <template #folder>
            <div v-if="!workspaceStore.snapshot" class="capability-packs-empty">
              <NText depth="3">{{ t('settings.openWsManagePacks') }}</NText>
            </div>
            <template v-else>
              <div class="capability-packs-actions">
                <ElButton type="primary" @click="handleInstallSample('folder')">
                  <template #icon>
                    <NIcon :component="CloudDownloadOutline" />
                  </template>
                  {{ t('settings.installSamplePack') }}
                </ElButton>
                <ElButton @click="openFilePicker('folder')">{{ t('settings.importManifest') }}</ElButton>
                <input
                  ref="fileInputRef"
                  type="file"
                  accept="application/json,.json"
                  hidden
                  @change="(e) => handleImportFile(e, 'folder')"
                />
              </div>
              <div v-if="loading" style="margin-top: 16px">
                <NText depth="3">{{ t('common.loading') }}</NText>
              </div>
              <div v-else-if="rows.length === 0" class="capability-packs-empty">
                <NText depth="3">{{ t('settings.noExternalPacks') }}</NText>
              </div>
              <div v-else class="capability-packs-list">
                <ElCard
                  v-for="row in rows"
                  :key="row.id"
                  shadow="never"
                  class="capability-packs-card capability-packs-card--clickable"
                  @click="openExternalDetail(row)"
                >
                  <div class="capability-packs-card-header">
                    <div>
                      <NText strong>{{ row.manifest?.name ?? row.id }}</NText>
                      <NText depth="3" class="capability-packs-meta">
                        {{ row.id }}
                        <template v-if="row.version"> · v{{ row.version }}</template>
                        · {{ formatDate(row.installedAt) }}
                      </NText>
                    </div>
                    <ElSwitch
                      :model-value="row.enabled"
                      @click.stop
                      @update:model-value="(v) => handleToggle(row, Boolean(v), 'folder')"
                    />
                  </div>
                  <NText v-if="row.manifest?.description" depth="3" class="capability-packs-desc">
                    {{ row.manifest.description }}
                  </NText>
                  <div v-if="row.manifest" class="capability-packs-tags">
                    <ElTag v-if="row.manifest.capabilities?.length" size="small" type="info">
                      {{ t('settings.capabilityCount', { n: row.manifest.capabilities.length }) }}
                    </ElTag>
                    <ElTag v-if="row.manifest.skills?.length" size="small">
                      {{ t('settings.skillCount', { n: row.manifest.skills.length }) }}
                    </ElTag>
                    <ElTag v-if="row.manifest.promptOverlay" size="small" type="warning">
                      {{ t('settings.hasPrompt') }}
                    </ElTag>
                    <ElTag v-if="row.manifest.mcpServers?.length" size="small" type="success">
                      MCP × {{ row.manifest.mcpServers.length }}
                    </ElTag>
                  </div>
                  <div class="capability-packs-card-footer">
                    <ElButton size="small" type="danger" text @click.stop="handleUninstall(row, 'folder')">
                      <template #icon><NIcon :component="TrashOutline" /></template>
                      {{ t('common.remove') }}
                    </ElButton>
                    <ElButton size="small" text @click.stop="handleTransferPack(row, 'folder')">
                      <template #icon><NIcon :component="ArrowForwardOutline" /></template>
                      {{ t('settings.copyToGlobal') }}
                    </ElButton>
                  </div>
                </ElCard>
              </div>
            </template>
          </template>

          <template #domain>
            <div class="capability-packs-actions">
              <ElButton type="primary" @click="handleInstallSample('domain')">
                <template #icon>
                  <NIcon :component="CloudDownloadOutline" />
                </template>
                {{ t('settings.installSamplePack') }}
              </ElButton>
              <ElButton @click="openFilePicker('domain')">{{ t('settings.importManifest') }}</ElButton>
              <input
                ref="fileInputDomainRef"
                type="file"
                accept="application/json,.json"
                hidden
                @change="(e) => handleImportFile(e, 'domain')"
              />
            </div>
            <div v-if="loadingDomain" style="margin-top: 16px">
              <NText depth="3">{{ t('common.loading') }}</NText>
            </div>
            <div v-else-if="domainRows.length === 0" class="capability-packs-empty">
              <NText depth="3">{{ t('settings.noDomainPacks') }}</NText>
            </div>
            <div v-else class="capability-packs-list">
              <ElCard
                v-for="row in domainRows"
                :key="row.id"
                shadow="never"
                class="capability-packs-card capability-packs-card--clickable"
                @click="openExternalDetail(row)"
              >
                <div class="capability-packs-card-header">
                  <div>
                    <NText strong>{{ row.manifest?.name ?? row.id }}</NText>
                    <NText depth="3" class="capability-packs-meta">
                      {{ row.id }}
                      <template v-if="row.version"> · v{{ row.version }}</template>
                      · {{ formatDate(row.installedAt) }}
                    </NText>
                  </div>
                  <ElSwitch
                    :model-value="row.enabled"
                    @click.stop
                    @update:model-value="(v) => handleToggle(row, Boolean(v), 'domain')"
                  />
                </div>
                <NText v-if="row.manifest?.description" depth="3" class="capability-packs-desc">
                  {{ row.manifest.description }}
                </NText>
                <div v-if="row.manifest" class="capability-packs-tags">
                  <ElTag v-if="row.manifest.capabilities?.length" size="small" type="info">
                    {{ t('settings.capabilityCount', { n: row.manifest.capabilities.length }) }}
                  </ElTag>
                  <ElTag v-if="row.manifest.skills?.length" size="small">
                    {{ t('settings.skillCount', { n: row.manifest.skills.length }) }}
                  </ElTag>
                  <ElTag v-if="row.manifest.promptOverlay" size="small" type="warning">
                    {{ t('settings.hasPrompt') }}
                  </ElTag>
                  <ElTag v-if="row.manifest.mcpServers?.length" size="small" type="success">
                    MCP × {{ row.manifest.mcpServers.length }}
                  </ElTag>
                </div>
                <div class="capability-packs-card-footer">
                  <ElButton size="small" type="danger" text @click.stop="handleUninstall(row, 'domain')">
                    <template #icon><NIcon :component="TrashOutline" /></template>
                    {{ t('common.remove') }}
                  </ElButton>
                  <ElButton size="small" text @click.stop="handleTransferPack(row, 'domain')">
                    <template #icon><NIcon :component="ArrowForwardOutline" /></template>
                    {{ t('settings.copyToWorkspace') }}
                  </ElButton>
                </div>
              </ElCard>
            </div>
          </template>
        </LayerTabs>
      </template>
    </div>

    <PackDetailDialog v-model="detailVisible" :detail="activeDetail" />
  </div>
</template>

<style scoped>
.capability-config {
  display: flex;
  gap: 20px;
  min-height: 360px;
  align-items: flex-start;
}

.capability-config-sidebar {
  flex: none;
  width: 148px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-right: 12px;
  border-right: 1px solid var(--el-border-color-lighter);
}

.capability-config-nav-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.capability-config-nav-heading {
  display: block;
  padding: 4px 10px 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--cottage-muted);
}

.capability-config-nav-item {
  display: block;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: var(--cottage-radius);
  background: transparent;
  text-align: left;
  font-size: var(--cottage-font-sm);
  color: var(--cottage-ink);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.capability-config-nav-item:hover {
  background: var(--cottage-accent-bg);
}

.capability-config-nav-item--active {
  background: var(--cottage-accent-bg);
  color: var(--el-color-primary);
  font-weight: 500;
}

.capability-config-nav-item--section {
  font-weight: 500;
}

.capability-config-main {
  flex: 1;
  min-width: 0;
}

.capability-config-main-title {
  margin: 0 0 var(--cottage-space-md);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--cottage-ink);
}

.capability-packs-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.capability-packs-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.capability-packs-card--clickable {
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.capability-packs-card--clickable:hover {
  border-color: var(--cottage-accent-border, var(--el-color-primary));
  box-shadow: var(--cottage-shadow-card-hover);
}

.capability-packs-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.capability-packs-meta {
  display: block;
  margin-top: 4px;
  font-size: 12px;
}

.capability-packs-desc {
  display: block;
  margin-top: 8px;
}

.capability-base-tools {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  margin-top: 14px;
}

.capability-base-tool {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  background: var(--el-fill-color-blank, transparent);
}

.capability-base-tool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.capability-base-tool-name {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-primary);
  word-break: break-all;
}

.capability-base-tool-desc {
  font-size: 12px;
  line-height: 1.5;
}

.capability-packs-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.capability-packs-card-footer {
  margin-top: 10px;
}

.capability-packs-empty {
  padding: 12px 0;
}

.capability-packs-section {
  margin-bottom: 20px;
}

.capability-packs-hint {
  display: block;
  font-size: 12px;
}

.capability-packs-risks {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.capability-packs-plan-gate,
.settings-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px var(--cottage-space-sm);
  margin: 0 calc(-1 * var(--cottage-space-sm));
  border-radius: var(--cottage-radius);
  transition: background-color 0.15s ease;
}

.capability-packs-plan-gate:hover,
.settings-toggle-row:hover {
  background: var(--cottage-accent-bg);
}

.settings-toggle-row .settings-field-label,
.capability-packs-plan-gate .settings-field-label {
  pointer-events: none;
  user-select: none;
  font-size: var(--cottage-font-sm);
  color: var(--cottage-muted);
}

.capability-packs-plan-gate .el-switch,
.settings-toggle-row .el-switch {
  width: fit-content;
  flex-shrink: 0;
}
</style>