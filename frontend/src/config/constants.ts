export const COTTAGE_DIR = '.cottage';
/** 工作空间根目录下的技能目录；存在时将其中的 .md 编入 Agent 技能索引 */
export const WORKSPACE_SKILLS_DIR = 'SKILLS';
export const COTTAGE_CONFIG_FILE = 'config.json';
export const COTTAGE_CHAT_HISTORY_FILE = 'chat-history.json';
export const COTTAGE_CHATS_INDEX_FILE = 'chats-index.json';
export const COTTAGE_TASKS_INDEX_FILE = 'tasks-index.json';
export const COTTAGE_TASKS_DIR = 'tasks';

export const chatSessionFile = (id: string) => `chat-${id}.json`;

export const taskDir = (taskId: string) => `${COTTAGE_TASKS_DIR}/${taskId}`;

export const taskSpecFile = (taskId: string) => `${taskDir(taskId)}/spec.json`;
export const taskStateFile = (taskId: string) => `${taskDir(taskId)}/state.json`;
export const taskPlanFile = (taskId: string) => `${taskDir(taskId)}/plan.json`;
export const taskManifestFile = (taskId: string) =>
  `${taskDir(taskId)}/manifest.json`;
export const taskCanvasFile = (taskId: string) =>
  `${taskDir(taskId)}/canvas.json`;
export const taskDeliverableFile = (taskId: string) =>
  `${taskDir(taskId)}/deliverable.zip`;
export const taskVerifyFile = (taskId: string) =>
  `${taskDir(taskId)}/verify.json`;
export const taskEventsFile = (taskId: string) => `${taskDir(taskId)}/events.jsonl`;

/** 会话级目录与事件日志（单一 append-only SoT） */
export const COTTAGE_TRACE_DIR = 'trace';
export const traceDir = (sessionId: string) => `sessions/${sessionId}`;
/** 会话事件日志：消息 + 执行节点 + compaction，只追加 */
export const sessionEventsFile = (sessionId: string) =>
  `sessions/${sessionId}/events.jsonl`;
/** 回合暂存改动（待用户批准写入）；可变快照，非 append-only */
export const sessionStagingFile = (sessionId: string) =>
  `sessions/${sessionId}/staging.json`;
/** @deprecated 旧诊断 trace；迁移后并入 events.jsonl */
export const traceFile = (sessionId: string) => `sessions/${sessionId}/trace.jsonl`;
/** 旧路径（迁移兼容）：trace/{sessionId}/trace.jsonl */
export const legacyTraceFile = (sessionId: string) =>
  `${COTTAGE_TRACE_DIR}/${sessionId}/trace.jsonl`;

export const MAX_CHAT_SESSIONS = 50;
export const MAX_RECENT_WORKSPACES = 8;
export const DEFAULT_MAX_TURNS = 30;

import type { StoredMessage } from '../agent/messages';
import type { LlmProviderId } from './llmProviders';

export type { LlmProviderId } from './llmProviders';
export { normalizeProviderId, providerLabel } from './llmProviders';

/** 第二层：预置的第三方搜索 API 提供商 */
export type ThirdPartySearchProviderId =
  | 'tavily'
  | 'bing'
  | 'brave'
  | 'serper'
  | 'exa';

/** 搜索三层来源：模型原生 / 第三方 API / cottage-service */
export type SearchSource = 'native' | 'thirdParty' | 'cottageService';

export interface LlmModelConfig {
  provider: LlmProviderId;
  /** 该模型使用的服务商连接；未指定则使用服务商默认连接。 */
  connectionId?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * 思考强度（reasoning effort）。
   * 仅当模型目录声明支持 effort 档位时生效；常见值：
   * none / minimal / low / medium / high / xhigh / max
   */
  reasoningEffort?: string;
  /**
   * 是否开启思考/推理。
   * 仅对支持 reasoning 的模型有意义；未设置时默认开启（与厂商默认一致）。
   * 显式 `false` 时关闭思考（不下发 effort / 注入 disabled）。
   */
  thinkingEnabled?: boolean;
  /** 覆盖默认 Base URL（OpenAI 兼容厂商） */
  baseUrl?: string;
  /**
   * 模型专属 API Key。
   * 持久化时会被剥离到浏览器 IndexedDB，按模型预设 ID 单独存储，
   * 不会随 .cottage/config.json 写入工作空间。
   */
  apiKey?: string;
}

