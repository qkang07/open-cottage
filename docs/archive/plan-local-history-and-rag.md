# Open Cottage 能力演进计划：本地历史回滚 + 本地 RAG（及其余方向）

> 本文档汇总后续要做的所有事项。重点是两件用户明确要做的能力：
> **① 本地文件历史与回滚（基于 git，但仅用于版本快照/回滚，不做代码协作管理）**、
> **② 本地 RAG（工作区语义检索）**。两者的全部数据都保存在用户本地，不上传任何服务端。
> 其余方向（MCP / 多模态 / WASM / Skills 管理 / 任务可视化）同样在文中给出完整设计、模块划分、里程碑与决策点。

---

## 0. 总体设计原则（不可妥协）

| 原则 | 含义 |
|------|------|
| 纯浏览器 | 不桌面化。核心能力全部在浏览器内完成（FSA + IndexedDB + WASM/Worker）。 |
| 数据本地 | 历史记录、向量索引等全部落在用户本地磁盘（工作区 `.cottage/` 内）或浏览器存储，**默认不外发**。 |
| 随项目迁移 | 与现有 `.cottage/` 哲学一致：拷走工作区文件夹即带走全部历史与索引。 |
| 外置组件仅作可选补充 | 例如远程 git 推送的 CORS 代理、可选的厂商嵌入 API；默认关闭，低优先级。 |
| 优雅降级 | 二进制文件、超大仓库、无 WebGPU 等场景下功能不崩，给出合理提示。 |
| **可配置** | 各能力的**主路径 / 降级路径 / 可选增强**均通过 `.cottage/config.json`（随工作区迁移）与 IndexedDB secrets（敏感项）暴露开关，见 **§0.1**。 |

### 0.1 统一配置与降级策略

所有新能力的开关、默认值、降级链集中在 **`.cottage/config.json`**（随工作区迁移）；API Key、MCP 令牌等敏感项继续存 **IndexedDB `open-cottage-secrets`**（与现有 `secrets.ts` 一致，不进工作区）。

实现时扩展 `CottageConfig`（`src/config/constants.ts`），由设置 UI 读写；运行时各模块只读配置 + 执行降级链，**不在业务代码里硬编码策略**。

#### 配置结构（TypeScript 草案）

```typescript
/** .cottage/config.json 扩展（与现有 llm / webSearch / enabledTools 并存） */
interface CottageConfig {
  llm?: LlmModelConfig;
  webSearch?: { provider?: WebSearchProviderId };
  enabledTools?: string[];

  /** §2 本地历史与回滚 */
  history?: {
    enabled?: boolean;                    // 默认 true
    autoCheckpoint?: boolean;             // 默认 true：Agent 回合结束自动提交
    manualEditDebounceMs?: number;        // 默认 1500：预览区保存合并提交
    trackCottageData?: boolean;           // 默认 false（D1）：是否追踪 .cottage 内对话/任务
    trackGlobs?: string[];                // 默认 ['**']：额外限定追踪范围
    ignoreGlobs?: string[];               // 默认见下表
    maxTrackedFiles?: number;             // 默认 10000；超出暂停自动检查点并提示
    agentTools?: {
      listCheckpoints?: boolean;          // 默认 true
      createCheckpoint?: boolean;         // 默认 true
      // restore 不提供工具，仅 UI（D2）
    };
    diff?: {
      maxLines?: number;                  // 默认 500：单文件 diff 展示上限
      binaryDisplay?: 'size-only' | 'hide'; // 默认 size-only
    };
  };

  /** §3 本地 RAG */
  rag?: {
    enabled?: boolean;                    // 默认 true
    embedding?: {
      provider?: 'local' | 'vendor';      // 默认 local（D3）
      localModel?: 'minilm' | 'bge-small'; // 默认 minilm
      localDevice?: 'auto' | 'wasm' | 'webgpu'; // 默认 auto：WebGPU 可用则用，否则 WASM
      vendorProvider?: LlmProviderId;     // provider=vendor 时用哪家嵌入 API
      batchSize?: number;                 // 默认 8：批量嵌入条数
    };
    indexing?: {
      autoOnMutate?: boolean;             // 默认 true：回合结束增量更新变更文件
      autoOnOpen?: boolean;               // 默认 false：打开工作区不自动全量建库
      chunkSize?: number;                 // 默认 1000 字符
      chunkOverlap?: number;              // 默认 0.15（比例）
      ignoreGlobs?: string[];             // 默认与 history 共用或继承
      indexOfficeText?: boolean;          // 默认 true：docx/xlsx/pptx 抽文本入库
    };
    retrieval?: {
      topK?: number;                      // 默认 8
      minScore?: number;                  // 默认 0.35：低于阈值的结果丢弃
      searchBackend?: 'brute' | 'hnsw';   // 默认 brute；chunk 超阈值可切 hnsw（后续）
      bruteForceMaxChunks?: number;       // 默认 50000
      fallbackToLexical?: boolean;        // 默认 true：无索引/嵌入失败时用 searchFiles
      agentToolEnabled?: boolean;         // 默认 true（D4：工具可用，不强制优先）
    };
  };

  /** §4 MCP */
  mcp?: {
    enabled?: boolean;                    // 默认 false：需用户显式开启
    servers?: Array<{
      id: string;
      name: string;
      url: string;
      enabled?: boolean;
      transport?: 'streamable-http' | 'sse';
      authHeader?: string;                // 默认 Authorization
      // 令牌在 IndexedDB secrets.mcp[serverId]
    }>;
    proxyUrl?: string;                    // 可选：CORS 代理基址（外置组件）
    onConnectionFail?: 'disable-server' | 'retry'; // 默认 disable-server + UI 告警
  };

  /** §5 多模态 */
  vision?: {
    enabled?: boolean;                    // 默认 true：总开关
    requireModelCapability?: boolean;     // 默认 true（D6）：无视觉模型时隐藏上传
    storage?: 'workspace-file' | 'inline-base64'; // 默认 workspace-file（D10）
    attachmentsDir?: string;              // 默认 .cottage/attachments
    maxImageBytes?: number;               // 默认 4_000_000
    maxDimensionPx?: number;              // 默认 2048：超限 canvas 降采样
  };

  /** §6 Pyodide */
  python?: {
    enabled?: boolean;                    // 默认 false：对应 enabledTools 含 runPython
    pyodideSource?: 'cdn' | 'bundled';    // 默认 cdn（D11）
    cdnBaseUrl?: string;
    timeoutMs?: number;                   // 默认 120_000
    allowMicropip?: boolean;              // 默认 false：联网装包
  };

  /** §7 Skills */
  skills?: {
    builtinCatalogEnabled?: boolean;      // 默认 true：显示内置技能库
    respectFrontmatterEnabled?: boolean;  // 默认 true（D12）
  };

  /** 可选外置组件（低优先级，默认不填） */
  proxy?: {
    corsFetchUrl?: string;                // 网页抓取 / 部分 API 反代
    gitRemoteUrl?: string;                // 未来远程 git 备份（非本期）
  };
}
```

