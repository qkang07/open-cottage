/**
 * LLM 提供商注册表：厂商元数据（标签、默认模型、Base URL 等）。
 * 可选模型列表由 modelCatalog.ts 从 LLM 代理 / 厂商 API / models.dev 动态拉取。
 */

export type LlmProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'openai_compatible'
  | 'deepseek'
  | 'moonshot'
  | 'zhipu'
  | 'dashscope'
  | 'doubao'
  | 'qianfan'
  | 'hunyuan'
  | 'minimax'
  | 'siliconflow'
  | 'lingyi'
  | 'stepfun'
  | 'baichuan';

export type LlmProviderRegion = 'international' | 'china';

export type LlmProviderKind =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openai_compatible';

export interface LlmModelOption {
  id: string;
  label: string;
  hint?: string;
  /** 出品方/厂商（聚合器场景由模型 id 前缀解析，如 anthropic/claude → anthropic） */
  vendor?: string;
  /** 是否支持 temperature 参数；`false` 表示模型不支持/固定值 */
  temperature?: boolean;
  /** 是否具备推理/思考能力 */
  reasoning?: boolean;
  /**
   * 可调思考强度（effort）取值列表。
   * 有非空数组时表示支持设置思考强度；仅有 reasoning 而无此字段表示仅开关/固定推理。
   */
  reasoningEffortValues?: string[];
  /** 是否支持显式开关思考（models.dev `reasoning_options` 含 toggle） */
  reasoningToggle?: boolean;
  /** 是否支持图片输入（输入模态含 image）；仅 `true` 表示已确认支持 */
  vision?: boolean;
  /** 是否支持模型工具调用；缺省表示目录未声明 */
  tools?: boolean;
  /** 最大上下文窗口（tokens） */
  contextLimit?: number;
  /** 最大输出 tokens */
  outputLimit?: number;
}

export interface LlmProviderDefinition {
  id: LlmProviderId;
  label: string;
  region: LlmProviderRegion;
  kind: LlmProviderKind;
  defaultBaseUrl?: string;
  defaultModel: string;
  /** 已保存的模型不在列表中时仍保留（如豆包接入点 ID） */
  allowCustomModel?: boolean;
  allowCustomBaseUrl?: boolean;
  /** 聚合器：一把 Key 提供跨厂商的大量模型，模型选择器按出品方分组/筛选 */
  isAggregator?: boolean;
  docUrl?: string;
}

export const LLM_PROVIDER_DEFINITIONS: readonly LlmProviderDefinition[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    region: 'international',
    kind: 'openai',
    defaultModel: 'gpt-4o-mini',
    docUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    region: 'international',
    kind: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    docUrl: 'https://console.anthropic.com/',
  },
  {
    id: 'google',
    label: 'Google Gemini',
    region: 'international',
    kind: 'google',
    defaultModel: 'gemini-2.0-flash',
    docUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    region: 'international',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4o-mini',
    allowCustomModel: true,
    allowCustomBaseUrl: true,
    isAggregator: true,
    docUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 深度求索',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    docUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi 月之暗面',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    docUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    docUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'dashscope',
    label: '阿里通义千问',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    docUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'doubao',
    label: '字节豆包（火山方舟）',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-1-5-pro-32k',
    allowCustomModel: true,
    allowCustomBaseUrl: true,
    docUrl: 'https://console.volcengine.com/ark',
  },
  {
    id: 'qianfan',
    label: '百度千帆',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://qianfan.baidubce.com/v2',
    defaultModel: 'ernie-4.0-8k',
    docUrl: 'https://console.bce.baidu.com/qianfan/',
  },
  {
    id: 'hunyuan',
    label: '腾讯混元',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    defaultModel: 'hunyuan-pro',
    docUrl: 'https://cloud.tencent.com/product/hunyuan',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'abab6.5s-chat',
    docUrl: 'https://platform.minimaxi.com/',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    isAggregator: true,
    docUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'lingyi',
    label: '零一万物 Yi',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://api.lingyiwanwu.com/v1',
    defaultModel: 'yi-large',
    docUrl: 'https://platform.lingyiwanwu.com/',
  },
  {
    id: 'stepfun',
    label: '阶跃星辰 Step',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://api.stepfun.com/v1',
    defaultModel: 'step-2-16k',
    docUrl: 'https://platform.stepfun.com/',
  },
  {
    id: 'baichuan',
    label: '百川智能',
    region: 'china',
    kind: 'openai_compatible',
    defaultBaseUrl: 'https://api.baichuan-ai.com/v1',
    defaultModel: 'Baichuan4',
    docUrl: 'https://platform.baichuan-ai.com/',
  },
  {
    id: 'openai_compatible',
    label: '自定义 OpenAI 兼容',
    region: 'china',
    kind: 'openai_compatible',
    defaultModel: 'gpt-4o-mini',
    allowCustomModel: true,
    allowCustomBaseUrl: true,
  },
] as const;

const byId = new Map<LlmProviderId, LlmProviderDefinition>(
  LLM_PROVIDER_DEFINITIONS.map((d) => [d.id, d]),
);

export const getProviderDefinition = (
  id: LlmProviderId,
): LlmProviderDefinition => {
  const def = byId.get(id);
  if (!def) {
    throw new Error(`未知提供商: ${id}`);
  }
  return def;
};

