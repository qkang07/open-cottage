# Deterministic Agent evals

这套框架直接驱动真实 `CottageAgent` 与统一工具执行器，不启动页面，也不访问真实模型。

## 运行

```powershell
pnpm eval:deterministic
```

按场景或 tag 缩小范围：

```powershell
pnpm eval:deterministic -- --scenario staging-stop-restore-approve
pnpm eval:deterministic -- --tag staging --tag recovery
pnpm eval:deterministic -- --tag regression
pnpm eval:deterministic -- --report .artifacts/evals/custom-report.json
```

多个 `--scenario` 取指定 ID 集合；多个 `--tag` 匹配任意一个 tag；两类同时提供时取交集。
恢复基础设施测试始终执行，不受场景过滤影响。

仓库约定仍然适用：Agent 不会自动执行这条命令，由开发者在需要时手动运行。

## 场景组成

- `scenarios/`：版本化场景 corpus。
- `runner.ts`：组装 replay model、内存工作区、统一工具执行器与断言。
- `inMemoryWorkspace.ts`：场景隔离的文本工作区与真实 `CottageTool`。
- `normalize.ts`：把时间和随机 ID 归一化，生成稳定诊断 artifact。
- `faultInjector.ts`：在工具调用前后注入可重复故障。
- `runtime.ts`：内存 trace、脚本化审批和测试用 Web Locks。
- `staging.ts`：可重建的内存暂存层与 session staging 持久化。
- `checkpointRecovery.test.ts`：Plan 步骤检查点的捕获、完整性预检与恢复。
- `protocolMatrix.test.ts`：枚举 JSON 参数切分位置，并验证交错工具调用按 call ID 隔离。
- `workspaceLockContention.test.ts`：模拟多个 Plan/标签页竞争相同与不同工作区锁。
- `baseline.ts`：必须显式维护的核心场景清单，防止回归覆盖被意外删减。
- `selection.ts`：CLI 场景 ID/tag 过滤规则。

场景以工作区最终状态和结构化事件为主要真相，不把完整自然语言回复作为 golden snapshot。
新增真实缺陷回归时，优先把失败轨迹缩成一个新的 `AgentEvalScenario`。
历史缺陷场景使用 `regression` 字段记录稳定 ID、原始症状与必须保持的系统不变量；
报告会保留这些来源信息。`regression` tag 可单独运行这组防复发场景。

每次运行都会写入 `.artifacts/evals/report.json`。失败场景另存到
`.artifacts/evals/failures/<scenario-id>.json`，`failures/index.json` 是本次运行的权威失败清单。
这些诊断包含归一化 trace、UI event、模型请求、审批记录和最终工作区状态，不提交到 Git。

多回合场景使用 `actions` 描述生命周期；当前支持：

- `send`：发送消息，可选择不等待回合完成。
- `awaitTurn`：等待先前启动的回合结束。
- `resolveApproval`：批准或拒绝脚本化的等待中审批。
- `abort`：停止当前 Agent。
- `abortAfterStaged`：等暂存审批出现后停止当前回合。
- `approveStaged` / `discardStaged` / `deferStaged`：驱动真实暂存审批门。
- `destroyAgent`：释放 Runner 对当前实例的引用。
- `restoreAgent`：通过真实 `SessionEvent` 投影创建新实例；可附加损坏尾行验证容错。

恢复不会复用旧 Agent 的内存 history，而是调用 `projectSessionState()` 从事件流重新生成
`transcript` 与 `llmHistory`，再注入新实例。

## 当前边界

当前覆盖纯代码的确定性 Agent、session event 投影、staging 重建、conversation checkpoint
快照，以及 Plan commit/head 和步骤 checkpoint 恢复。浏览器 IndexedDB、真实文件夹、真实模型质量
和成本不在本阶段范围内。

`.github/workflows/regression.yml` 会在涉及 frontend 的 pull request、main push 和手动触发时
运行同一命令，并无论成功失败都上传诊断 artifact。Vitest 退出码是 CI gate；JSON 报告用于定位，
不会替代测试结果。

## Phase 2：真实模型评测

真实模型入口默认不会调用网络。必须明确选择 `--dry-run` 或 `--live`，并通过
`--api-key-env` 指定一个已经存在的环境变量；Key 不会写入参数、日志或报告。