#### 默认 `ignoreGlobs`（history 与 rag 共用，可在各自配置覆盖）

```
node_modules/**、.git/**、dist/**、build/**、
.cottage/history/**、.cottage/index/**、
**/*.{zip,png,jpg,jpeg,gif,webp,mp4,woff,woff2}
```

#### 降级链总览

| 能力 | 主路径 | 降级 1 | 降级 2 | 用户可配置项 |
|------|--------|--------|--------|--------------|
| **历史检查点** | 回合结束 auto commit | 工作区过大 → 暂停自动，仅手动快照 | git 初始化失败 → 禁用 history，Toast 提示 | `enabled`、`autoCheckpoint`、`maxTrackedFiles` |
| **历史 diff** | 文本逐行 diff | 二进制 → `size-only` 提示 | 超大 diff → 截断 + `maxLines` | `diff.maxLines`、`diff.binaryDisplay` |
| **RAG 嵌入** | 本地 transformers.js | WebGPU 不可用 → WASM | 本地失败 → 若 `provider=vendor` 走厂商 API；否则跳过嵌入 | `embedding.provider`、`localDevice` |
| **RAG 检索** | 语义 topK | 索引不存在 → `searchFiles` | 相似度全低于 `minScore` → 空结果 + 提示用 grep | `fallbackToLexical`、`minScore`、`topK` |
| **RAG 建库** | 后台 Worker 增量 | 用户暂停索引 | 打开工作区不自动全量（`autoOnOpen=false`） | `indexing.*` |
| **MCP 工具** | 已启用 server 的工具合并 | 单 server 连接失败 → 禁用该 server，其余照常 | MCP 全关 → 仅内置工具 | `mcp.enabled`、per-server `enabled` |
| **多模态** | 图片随消息发送 | 模型不支持视觉 → 隐藏入口（可关 `requireModelCapability` 强制显示并发送，由模型报错） | 图片过大 → 降采样 | `vision.*` |
| **runPython** | Pyodide Worker | CDN 失败 → 若 `bundled` 则本地包 | 未启用 → 工具不出现在 Agent | `python.enabled`、`pyodideSource` |
| **联网搜索**（已有） | 配置 provider | DuckDuckGo 失败 → 提示换 Tavily | — | `webSearch.provider` + secrets |

#### 设置 UI 组织（建议）

在现有 **AI 设置** 抽屉中分 Tab / 折叠面板，与工作区 `config.json` 双向绑定：

| 面板 | 配置前缀 | 说明 |
|------|----------|------|
| 模型与工具 | `llm`、`enabledTools` | 已有 |
| 本地历史 | `history` | 开关、忽略规则、自动快照、diff 限制 |
| 语义索引 | `rag` | 嵌入方式、模型、建库策略、检索阈值 |
| MCP 服务器 | `mcp` | 列表、连接测试、代理 URL |
| 图片与多模态 | `vision` | 存储方式、尺寸限制 |
| Python | `python` | 开关、CDN/自托管、超时 |
| 技能 | `skills` | 内置库、frontmatter 规则 |
| 高级 / 代理 | `proxy` | 外置 CORS 等，默认折叠 |

敏感项（嵌入 API Key、MCP token）在对应面板编辑，保存到 IndexedDB，**不写进 config.json**。

#### 实现约定

1. **默认值合并**：`getCottageConfig()` 返回与 `DEFAULT_COTTAGE_CONFIG` 深合并后的结果，缺省字段用默认，旧版 config 无新字段也能跑。
2. **迁移**：打开工作区时若缺少新字段，不写盘；用户首次打开对应设置页再持久化。
3. **降级可观测**：每次走降级路径写 debug 日志（现有 `DebugPanel` 可展示），避免静默失败。
4. **Agent 提示词**：根据配置动态生成——例如 `rag.retrieval.agentToolEnabled=false` 时不注册 `searchWorkspaceSemantic`；`history.agentTools.createCheckpoint=false` 时不暴露检查点工具。

#### 配置模块（CFG0 实现）

```
src/config/
├── cottageConfigSchema.ts   # CottageConfig 类型、DEFAULT_COTTAGE_CONFIG、深合并 mergeCottageConfig()
├── cottageStorage.ts        # 已有：读写 config.json（扩展字段向前兼容）
└── secrets.ts               # 已有：扩展 secrets.mcp、embedding vendor key 等
src/components/Settings/
└── FeatureSettingsTabs.tsx  # 分面板：历史 / RAG / MCP / 多模态 / Python / 技能 / 代理
```