export interface ModelPreset {
  id: string;
  name: string;
  config: LlmModelConfig;
}

/**
 * 工作区级模型模板。
 * 与 ModelPreset 结构相同，但 apiKey 不会被持久化到工作区，
 * 仅作为快速创建域名模型预设的模板使用。
 */
export interface ModelTemplate {
  id: string;
  name: string;
  config: Omit<LlmModelConfig, 'apiKey'>;
}

// ─── MCP 配置 ───────────────────────────────────────────────────────────────

export type McpTransport = 'streamable-http' | 'sse';

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  enabled?: boolean;
  transport?: McpTransport;
  /** 鉴权 header 名，默认 Authorization */
  authHeader?: string;
}

export interface McpConfig {
  enabled?: boolean;
  servers?: McpServerConfig[];
  proxyUrl?: string;
  onConnectionFail?: 'disable-server' | 'retry';
}

// ─── 多模态 / 图片 ─────────────────────────────────────────────────────────────

export interface VisionConfig {
  enabled?: boolean;
  requireModelCapability?: boolean;
  storage?: 'workspace-file' | 'inline-base64';
  attachmentsDir?: string;
  maxImageBytes?: number;
  maxDimensionPx?: number;
}

/**
 * 图片生成（文生图 / 图生图）。
 * API Key 复用对应生图厂商的 secrets（可独立于对话预设选择厂商）。
 */
export interface ImageGenConfig {
  /** 独立管理的生图模型预设；API Key 归属服务商，不写在预设里。 */
  modelPresets?: ImageGenModelPreset[];
  /** 新工作区或没有历史选择时使用的生图模型。 */
  activePresetId?: string;
  /**
   * 独立生图厂商；未设置 / null 时跟随当前对话模型预设的厂商。
   * 便于「用 Claude 聊天、用 OpenAI 画图」等组合。
   */
  providerOverride?: LlmProviderId | null;
  /** 各厂商生图模型覆盖（缺省用内置清单默认值；null 表示清除覆盖） */
  modelOverrides?: Partial<Record<LlmProviderId, string | null>>;
  /** 默认尺寸，如 '1024x1024'；工具参数优先 */
  defaultSize?: string;
  /** 异步任务（DashScope）轮询总超时（毫秒） */
  pollTimeoutMs?: number;
}

export interface ImageGenModelPreset {
  id: string;
  name: string;
  provider: LlmProviderId;
  connectionId?: string;
  model: string;
  defaultSize?: string;
}

// ─── Pyodide / Python ───────────────────────────────────────────────────────

export interface PythonConfig {
  enabled?: boolean;
  pyodideSource?: 'cdn' | 'bundled';
  cdnBaseUrl?: string;
  timeoutMs?: number;
  allowMicropip?: boolean;
}

// ─── Skills 管理 ────────────────────────────────────────────────────────────

export interface SkillsConfig {
  builtinCatalogEnabled?: boolean;
  respectFrontmatterEnabled?: boolean;
  /**
   * 注入过滤标签白名单。
   * 为空/未设置时注入全部技能；设置后仅注入「含所选标签」或「无任何标签」的技能，
   * 用于技能数量增多时控制系统提示词体积（不影响技能在管理面板可见/可读）。
   */
  activeTags?: string[];
}