先做无费用配置检查：

```powershell
$env:COTTAGE_LIVE_API_KEY = '仅用于本地 dry-run 的占位值'
pnpm eval:live -- --dry-run --provider openai --model 'your-model-id' --api-key-env COTTAGE_LIVE_API_KEY
```

明确发起真实调用：

```powershell
$env:COTTAGE_LIVE_API_KEY = '<your key>'
pnpm eval:live -- --live --provider openai --model 'your-model-id' `
  --api-key-env COTTAGE_LIVE_API_KEY --max-cases 3 --max-model-calls 8 `
  --max-total-tokens 12000 --max-duration-ms 180000
```

可用 `--case <id>`、`--tag <tag>` 缩小范围。当前 live corpus 包含 23 个场景。原有 15 个 chat
场景覆盖精确指令遵循、单文件与多文件依据读取、文件内提示注入、缺失文件回退、避免无效写入、
受控创建、相似路径精确修改、Unicode 保留、嵌套路径、单文件与批量删除、只读清理评估和空文件边界。
另有 8 个 `plan` 场景。Plan Mode 工具建议与多文件 DAG 执行拆成独立场景，避免建议失败时掩盖
后续计划能力；其余覆盖脚本化批准、批准前零写入、最小路径范围、步骤 DAG、
逐步骤写入归属、文件提示注入隔离、验证不可用时进入人工验收、越界后请求 revision 并重新批准、
省略模型 `changedFiles` 提示时仍以 Mutation Journal 为权威，以及轮次预算耗尽时零写入暂停。
评分以工具调用和最终工作区状态为主，使用确定性加权检查；默认最低通过分为 `0.8`。
通用报告只保留截断回复、工具名/状态、变更路径、token 和耗时；每个 case 的 `modelCallDetails`
按调用记录阶段、消息数量/字符数、工具数量、耗时和 usage，不记录完整请求。Plan case 另外保留受控 fixture
工作区的最终快照，用于判断复杂任务结果。报告不保存 API Key、完整模型请求或完整推理内容。

如果显式提供 `--input-price-per-million` 和 `--output-price-per-million`，报告会按实际 token
估算费用；框架不内置可能过期的模型价格。`.github/workflows/live-eval.yml` 只支持手动触发，
需要受保护的 `live-eval` environment 和 `LIVE_EVAL_API_KEY` secret，不作为普通 PR 硬 gate。

Windows 本地可复制并填写 `scripts/run-live-eval.local.ps1`；该文件已经被 `.gitignore`
精确忽略。可提交模板为 `scripts/run-live-eval.example.ps1`，它不包含 Key，只读取
`COTTAGE_LIVE_API_KEY` 或通过 `-ApiKeyEnv` 指定的进程环境变量。

日常手工评测也可以直接打开应用的「调试 → 模型评测」。该工作台复用设置中已有的模型
预设和对应连接，可多选 case、设置重复次数与每轮调用/token/时长上限，并在发起真实调用前
再次确认预算。case、评分器和预算器与 CLI 共用；受控写入只发生在隔离评测工作区（内存工作区
或专用目录中的单次 case 副本），不会触碰当前项目工作区。

浏览器工作台默认只选择带 `smoke` tag 的 3 个核心场景，避免打开页面后误触发完整回归费用。
场景选择器会把普通 Agent 与 Plan Mode 回归分组展示；每个分组标题都可独立全选、取消，并显示
部分选中状态。选择 Plan 分组时会自动提高对应的调用、Token 和时长预算。
点击「选择全部」会显式选择 23 个场景。预算按 chat case 3 次/3,000 Token、Plan 建议 case
2 次/5,000 Token、普通 Plan case 12 次/40,000 Token、多文件 DAG case 12 次/70,000 Token、
越界 revision case 20 次/80,000 Token、Journal case 8 次/25,000 Token、预算耗尽 case 3 次/10,000 Token
估算单轮下限；选择 Plan 场景时单次输出上限至少提高到 3,000 Token，完整集时长下限为 900 秒。
最终仍以确认框中显示的预算为准。CLI 保持默认最多执行 3 个
case，完整运行需要明确传入 `--max-cases 23` 及相应调用、Token
和时长上限。只跑计划回归可使用 `--tag plan --max-cases 8`。