---

## 1. 已完成（基线：代码智能工具）

已落地并通过测试（`tsc -b` + `vitest run` 全绿）：

- `searchFiles`：工作区内容搜索（grep，支持正则 / 大小写 / include·exclude glob / 行号 + 上下文）
- `findFiles`：按 glob 查找文件
- `editFile`：精确查找-替换编辑（比 `patchFile` 行号更可靠）
- 纯函数与单测：`src/workspace/search.ts`、`src/workspace/search.test.ts`
- 工具注册与提示词：`src/agent/langchainTools.ts`、`src/agent/constants.ts`

这批能力是后续"历史"与"RAG"的基础（RAG 的词法检索会复用 `search.ts`）。

---

## 2. 本地文件历史与回滚（重点 A）

### 2.1 目标 / 非目标

**目标**
- 为工作区内所有文件维护**完整的本地修改历史**（谁/何时/改了什么）。
- 支持**回滚**：把单个文件或整个工作区恢复到任意历史版本。
- 自动在 Agent 每次改动后留下"检查点"，用户也可手动打快照。
- 全部历史数据存在用户本地，可随工作区迁移。

**非目标（明确不做）**
- 不做分支协作、PR、远程仓库工作流。
- 不暴露 git 的复杂概念（rebase/merge/cherry-pick）给普通用户。
- 远程推送（push/pull）默认不做；如未来需要异地备份，作为可选外置组件（CORS 代理）。

### 2.2 技术选型

- **`isomorphic-git`**：纯 JS git 实现，浏览器可运行，每个 API 接收 `fs` 参数。
- **FSA 适配器**：把 isomorphic-git 需要的 Node 风格 `fs.promises`（readFile/writeFile/stat/lstat/readdir/mkdir/rmdir/unlink/readlink/symlink）映射到 File System Access API。复用现有 `FileSystemWorkspace` 的字节读写、mkdir、删除、目录遍历等原语。
- **关键技巧：`dir` 与 `gitdir` 分离**。isomorphic-git 允许工作树目录（`dir`）与 git 元数据目录（`gitdir`）分开：
  - `dir` = 工作区根（用户的真实文件）
  - `gitdir` = `.cottage/history/git`
  - 好处：**不污染用户项目**（不在根目录生成 `.git`），与用户自己的 git 仓库**互不冲突**，且历史随 `.cottage/` 一起迁移。

### 2.3 数据布局

```
工作区根/
├── (用户文件...)            # 工作树，由 dir 指向
└── .cottage/
    └── history/
        ├── git/             # gitdir：对象库、refs、index（全部本地）
        ├── meta.json        # { enabled, lastCheckpointAt, trackGlobs, ignoreGlobs, autoCheckpoint }
        └── checkpoints.json # 检查点元数据：commitOid → { label, source: 'auto'|'manual'|'agent', at, summary, changedPaths[] }
```

- 历史完全是标准 git 对象，未来如需也可用外部 git 工具打开 `gitdir`。
- `checkpoints.json` 是给 UI 用的人类可读索引（标题、来源、变更文件数），避免每次都解析 git log。

### 2.4 追踪范围与配置

配置项见 **§0.1 `history.*`**。要点：

- 默认追踪工作区全部文件，但**排除** `.cottage/history/`（git 自身，否则递归）。
- `ignoreGlobs`：默认与 RAG 共用（§0.1 列表），可通过 `history.ignoreGlobs` 单独覆盖。
- **`trackCottageData`**（默认 `false`，原 D1）：为 `true` 时连同 `.cottage/chat-*.json`、任务数据一起版本化，可回溯「对话 + 产物」整体状态。

### 2.5 自动检查点策略

配置：`history.autoCheckpoint`（默认 true）、`history.manualEditDebounceMs`（默认 1500）。

现有 `onWorkspaceMutate` 已在每次文件类工具成功后触发，是天然的接入点。但"每次工具调用即提交"会过于频繁、FSA 写 `.git/index` 也有开销。策略：

- **按"Agent 回合"成批提交**：监听 `CottageAgent` 的 `assistantComplete` 事件，在一轮结束后，对本轮发生变更的路径做一次 `add` + `commit`。
- **防抖**：手动编辑（预览区保存）等高频来源用 debounce（如 1.5s）合并。
- **仅暂存变更路径**：维护"本回合 mutated 路径集合"，只 `git.add` 这些路径 + 处理删除，避免全树 `statusMatrix` 扫描的开销。
- commit message 自动生成：`[auto] <回合摘要/首条用户指令截断>`，作者用固定的 `Open Cottage <cottage@local>`。
- **手动检查点**：UI 顶部"打快照"按钮，可命名（写入 `checkpoints.json` 的 `label`）。

### 2.6 功能清单

| 功能 | 说明 |
|------|------|
| 时间线 | 按时间倒序列出检查点（来源徽标：自动/手动/Agent、变更文件数、摘要） |
| 单文件历史 | 选中文件 → 列出涉及它的所有提交；可看任意版本内容 |
| Diff | 文本文件展示逐行 diff；二进制仅显示"二进制文件已变更"（与 git 行为一致） |
| 回滚-单文件 | 把某文件恢复到选定版本（`checkout` 该文件到工作树并写盘） |
| 回滚-整树 | 把整个工作区恢复到某检查点（先自动打一个"回滚前"安全快照再恢复，可二次撤销） |
| 对比当前 | 工作树相对最新检查点的未提交改动预览 |
| 命名/标签 | 给检查点命名，便于找回关键节点 |

### 2.7 二进制文件处理