export interface CodingIndexConfig {
  enabled?: boolean;
  autoOnOpen?: boolean;
  autoOnMutate?: boolean;
  languages?: string[];
  ignoreGlobs?: string[];
  /** tree-sitter 精确符号解析设置 */
  parser?: {
    /** 是否启用 tree-sitter（关闭则纯正则解析）。默认 true */
    treeSitter?: boolean;
    /** 语法包（tree-sitter-*.wasm）基地址，末尾带 /。缺省用内置 CDN */
    wasmBaseUrl?: string;
    /** 运行时 tree-sitter.wasm 覆盖地址，缺省用打包内置 */
    runtimeWasmUrl?: string;
  };
}

export interface OfficeTemplateConfig {
  enabled?: boolean;
  maxReplacements?: number;
  allowedVariables?: string[];
}

export interface PlatformConfig {
  capabilities?: {
    enabled?: boolean;
  };
  governance?: {
    /** 执行前需用户确认的风险级别 */
    requireApprovalFor?: Array<
      'read' | 'write' | 'external' | 'destructive'
    >;
  };
  planGate?: {
    enabled?: boolean;
    /** 须先提交计划才可执行的风险级别 */
    requirePlanFor?: Array<'read' | 'write' | 'external' | 'destructive'>;
    defaultBudget?: {
      maxFiles?: number;
      maxApiCalls?: number;
      maxTurns?: number;
    };
    /** 提交计划后须用户在 UI 批准才放行，默认 true */
    requireApproval?: boolean;
    /** 小改动（估算 token 低于阈值）可豁免计划闸门 */
    microEditExempt?: boolean;
    microEditMaxTokens?: number;
  };
  /** 执行后缓冲审阅：写工具先落内存暂存区，回合末批量审阅真实 diff 后合并落盘 */
  stagingReview?: {
    enabled?: boolean;
    /** 审批面板内允许单文件就地编辑 after 内容 */
    allowPerFileEdit?: boolean;
    /** 审批面板内允许单文件丢弃 */
    allowPerFileDiscard?: boolean;
  };
}

export interface ContentConfig {
  structuredStore?: {
    enabled?: boolean;
  };
}

export interface InstalledCapabilityPackRef {
  id: string;
  enabled?: boolean;
  installedAt: number;
  version?: string;
  /** 域名层存储时使用：内联完整的 manifest（含 skills / prompt），不依赖文件系统 */
  inlineManifest?: unknown;
}

export interface CapabilityPacksConfig {
  installed?: InstalledCapabilityPackRef[];
  /** 用户在设置页面手动禁用的内置能力包 id 列表 */
  disabledBuiltinPacks?: string[];
}

// ─── Cottage Service（伴随服务，可本地或远端部署）────────────────────────────

/** @deprecated 旧配置键 localAgent 的别名，读取时自动迁移 */
export interface LocalAgentConfig extends CottageServiceConfig {}

export interface CottageServiceConfig {
  /** 是否启用（用户确认连接后置 true） */
  enabled?: boolean;
  /** 用户已确认连接 */
  connected?: boolean;
  /** 服务 Base URL，如 https://127.0.0.1:8787 */
  baseUrl?: string;
  /** 自动探测候选端口（关闭则只校验 baseUrl） */
  autoDiscover?: boolean;
  /** 上次健康检查时间戳 */
  lastHealthAt?: number;
  /** 服务端提供的能力快照：search / fetch / llm */
  capabilities?: string[];
  /** @deprecated 旧版能力勾选，读取时迁移到 useLlm/useSearch/useFetch */
  enabledCapabilities?: string[];
  /** 模型 API 经 Cottage Service HTTP 代理（/proxy） */
  useLlm?: boolean;
  /** 联网搜索经 Cottage Service */
  useSearch?: boolean;
  /** 网页抓取经 Cottage Service */
  useFetch?: boolean;
}

// ─── 本地历史 ───────────────────────────────────────────────────────────────