export const isKnownProviderId = (id: string): id is LlmProviderId =>
  byId.has(id as LlmProviderId);

export const normalizeProviderId = (id: string): LlmProviderId =>
  isKnownProviderId(id) ? id : 'openai_compatible';

export const VISIBLE_LLM_PROVIDER_DEFINITIONS = LLM_PROVIDER_DEFINITIONS;

export const INTERNATIONAL_PROVIDERS = VISIBLE_LLM_PROVIDER_DEFINITIONS.filter(
  (d) => d.region === 'international',
);

export const CHINA_PROVIDERS = VISIBLE_LLM_PROVIDER_DEFINITIONS.filter(
  (d) => d.region === 'china',
);

const modelListFor = (
  _providerId: LlmProviderId,
  catalogModels?: readonly LlmModelOption[] | null,
): readonly LlmModelOption[] => catalogModels ?? [];

export const isModelInProviderList = (
  providerId: LlmProviderId,
  modelId: string,
  catalogModels?: readonly LlmModelOption[] | null,
): boolean => modelListFor(providerId, catalogModels).some((m) => m.id === modelId);

/**
 * 解析模型 id：优先保留已保存/用户输入；仅在为空时回落默认或目录首项。
 */
export const resolveModelForProvider = (
  providerId: LlmProviderId,
  model?: string,
  catalogModels?: readonly LlmModelOption[] | null,
): string => {
  const def = getProviderDefinition(providerId);
  const trimmed = model?.trim();
  if (trimmed) {
    return trimmed;
  }
  const list = modelListFor(providerId, catalogModels);
  if (list.some((m) => m.id === def.defaultModel)) {
    return def.defaultModel;
  }
  return list[0]?.id ?? def.defaultModel;
};

export interface ModelSelectOption {
  value: string;
  label: string;
  hint?: string;
  legacy?: boolean;
}

/** Ant Design Select 选项；若 savedModel 不在列表且允许自定义则追加一项 */
export const buildModelSelectOptions = (
  providerId: LlmProviderId,
  savedModel?: string,
  catalogModels?: readonly LlmModelOption[] | null,
): ModelSelectOption[] => {
  const def = getProviderDefinition(providerId);
  const options: ModelSelectOption[] = modelListFor(providerId, catalogModels).map(
    (m) => ({
      value: m.id,
      label: m.label,
      hint: m.hint,
    }),
  );

  const trimmed = savedModel?.trim();
  if (trimmed && !options.some((o) => o.value === trimmed)) {
    options.push({
      value: trimmed,
      label: trimmed,
      hint: def.allowCustomModel
        ? '已保存的接入点 / 自定义模型'
        : '已保存的模型',
      legacy: true,
    });
  }

  return options;
};

const OFFICIAL_PROVIDER_BASE_URLS: Partial<Record<LlmProviderKind, string>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
};

export const hasCustomLlmBaseUrl = (
  configBaseUrl?: string,
  secretBaseUrl?: string,
): boolean => Boolean(configBaseUrl?.trim() || secretBaseUrl?.trim());

export const resolveLlmBaseUrl = (
  providerId: LlmProviderId,
  configBaseUrl?: string,
  secretBaseUrl?: string,
): string | undefined => {
  const custom = configBaseUrl?.trim() || secretBaseUrl?.trim();
  if (custom) return custom.replace(/\/$/, '');

  const def = getProviderDefinition(providerId);
  if (def.defaultBaseUrl) return def.defaultBaseUrl.replace(/\/$/, '');
  return OFFICIAL_PROVIDER_BASE_URLS[def.kind]?.replace(/\/$/, '');
};

export const providerNeedsBaseUrlField = (providerId: LlmProviderId): boolean => {
  const def = getProviderDefinition(providerId);
  return def.kind === 'openai_compatible' && Boolean(def.allowCustomBaseUrl);
};

export const providerLabel = (providerId: LlmProviderId): string =>
  getProviderDefinition(providerId).label;

/** 是否为聚合器提供商（一把 Key 跨厂商大量模型，模型选择器按出品方分组/筛选） */
export const isAggregatorProvider = (providerId: LlmProviderId): boolean =>
  getProviderDefinition(providerId).isAggregator === true;

/**
 * 第一层「模型原生联网搜索」能力判定（best-effort 白名单）。
 * 各厂商注入方式差异较大，此处仅判断「是否可尝试」，具体参数见 agent/nativeWebSearch.ts。
 * 未在白名单中的厂商（如 deepseek）返回 false。
 */
export const providerSupportsNativeSearch = (
  providerId: LlmProviderId,
  _model?: string,
): boolean => {
  switch (providerId) {
    case 'google':
    case 'anthropic':
    case 'zhipu':
    case 'dashscope':
    case 'moonshot':
    case 'openai':
      return true;
    default:
      return false;
  }
};

/**
 * 从模型 id 解析出品方/厂商。
 * 聚合器模型 id 多为 `vendor/slug`（如 `anthropic/claude-3.5-sonnet`、
 * `deepseek-ai/DeepSeek-V3`），取首个 `/` 前的段作为出品方；无 `/` 时返回 undefined。
 */
export const parseModelVendor = (modelId: string): string | undefined => {
  const trimmed = modelId.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return undefined;
  return trimmed.slice(0, slash);
};