- git 本身按字节存储任意文件，docx/xlsx/图片等都能正常版本化与回滚——**不是障碍**。
- 仅 diff 展示降级：检测到二进制（复用 `search.ts` 的 `isLikelyTextPath`）则不算文本 diff，显示大小变化/“二进制变更”。

### 2.8 性能与边界

- 中小工作区流畅；超大仓库（数万文件）下 FSA 开销明显 → 通过"仅暂存变更路径 + ignoreGlobs"控制。
- **`history.maxTrackedFiles`**（默认 10000）：超出时**降级**——暂停 `autoCheckpoint`，UI 提示缩小 `trackGlobs` 或扩充 `ignoreGlobs`，手动快照仍可用。
- 所有 git 计算放进 **Web Worker**，避免阻塞主线程（FSA handle 可在 Worker 中使用）。
- 句柄/权限：`gitdir` 在工作区内，跟随工作区授权，无额外授权。
- **`history.enabled=false`**：完全跳过 git 初始化，History 面板显示「已关闭」。

### 2.9 是否暴露给 Agent

配置：`history.agentTools.listCheckpoints`、`history.agentTools.createCheckpoint`（均默认 true）。

- `restore` **不提供** Agent 工具，仅限 UI 手动操作（避免误回滚）。
- 工具关闭时从 `createCottageAgent` 动态剔除，并相应缩短 system prompt。

### 2.10 模块与任务分解

```
src/history/
├── fsaGitAdapter.ts      # FSA → isomorphic-git fs.promises 适配（含 stat 合成、ENOENT）
├── historyService.ts     # init/ensureRepo、commitChangedPaths、log、diff、restoreFile、restoreTree
├── checkpointStore.ts     # 读写 .cottage/history/checkpoints.json、meta.json
├── history.worker.ts     # 在 Worker 内跑 git 运算
└── ignore.ts             # 追踪/忽略 glob（复用 search.ts）
src/components/History/
├── HistoryPanel.tsx      # 时间线 + 文件历史 + 回滚入口
└── DiffView.tsx          # 文本 diff / 二进制提示
```

里程碑：
1. ✅ **M1**：FSA 适配器 + `ensureRepo`（dir/gitdir 分离）。
2. ✅ **M2**：回合级自动检查点（接 `assistantComplete` + 变更路径暫存 + 防抖）+ `checkpoints.json`。
3. ✅ **M3**：HistoryPanel 时间线 + 单文件历史 + 文本 diff + 左侧 Tab 集成。
4. ✅ **M4**：单文件回滚 + 整树回滚（含“回滚前安全快照”）+ 手动命名快照 + Agent 工具注册。
5. **M5**：ignoreGlobs / maxTrackedFiles 配置 UI、性能优化、二进制降级、Worker 化。

### 2.11 依赖

- 新增 `isomorphic-git`（纯 JS，无 Node 依赖）。
- diff 渲染可用现有 markdown/代码高亮能力，或新增轻量 diff 库（如 `diff`）。

### 2.12 配置与 UI

- 读写：`history.*` → `CottageConfig`（§0.1）；HistoryPanel 顶部显示「自动快照开/关」快捷切换。
- 设置页「本地历史」面板：追踪范围、忽略规则、diff 限制、Agent 工具开关。

---

## 3. 本地 RAG（工作区语义检索）（重点 B）

### 3.1 目标

- 让 Agent 通过**语义检索**理解大型工作区（"在哪里实现了 X / Y 是怎么工作的"），减少盲目 `listFiles + readFile`，与 `searchFiles`（词法）形成**混合检索**。
- 索引与向量**全部存在本地**，默认不外发文件内容。

### 3.2 嵌入方案

配置：`rag.embedding.*`（§0.1）。默认 **`provider: 'local'`**（原 D3）。

| 方案 | 配置值 | 说明 | 隐私 | 速度/质量 |
|------|--------|------|------|-----------|
| **本地嵌入（默认）** | `provider: 'local'` | transformers.js + `minilm` / `bge-small` | 完全本地 | 见 §3.7 |
| 厂商嵌入 API（可选） | `provider: 'vendor'` | 调用 `vendorProvider` 的 embedding 端点 | 内容上传厂商 | 快、质量高 |

**设备选择** `localDevice`：`auto`（默认）→ 探测 WebGPU，可用则用，否则 WASM；可强制 `wasm` / `webgpu`。

**降级**：本地嵌入抛错 → 若 `provider=vendor` 且已配置 Key 则切换厂商；否则本次跳过嵌入，检索走 `fallbackToLexical`（§0.1）。

### 3.3 向量存储（本地）

```
.cottage/index/
├── manifest.json   # { model, dim, builtAt, chunkParams }
├── files.json      # path → { hash, mtime, chunkIds[] }
└── vectors.bin     # 紧凑存储所有 chunk 向量（Float32），配合 chunks.json 偏移
    chunks.json     # chunkId → { path, startLine, endLine, preview }
```

- 向量用 `Float32Array` 紧凑落盘（FSA writeFileBytes），避免 JSON 膨胀。
- 查询：加载向量做**余弦相似度暴力检索**（数千~数万 chunk 在 JS/Worker 内完全够用；上量级再考虑量化或 HNSW）。
- 全部位于 `.cottage/index/`，随工作区迁移；模型权重缓存在浏览器 Cache Storage（不进工作区）。

### 3.4 分块（chunking）

- 仅索引文本文件（复用 `isLikelyTextPath` + `ignoreGlobs`）。
- 代码/文本按 ~800–1200 字符、带 ~15% 重叠切块，记录起止行号。
- Office：复用现有 `readWord` / `readSpreadsheet` / `readPresentation` 抽取的纯文本再分块（PDF 暂不支持，列入后续）。