export interface HistoryConfig {
  enabled?: boolean;
  autoCheckpoint?: boolean;
  manualEditDebounceMs?: number;
  trackGlobs?: string[];
  ignoreGlobs?: string[];
  maxTrackedFiles?: number;
  limits?: {
    /** 单个文件单次进入历史的最大字节数。 */
    maxFileBytes?: number;
    /** 同一路径全部可恢复内容的最大逻辑字节数。 */
    maxBytesPerFile?: number;
    /** `.cottage/history/v2` 的最大物理字节数。 */
    maxPoolBytes?: number;
  };
}

// ─── 本地 RAG ───────────────────────────────────────────────────────────────

export interface RagEmbeddingConfig {
  provider?: 'local' | 'vendor';
  localModel?: 'minilm' | 'bge-small';
  localDevice?: 'auto' | 'wasm' | 'webgpu';
  vendorProvider?: LlmProviderId;
  /** 选用的模型预设 ID（来自模型配置），厂商 API 嵌入时使用 */
  vendorPresetId?: string;
  /** 厂商嵌入模型名（如 text-embedding-3-small）；为空时按预设厂商默认 */
  vendorModel?: string;
  batchSize?: number;
}

export interface RagIndexingConfig {
  autoOnMutate?: boolean;
  autoOnOpen?: boolean;
  /** 全量建库是否在 Web Worker 执行；默认 true */
  useWorker?: boolean;
  chunkSize?: number;
  chunkOverlap?: number;
  ignoreGlobs?: string[];
  indexOfficeText?: boolean;
  /** 分块策略：char 按字符；ast 按符号边界（需 coding AST adapter） */
  chunkStrategy?: 'char' | 'ast';
  /** 全量建库时用 Merkle 目录树跳过未变更子树的 readFile；默认 true */
  useMerkle?: boolean;
}

export interface RagRetrievalConfig {
  topK?: number;
  minScore?: number;
  searchBackend?: 'brute' | 'hnsw';
  bruteForceMaxChunks?: number;
  fallbackToLexical?: boolean;
  agentToolEnabled?: boolean;
}

export interface RagConfig {
  enabled?: boolean;
  embedding?: RagEmbeddingConfig;
  indexing?: RagIndexingConfig;
  retrieval?: RagRetrievalConfig;
}

// ─── CottageConfig 主接口 ───────────────────────────────────────────────────

/** 应用层 LLM 重试配置（独立于 AI SDK 自身的 maxRetries） */
export interface LlmRetryConfig {
  /** 可重试错误（限流/5xx/网络）的最大重试次数 */
  maxRetries?: number;
  /** 首次重试等待基准毫秒（指数退避起点） */
  baseDelayMs?: number;
  /** 单次重试等待上限毫秒 */
  maxDelayMs?: number;
}

/** 长任务上下文自动压缩 */
export interface CompactionConfig {
  /** 是否自动压缩；默认 true */
  auto?: boolean;
  /** 触发阈值（contextTokens / contextWindow）；默认 0.8 */
  threshold?: number;
  /** 保留最近轮次数；默认 4 */
  keepRecentTurns?: number;
  /** 摘要专用小模型；缺省使用主模型 */
  model?: LlmModelConfig;
}

export interface CottageConfig {
  llm?: LlmModelConfig;
  webSearch?: {
    /** 第二层选中的第三方搜索提供商 */
    thirdPartyProvider?: ThirdPartySearchProviderId;
    /** 当前选中的搜索来源；缺省按可用层自动回退 */
    source?: SearchSource;
    /**
     * 第三层（Cottage Service HTTP 检索）首选搜索引擎。
     * 服务端在该引擎失败时会按 baidu → bing → duckduckgo → google 自动降级。
     */
    engine?: 'duckduckgo' | 'bing' | 'baidu' | 'google';
  };
  /** 应用层 LLM 调用重试（缺省使用 DEFAULT_LLM_RETRY_OPTIONS） */
  llmRetry?: LlmRetryConfig;
  /** 长任务上下文自动压缩 */
  compaction?: CompactionConfig;
  /** 手动启用的可选工具名，如 readSpreadsheet、readWord、runPython */
  enabledTools?: string[];
  /** 模型预设列表 */
  modelPresets?: ModelPreset[];
  /** 当前激活的预设 ID */
  activePresetId?: string;
  /** 工作区级模型模板（无 API Key，用于快速创建域名预设） */
  modelTemplates?: ModelTemplate[];