Plan live harness 不启动 UI/e2e。独立建议场景只验证真实 `suggestPlanMode` 工具调用并在确认后结束，
不继续消耗 DAG 执行预算；其余场景直接从公开 Plan Mode 草拟入口开始。随后均使用真实 `createPlanTools`、
`PlanRunner`、`PlanToolGuard` 和统一工具执行器。计划审批由单 case 的脚本自动响应；路径解析、排他锁、
检查点和 Mutation Journal 通过运行时依赖注入绑定到该 case 的隔离工作区，生产默认实现不变，安全检查
不会为了评测关闭。内存与专用目录模式使用同一条 Plan harness，专用目录仍只把对应
`runs/.../cases/<case-id>/workspace/` 交给模型工具。

每次批准后的 Plan 状态边界都会用 `buildPlanExecutionContext()` 从权威 definition/run 重建受限的
LLM 上下文投影，包含目标、requirements、design、当前步骤与验收、finalAcceptance、依赖证据、
Mutation Journal 实际 changedFiles、批准时验证能力快照、失败历史、剩余预算和用户追加指令。
完整展示与审计 transcript 保留不变，不会因为模型上下文压缩而丢失。

Plan case 报告的 `plan` 字段记录建议、每个 definition revision、审批决策、Runner 状态事件、
工具 MutationReport 与步骤归属、模型可选 `changedFiles` 提示和 Journal 实际文件、步骤前 checkpoint、
验证结果、最终 definition/run、最终工作区快照和评测状态提交序号。
报告不记录 API Key、完整模型请求或完整推理内容。当前仍未覆盖 checkpoint/head 崩溃恢复、
部分写入失败和外部副作用分类；这些应作为后续 corpus，
不能由本批通过结果代替。

目录基线仍保存一份完整报告，并且只与 case 集合完全一致的当前报告比较。比较明细按照报告中的
case tag 分为“普通 Agent”和“Plan”两组；这只是展示分组，不改变 `baselines/current.json` 格式，
也不会把一个完整基线静默拆成多个独立基线。

浏览器报告保存在独立的 `open-cottage-evals` IndexedDB 中，最多保留最近 50 份，可在界面中
回看、删除或导出 JSON。报告不包含 API Key 和完整模型请求。CLI 仍用于无头执行与 CI，输出
到 `.artifacts/evals/live-report.json`。

工作台提供两种工作区模式：

- 「隔离内存」不接触本地文件，适合快速质量检查。
- 「专用本地目录」通过 File System Access API 选择文件夹。首次初始化只接受空目录，并写入
  `eval-workspace.json` 标记；已初始化目录必须带有兼容标记，避免误选项目目录或个人文件夹。

专用目录的数据结构如下：

```text
eval-workspace.json
fixtures/<case-id>/...
runs/<batch-id>/run-<n>/run.json
runs/<batch-id>/run-<n>/cases/<case-id>/workspace/...
runs/<batch-id>/run-<n>/report.json
baselines/current.json
```

每个 case 只获得自己 `workspace/` 子目录的句柄，路径解析禁止越过该根目录。fixture 不会交给
Agent；每一轮都会创建新的隔离运行目录。目录句柄保存在浏览器 IndexedDB 中用于恢复，但浏览器
若不再授予权限，用户必须重新选择目录。目录历史直接扫描 `runs/`，因此换浏览器后重新授权同一
目录即可读取既有报告。删除目录历史会同时删除对应轮次的隔离副本，需在界面中再次确认。

目录历史中的任意一轮都可以设为基线。基线以完整报告快照写入 `baselines/current.json`，不会
修改来源运行；替换或清除基线都需要明确操作，删除来源运行也不会破坏已经保存的基线。查看
其他运行时，界面会比较通过数、平均分、调用次数、Token、耗时，以及每个 case 的改善或退化。
只有场景集合相同的报告才会进行直接比较，模型可以不同，以便比较不同模型在同一 corpus 上的
表现。评测目录可以整体纳入 Git，用提交历史记录 fixture、运行报告与基线的变化。