### 3.5 增量索引

配置：`rag.indexing.*`（§0.1）。

- 每个文件存内容哈希；重建时只对**新增/变更**文件重新嵌入，删除文件清除其 chunk。
- **触发**（均可配置）：
  - 手动「重建/刷新索引」（IndexPanel 按钮，始终可用）
  - `autoOnMutate`（默认 true）：`assistantComplete` 后对本回合变更文件后台增量更新（与历史检查点共享变更集合）
  - `autoOnOpen`（默认 **false**）：避免打开大工作区即长时间占 CPU；用户可在设置中开启
- 进度与可中断：索引在 Worker 中进行，UI 显示进度与 ETA，可暂停；暂停后已写入部分保留。

### 3.6 检索工具（给 Agent）

配置：`rag.retrieval.*`、`rag.enabled`。

- 新增 `searchWorkspaceSemantic(query, topK?)` → 返回 top-k chunk（path、行号范围、片段、相似度）；`topK` 默认读 `rag.retrieval.topK`（8）。
- **`agentToolEnabled`**（默认 true，原 D4）：为 false 时不注册该工具，仅 UI 可搜；为 true 时提示词鼓励混合检索，**不强制**优先于 `searchFiles`。
- **降级链**（§0.1）：索引不存在 → `searchFiles`；嵌入失败 → 同上；结果分数均低于 `minScore` → 返回空并提示缩小 query 或改用 grep。

### 3.7 性能基线（浏览器小模型实测参考）

基于 transformers.js + `Xenova/all-MiniLM-L6-v2`（约 22M 参数、384 维、量化约 25MB）的公开 benchmark 与社区实测（Chrome，硬件差异大，**仅供容量规划**）：

#### 单次嵌入延迟

| 场景 | WASM（CPU） | WebGPU |
|------|-------------|--------|
| 短文本（一句 / 小段代码） | **8–15ms**（Apple Silicon 较快） | 15–25ms（短文本有时因 GPU 调度开销更慢） |
| 中等 chunk（~800 字） | **15–60ms** | 有 GPU 时约 **8–20ms** |
| 首次加载模型 | 冷启动 **2–5s**（之后 Cache Storage 缓存） | 另加 shader 编译 **1–5s** |

**实现建议**（对应 `rag.embedding.localDevice`）：
- 默认 `auto`：短 chunk 批量时 WebGPU 更优；单条查询可 WASM 足够快。
- 全部在 **Worker** 内执行，主线程不阻塞。
- transformers.js v4 对 BERT 类嵌入有约 **4×** 提速（MultiHeadAttention 算子），实现时优先 v4。

#### 全量建库耗时（粗算，按每 chunk ~30ms）

| 工作区 | 估计 chunk 数 | 全量建库 |
|--------|---------------|----------|
| 小（~50 文件） | ~150 | **~5s** |
| 中（~300 文件） | ~900 | **~30s** |
| 大（~1000 文件，未排除 node_modules） | ~5000+ | **~3min+** |

**结论**：瓶颈在**首次全量建库**，不在日常查询。务必配置好 `ignoreGlobs`（§0.1），且默认 `autoOnOpen: false`。

#### 查询延迟（一次 `searchWorkspaceSemantic`）

| 步骤 | 耗时 |
|------|------|
| 查询嵌入 | ~10–50ms |
| 余弦相似度（≤1 万 chunk × 384 维，Worker 暴力） | ~1–10ms |
| 排序取 topK | <1ms |
| **合计** | 通常 **<100ms**，极端 <200ms |

`bruteForceMaxChunks`（默认 50000）超出后可降级为提示「请缩小索引范围」或切换 `searchBackend: 'hnsw'`（后续里程碑）。

#### 质量与混合检索

| 对比 | 说明 |
|------|------|
| vs `searchFiles` | 语义检索能找「意思相近、用词不同」的代码，提升明显 |
| vs 云端 `text-embedding-3-small` | 本地小模型在代码结构、专有名词上略弱 |
| 推荐策略 | **语义定位 + grep 确认**；`fallbackToLexical: true` 保证无索引时仍可用 |

#### 资源占用

| 项目 | 约数 |
|------|------|
| 模型下载（首次） | MiniLM ~25MB；bge-small ~30–90MB |
| 内存（模型加载后） | ~50–150MB |
| 索引磁盘（1 万 chunk） | vectors.bin ≈ **15MB** |

#### 对实现的含义

1. **默认本地嵌入完全可用**——查询够快，适合作为 `rag.embedding.provider` 默认值。
2. 首次建库需 **后台 + 进度条 + 可暂停**；`autoOnOpen` 默认关。
3. `embedding.batchSize`（默认 8）批量编码可显著缩短建库时间。
4. 厂商 API 作为设置里的**可选增强档**，不替代默认路径。

### 3.8 模块与任务分解

```
src/rag/
├── embeddings.ts        # 本地(transformers.js) / 厂商 两种 provider 抽象
├── embeddings.worker.ts # 嵌入与相似度计算
├── chunker.ts           # 分块（文本/office）
├── vectorStore.ts       # .cottage/index 读写（vectors.bin / chunks.json / files.json）
├── indexer.ts           # 全量/增量建库、进度、忽略规则
└── retrieve.ts          # query → topK
src/components/Rag/
└── IndexPanel.tsx       # 建库/刷新/进度/统计、嵌入方式切换
```