  /** §2 本地历史与回滚 */
  history?: HistoryConfig;
  /** §3 本地 RAG */
  rag?: RagConfig;
  /** §4 MCP */
  mcp?: McpConfig;
  /** §5 多模态 */
  vision?: VisionConfig;
  /** §5.1 图片生成（文生图 / 图生图） */
  imageGen?: ImageGenConfig;
  /** §6 Pyodide */
  python?: PythonConfig;
  /** §7 Skills */
  skills?: SkillsConfig;
  /** §8 代码符号索引 */
  codingIndex?: CodingIndexConfig;
  /** §9 Office 模板能力 */
  office?: {
    template?: OfficeTemplateConfig;
  };
  /** §10 平台能力目录 */
  platform?: PlatformConfig;
  /** §11 内容模型 */
  content?: ContentConfig;
  /** §12 已安装能力包 */
  packs?: CapabilityPacksConfig;
  /** Cottage Service 连接配置（可本地或远端） */
  cottageService?: CottageServiceConfig;
  /** @deprecated 使用 cottageService */
  localAgent?: CottageServiceConfig;
}

export type ConfigLayer = 'folder' | 'domain' | 'server';

export interface LayeredCottageConfigSchema {
  schema: 'cottage-config-layered-v1';
  version: 1;
  layers: {
    folder: CottageConfig | null;
    domain: CottageConfig | null;
    server: CottageConfig | null;
  };
}

export interface ChatSessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 置顶：历史列表中排在最前 */
  pinned?: boolean;
}

/** 会话文件中记录的工具元信息 */
export interface ChatSessionToolMeta {
  name: string;
  description?: string;
}

/** 会话运行时配置快照（随聊天记录一并持久化） */
export interface ChatSessionRuntimeMeta {
  capturedAt: number;
  modelConfig: LlmModelConfig | null;
  activePresetId?: string;
  activePresetName?: string;
  systemPrompt: string;
  tools: ChatSessionToolMeta[];
  enabledTools?: string[];
  mode?: 'chat' | 'task' | 'plan' | 'spec';
  /** 落盘时该会话是否仍有回合进行中（刷新/关闭前未完成）；true 表示展示时应标记“已中断” */
  inFlight?: boolean;
  /** 最后一次回合开始时间戳 */
  lastTurnStartedAt?: number;
}

/** 会话文件 v2 格式：历史消息 + 运行时元信息 */
export interface ChatSessionSnapshot {
  schema: 'cottage-chat-session-v2';
  version: 1;
  /** 完整展示 transcript */
  history: StoredMessage[];
  /** 发给模型的上下文投影；缺省与 history 相同 */
  llmHistory?: StoredMessage[];
  runtime?: ChatSessionRuntimeMeta;
}

export interface ChatSessionsIndex {
  activeId: string | null;
  sessions: ChatSessionMeta[];
}

export const DEFAULT_LLM_CONFIG: LlmModelConfig = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  temperature: 1,
};

/** 默认忽略 globs（history / rag / codingIndex 共用；目录模式用双星前缀匹配任意嵌套） */
export const DEFAULT_IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.cottage/history/**',
  '**/.cottage/index/**',
  '**/.cottage/coding/**',
  '**/*.{zip,png,jpg,jpeg,gif,webp,mp4,woff,woff2}',
];

/** 版本历史默认接纳二进制文件，仅排除依赖、产物与 Cottage 内部数据。 */
export const DEFAULT_HISTORY_IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '.cottage/**',
  '**/.cottage/**',
];