里程碑：
1. ✅ **R0**：`CottageConfig.rag` 默认值与合并逻辑 + 设置 UI 骨架。
2. ✅ **R1**：本地嵌入 provider（transformers.js）+ 模型缓存 + `localDevice` 降级。
3. ✅ **R2**：chunker + vectorStore（落盘/读取）+ 全量建库（后台、可暂停）。
4. ✅ **R3**：`searchWorkspaceSemantic` 工具 + 混合检索 + `fallbackToLexical` 降级。
5. ✅ **R4**：增量索引（哈希 diff、`autoOnMutate`）+ IndexPanel（进度/统计）。
6. ✅ **R5**：Office 文本接入（docx/xlsx）、`minScore` / `bruteForceMaxChunks` 配置。

### 3.9 依赖

- 新增 `@huggingface/transformers`（即 transformers.js）。
- 若启用厂商嵌入：复用现有 `@langchain/*` 或直接 fetch embedding 端点。

### 3.10 配置与 UI

- 读写：`rag.*` → `CottageConfig`（§0.1）。
- **IndexPanel**：索引状态（chunk 数、上次构建时间）、「立即建库 / 暂停 / 重建」、嵌入方式与模型选择。
- 设置页「语义索引」：与 §0.1 设置面板表一致；切换 `provider: vendor` 时显式提示「文件内容将发送至所选厂商」。

---

## 4. MCP 接入（模型上下文协议）

### 4.1 目标 / 非目标

**目标**
- 让 Agent 连接外部 **MCP server**，动态获得其暴露的工具（数据库、API、内部系统等），与现有 LangChain 工具无缝合并到同一调用循环。
- 服务器配置随工作区迁移；鉴权令牌存浏览器本地，不进工作区。

**非目标**
- 不内置 MCP server（本应用是 client）。
- 暂不做 MCP 的 resources / prompts / sampling（列入后续），先做 tools。

### 4.2 纯浏览器约束（关键）

- 仅支持 **Streamable HTTP / SSE 传输**的 MCP server；**stdio 型需要本地进程，超出浏览器边界，不支持**。
- 目标 server 必须允许浏览器 **CORS**；不允许的可经可选外置代理（低优先级，复用仓库 `proxy/`）。

### 4.3 设计

配置：`mcp.*`（§0.1）。**`mcp.enabled` 默认 false**，需用户显式开启。

- 自建轻量 MCP client（或用官方 `@modelcontextprotocol/sdk` 的浏览器可用部分）走 Streamable HTTP：
  1. `initialize` 握手 → `tools/list` 拉取工具清单（JSON Schema）。
  2. 把每个 MCP 工具**动态适配为 LangChain `StructuredTool`**：`zod`/JSON Schema → tool；`invoke` 内部调 `tools/call`。
  3. 在 `createCottageAgent` 组装 tools 时合并这些动态工具（仅 `mcp.enabled` 且 server `enabled` 时）。
- **命名冲突**：工具名加 server 前缀（如 `mcp__<serverId>__<tool>`），避免与内置工具/多 server 冲突；提示词说明。
- **配置与密钥**：
  - server 列表（id、name、url、enabled、transport）存 **`mcp.servers`** → `.cottage/config.json`。
  - 鉴权令牌存 IndexedDB `secrets.mcp[serverId]`（**不进工作区**，原 D9）。
- **降级**：
  - 单 server 连接失败 → 按 `onConnectionFail` 禁用该 server 或重试；其余 server 与内置工具不受影响。
  - CORS 失败 → 若配置了 `mcp.proxyUrl` 或 `proxy.corsFetchUrl` 则经代理重试；否则 UI 提示配置代理。
  - `mcp.enabled=false` → 不加载 MCP 模块。

### 4.4 模块与任务分解

```
src/mcp/
├── transport.ts     # Streamable HTTP/SSE 客户端
├── client.ts        # initialize / tools.list / tools.call、重连
├── toolAdapter.ts   # MCP tool schema → LangChain StructuredTool（含命名前缀）
└── registry.ts      # 多 server 管理、启用状态、清单缓存
src/components/Settings/
└── McpServersFields.tsx  # 增删 server、url/令牌、连接测试、工具预览
```

里程碑：
1. ✅ **C1**：transport + client（initialize/tools.list/tools.call）+ SSE 解析。
2. ✅ **C2**：toolAdapter + 合并进 agent tools（命名前缀、错误降级）+ 多 server registry + 设置 UI（McpServersFields）。
3. **C3**：配置/密钥存储完善。
4. **C4**：连接测试、工具预览增强。
5. **C5**（后续）：resources/prompts、`mcp.proxyUrl` / `proxy.corsFetchUrl` 外置代理 UI。

### 4.5 配置与 UI

- 设置页「MCP 服务器」：列表增删、`enabled` 开关、连接测试、工具预览；令牌字段写 IndexedDB。
- 总开关 `mcp.enabled` 关闭时折叠整个面板并卸载动态工具。

### 4.6 决策点（已纳入配置默认值）

- **D5**：仅 HTTP/SSE → `mcp.servers[].transport` 限定可选值。
- **D9**：令牌 → IndexedDB `secrets.mcp`，config 只存 server 元数据。

---

## 5. 多模态图片输入

### 5.1 目标

- 用户可在对话框**粘贴/拖拽/上传图片**，或把预览区的图片"加入对话"；具备视觉能力的模型据此理解图像（截图问答、设计稿转代码等）。
- 纯浏览器：图片在本地转为 data URL / base64，作为消息的多模态内容部分发送。

**非目标**：暂不做图片**生成**输出（仅输入理解）。

### 5.2 设计

配置：`vision.*`（§0.1）。

- **采集入口**：扩展 `ChatComposer` / Tiptap 编辑器支持粘贴与拖拽图片；预览区已有 `useAddPreviewToChat`，扩展为可携带图片内容。
- **消息结构**：`ComposedUserMessage` / `StoredMessage` 扩展 `attachments`；`historyAdapter` 转为 LangChain 多模态 content。
- **存储**：由 `vision.storage` 控制（默认 `workspace-file`，原 D10）：
  - `workspace-file`：写入 `vision.attachmentsDir`（默认 `.cottage/attachments/<chatId>/`），消息存路径。
  - `inline-base64`：内联进 chat JSON（小图调试可用，不推荐默认）。
- **模型能力**：`requireModelCapability`（默认 true，原 D6）为 true 时，当前模型无视觉能力则隐藏上传入口；设为 false 可强制显示（发送后由模型报错）。
- **尺寸降级**：超过 `maxImageBytes` / `maxDimensionPx` 时用 canvas 降采样后再存/发。
- **`vision.enabled=false`**：隐藏所有图片入口，历史中的附件仅显示占位。

### 5.3 模块与任务分解

```
src/chat/
├── attachments.ts            # 附件类型、读取/编码、降采样
└── composeUserMessage.ts     # 注入图片内容部分（扩展现有）
src/agent/
├── historyAdapter.ts         # StoredMessage → LangChain 多模态 content（扩展）
└── messages.ts               # 消息结构扩展
src/components/Chat/
├── ChatComposer.tsx          # 粘贴/拖拽/上传 UI（扩展）
└── UserMessageContent.tsx    # 渲染消息内嵌图片缩略图（扩展）
```

里程碑：
1. ✅ **V1**：附件类型 + 采集（上传/粘贴/拖拽）+ 本地缩略图渲染 + 降采样。
2. ✅ **V2**：historyAdapter 多模态封装（image_url content）+ StoredMessage attachments 字段。
3. **V3**：模型视觉能力识别（入口显隐/提示）。
4. **V4**：存储落地（方案 a：`.cottage/attachments`）+ 预览区“图片加入对话”。
5. **V5**：覆盖多厂商图片 content 格式差异。

### 5.4 配置与 UI

- 设置页「图片与多模态」：`vision.enabled`、`storage`、尺寸上限、`requireModelCapability`。
- ChatComposer 根据配置与当前模型能力动态显隐上传区。

### 5.5 决策点（已纳入配置默认值）

- **D6** → `vision.requireModelCapability`
- **D10** → `vision.storage`

---

## 6. WASM 运行时（Pyodide 跑 Python）

### 6.1 目标

- 在 `runScript`（JS）之外提供 **`runPython`**：本地浏览器内执行 Python（pandas/numpy 等），适合数据清洗、表格分析、科学计算等。
- 纯浏览器：Pyodide（CPython 编译为 WASM）在 Web Worker 内运行；可读写工作区文件。

### 6.2 设计

配置：`python.*`（§0.1）；与 `enabledTools` 含 `runPython` 联动。

- **加载**：`pyodideSource`（默认 `cdn`，原 D11）→ CDN 失败且配置了 `bundled` 则回退本地 `public/pyodide/`；首次懒加载 + Cache Storage。
- **文件桥接**：复用 `script.worker` RPC 思路，IO 经主线程 `FileSystemWorkspace`。
- **包管理**：`allowMicropip`（默认 false）；开启后允许 micropip 联网装包，UI 需二次确认。
- **超时**：`timeoutMs`（默认 120000），超时中断 Worker。
- **作为可选工具组**：`python.enabled` 默认 false，对应 `toolCatalog` 的 `python` 组，设置里与表格/Office 并列开关。
- **安全**：与 `runScript` 同级，非强隔离。

### 6.3 模块与任务分解

```
src/agent/
├── pyodide.worker.ts   # 加载 Pyodide、执行、RPC 文件 IO、超时
├── runPython.ts        # 主线程封装（懒加载、缓存、AbortSignal）
└── toolCatalog.ts      # 新增可选工具组 'python'（扩展）
src/components/Settings/
└── AiSettingsDrawer.tsx  # 可选工具组开关（已有结构，加 python）
```

里程碑：
1. ✅ **P1**：Worker 内懒加载 Pyodide + CDN 加载 + stdout/stderr 重定向。
2. ✅ **P2**：`runPython` 工具 + toolCatalog 可选组 + 提示词 + 超时/中断。
3. **P3**：文件 IO 桥接（读写工作区）。
4. **P4**（可选）：`allowMicropip`、产物写回工作区。

### 6.4 配置与 UI

- 设置页「Python」：`enabled`、`pyodideSource`、`cdnBaseUrl`、`timeoutMs`、`allowMicropip`（带风险提示）。

### 6.5 决策点（已纳入配置默认值）

- **D7** → `python.enabled` 默认 false + 懒加载
- **D11** → `python.pyodideSource`

---

## 7. Skills 管理 UI + 内置技能库

### 7.1 目标 / 现状

- 现已支持：工作区 `SKILLS/` 下的 `.md` 被 `workspaceSkills.ts` 扫描、解析 frontmatter，注入 system prompt 的 `<available_skills>`，Agent 按需 `readFile` 执行。
- 目标：把该机制**产品化**——可视化管理、启用/停用、从内置模板库一键安装、便于分享。

### 7.2 设计

配置：`skills.*`（§0.1）。

- **Skills 面板**：列出 `SKILLS/` 技能，新建/编辑/删除/查看。
- **启用/停用**：`skills.respectFrontmatterEnabled`（默认 true，原 D12）为 true 时，跳过 frontmatter `enabled: false` 的技能；为 false 时目录内全部编入索引（兼容旧行为）。
- **内置技能库**：`skills.builtinCatalogEnabled`（默认 true）控制是否展示内置模板与一键安装。
- **分享**：技能即 `.md`，支持导出文件。

### 7.3 模块与任务分解

```
src/agent/workspaceSkills.ts        # 扩展：读取 enabled、写入/新建技能
src/skills/builtin/                 # 内置技能 .md 资源
src/components/Skills/
└── SkillsPanel.tsx                 # 列表/编辑/启用停用/安装内置
```