export const DEFAULT_COTTAGE_CONFIG: Required<
  Pick<
    CottageConfig,
    | 'history'
    | 'rag'
    | 'mcp'
    | 'vision'
    | 'imageGen'
    | 'python'
    | 'skills'
    | 'codingIndex'
    | 'office'
    | 'platform'
    | 'content'
    | 'packs'
    | 'cottageService'
    | 'localAgent'
  >
> = {
  // 公开 Beta：按工作区显式开启，不从域名层自动继承开启状态。
  history: {
    enabled: false,
    autoCheckpoint: true,
    manualEditDebounceMs: 1500,
    trackGlobs: ['**'],
    ignoreGlobs: DEFAULT_HISTORY_IGNORE_GLOBS,
    maxTrackedFiles: 10000,
    limits: {
      maxFileBytes: 20 * 1024 * 1024,
      maxBytesPerFile: 100 * 1024 * 1024,
      maxPoolBytes: 500 * 1024 * 1024,
    },
  },
  rag: {
    // [HIDDEN] 本地 embedding / 向量索引：保留实现，默认不启用也不在启动时建库。
    enabled: false,
    embedding: {
      provider: 'local',
      localModel: 'minilm',
      localDevice: 'auto',
      batchSize: 8,
    },
    indexing: {
      autoOnMutate: false,
      autoOnOpen: false,
      chunkSize: 1000,
      chunkOverlap: 0.15,
      ignoreGlobs: DEFAULT_IGNORE_GLOBS,
      indexOfficeText: true,
    },
    retrieval: {
      topK: 5,
      minScore: 0.35,
      searchBackend: 'brute',
      bruteForceMaxChunks: 50000,
      fallbackToLexical: true,
      agentToolEnabled: false,
    },
  },
  mcp: {
    enabled: false,
    servers: [],
    onConnectionFail: 'disable-server',
  },
  vision: {
    enabled: true,
    requireModelCapability: true,
    storage: 'workspace-file',
    attachmentsDir: '.cottage/attachments',
    maxImageBytes: 4_000_000,
    maxDimensionPx: 2048,
  },
  imageGen: {
    defaultSize: '1024x1024',
    pollTimeoutMs: 300_000,
  },
  python: {
    enabled: false,
    pyodideSource: 'cdn',
    timeoutMs: 120_000,
    allowMicropip: false,
  },
  skills: {
    builtinCatalogEnabled: true,
    respectFrontmatterEnabled: true,
  },
  codingIndex: {
    enabled: true,
    autoOnOpen: true,
    autoOnMutate: true,
    languages: ['typescript', 'javascript', 'vue'],
    ignoreGlobs: DEFAULT_IGNORE_GLOBS,
    parser: {
      treeSitter: true,
    },
  },
  office: {
    template: {
      enabled: true,
      maxReplacements: 10000,
      allowedVariables: [],
    },
  },
  platform: {
    capabilities: {
      enabled: true,
    },
    governance: {
      requireApprovalFor: ['destructive'],
    },
    planGate: {
      enabled: false,
      requirePlanFor: ['write', 'external', 'destructive'],
      defaultBudget: {
        maxFiles: 20,
        maxApiCalls: 10,
        maxTurns: 25,
      },
      microEditExempt: true,
      microEditMaxTokens: 256,
    },
    stagingReview: {
      enabled: true,
      allowPerFileEdit: true,
      allowPerFileDiscard: true,
    },
  },
  content: {
    structuredStore: {
      enabled: true,
    },
  },
  packs: {
    installed: [],
    disabledBuiltinPacks: ['builtin.data-analysis'],
  },
  cottageService: {
    enabled: false,
    connected: false,
    autoDiscover: true,
    capabilities: [],
    useLlm: false,
    useSearch: false,
    useFetch: false,
  },
  localAgent: {
    enabled: false,
    connected: false,
    autoDiscover: true,
    capabilities: [],
    useLlm: false,
    useSearch: false,
    useFetch: false,
  },
};