里程碑：
1. ✅ **S1**：SkillsPanel 列表 + 查看（复用现有索引）。
2. ✅ **S2**：新建/编辑/删除（写 `SKILLS/`）+ 启用/停用（frontmatter `enabled`）+ 索引过滤。
3. **S3**：内置技能库 + 一键安装（受 `builtinCatalogEnabled` 控制）。
4. **S4**：技能导出分享。

### 7.4 配置与 UI

- SkillsPanel 内「设置」：`respectFrontmatterEnabled`、`builtinCatalogEnabled`。
- 单技能编辑：frontmatter 表单含 `enabled` 字段。

### 7.5 决策点（已纳入配置默认值）

- **D8**：内置清单范围（实现 S4 时定稿）
- **D12** → `skills.respectFrontmatterEnabled` + 技能文件 `enabled` 字段

---

## 8. 任务模式可视化增强

### 8.1 目标 / 现状

- 现有：`TaskRunner` 多轮编排，`plan.json` / `manifest.json` / `events.jsonl`，`TaskLiveLog` 读事件流。
- 目标：把执行过程**看板化、可观测、可干预**，提升任务模式体验（无需改后端数据模型，纯前端消费已有数据）。

### 8.2 设计

- **计划看板**：把 `plan.json` 的步骤按 `pending / doing / done` 分列或带状态条展示，随 `taskSetPlan` 实时更新。
- **进度**：`turnCount / maxTurns` 进度条；当前状态（running/paused/...）醒目展示。
- **事件时间线**：`events.jsonl` 渲染为时间线（计划更新、完成信号、失败、验收结果），可折叠 detail。
- **交付物预览**：完成后 `manifest.paths` 与 `deliverable.zip` 一键查看/下载。
- **干预**：暂停/继续/取消按钮强化（已有控制信号），失败后可重试。

### 8.3 模块与任务分解

```
src/components/Task/
├── TaskPanel.tsx       # 集成进度、计划看板、控制（扩展）
├── TaskPlanBoard.tsx   # 计划步骤看板（新增）
└── TaskLiveLog.tsx     # 事件时间线增强（扩展）
```

里程碑：
1. ✅ **T1**：计划看板 + 进度条（TaskPlanBoard 组件）。
2. ✅ **T2**：事件时间线增强（TaskEventTimeline 组件，分类图标/颜色、可折叠 JSON 详情）。
3. **T3**：交付物预览/下载 + 干预按钮强化。

### 8.4 决策点

- 无关键阻塞性决策；以视觉与交互细节为主。

---

## 9. 建议总体顺序

0. ✅ **CFG0**：`CottageConfig` 扩展 + `DEFAULT_COTTAGE_CONFIG` 深合并 + 设置 UI 分面板骨架（§0.1）— **已完成**
1. ✅ 代码智能工具（已完成）
2. **本地历史与回滚**（M1–M5）— 用户重点
3. **本地 RAG**（R0–R5）— 用户重点；R0 可与 CFG0 合并
4. ✅ **MCP**（C1–C2 已完成）/ ✅ **多模态**（V1–V2 已完成）
5. ✅ **WASM/Pyodide**（P1–P2 已完成）/ ✅ **Skills 管理**（S1–S2 已完成）/ ✅ **任务可视化**（T1–T2 已完成）

历史与 RAG 可并行；二者共享 `ignoreGlobs`、变更文件集合与 §0.1 配置模型。

---

## 10. 决策点与配置默认值

原 D1–D12 已**编码进 §0.1 配置结构**；下表为速查（「配置键」即 `.cottage/config.json` 路径）：

| 编号 | 原决策点 | 配置键 | 默认值 |
|------|----------|--------|--------|
| D1 | 历史是否追踪 `.cottage` 对话/任务 | `history.trackCottageData` | `false` |
| D2 | Agent 能否回滚检查点 | `history.agentTools.*`（无 restore） | list/create: `true` |
| D3 | RAG 嵌入本地 vs 厂商 | `rag.embedding.provider` | `local` |
| D4 | Agent 是否强制优先语义检索 | `rag.retrieval.agentToolEnabled` | `true`（可用不强制） |
| D5 | MCP 传输类型 | `mcp.servers[].transport` | `streamable-http` / `sse` |
| D6 | 依模型显隐图片上传 | `vision.requireModelCapability` | `true` |
| D7 | Pyodide 体积 | `python.enabled` | `false` |
| D8 | 内置技能清单 | `skills.builtinCatalogEnabled` + 资源目录 | 待定清单 |
| D9 | MCP 令牌存储 | IndexedDB `secrets.mcp` | 不进 config |
| D10 | 图片存储方式 | `vision.storage` | `workspace-file` |
| D11 | Pyodide CDN vs 自托管 | `python.pyodideSource` | `cdn` |
| D12 | Skills 停用机制 | frontmatter `enabled` + `skills.respectFrontmatterEnabled` | `true` |

**仍待产品拍板**：D8 内置技能具体清单；D11 是否在发布包内捆绑 Pyodide（影响离线体验与包体积）。

---

*文档更新于 2026-06-16。涵盖：统一配置与降级（§0.1）、本地历史回滚、本地 RAG（含性能基线 §3.7）、MCP、多模态、WASM/Pyodide、Skills 管理、任务可视化。*

*进度：CFG0 ✅ | MCP C1-C2 ✅ | 多模态 V1-V2 ✅ | Pyodide P1-P2 ✅ | Skills S1-S2 ✅ | 任务可视化 T1-T2 ✅ | 本地历史 M1-M4 ✅（M5 待优化）| 本地 RAG R0-R5 ✅*
