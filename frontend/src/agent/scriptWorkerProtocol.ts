import type { ApplyPatchesInput } from './patchFile';

export type WorkerRequestWithoutId =
  | { type: 'listFiles'; prefix?: string }
  | { type: 'readFile'; path: string }
  | { type: 'writeFile'; path: string; content: string }
  | { type: 'createFile'; path: string; content?: string }
  | { type: 'patchFile'; path: string; patches: ApplyPatchesInput }
  | { type: 'exists'; path: string }
  | { type: 'deleteFiles'; paths: string[] }
  | { type: 'mkdir'; path: string }
  | { type: 'rename'; from: string; to: string }
  | { type: 'compress'; paths: string[]; outputPath: string }
  | {
      type: 'extract';
      archivePath: string;
      targetDir?: string;
    }
  | { type: 'invokeTool'; name: string; args: unknown };

export type WorkerRequest = WorkerRequestWithoutId & { id: number };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

export type WorkerHostMessage =
  | { type: 'run'; code: string }
  | WorkerResponse;

export type WorkerOutbound =
  | WorkerRequest
  | { type: 'done'; result: unknown }
  | { type: 'error'; error: string }
  | { type: 'log'; args: unknown[] };

/** Cottage runScript 工具说明（与 Worker 内 api / cottage 代理一致） */
export const RUN_SCRIPT_TOOL_DESCRIPTION = `在隔离 Web Worker 中执行 JavaScript（参数 code）。

约束：
- 不能使用 import/require，不能访问 DOM、fetch，不能直接调用 Cottage 工具名（readFile 等）
- 所有工作区 IO 必须通过注入的 api 对象；其他 agent 工具经 cottage 对象调用，均由主线程代理
- 每次执行前需用户统一审批一次：脚本内经 cottage 调用的工具（含高危工具）随本次批准一并授权

code 为 async 函数体：在最外层 await api.* / cottage.*，并 return 可 JSON 序列化的结果（验收脚本常用 return { ok: true }）。勿只定义 async 函数而不 await。

api（均返回 Promise）：
- listFiles(prefix?) → string[]
- readFile(path) → { path, content }
- writeFile(path, content) / createFile(path, content?)
- patchFile(path, { lines?, columns?, regex? })
- exists(path) → boolean
- deleteFiles(paths) → 删除文件或文件夹（递归），paths 为路径数组
- mkdir / rename / compress / extract
- log(...args) → 写入返回的 logs

cottage（agent 工具 SDK，均返回 Promise）：
- cottage.<工具名>(参数对象) 可调用当前会话可用的 agent 工具，参数与该工具的 schema 一致
- 示例：await cottage.searchFiles({ query: 'TODO' })、await cottage.webSearch({ query: '...' })、await cottage.readSpreadsheet({ path: 'a.xlsx' })
- 交互 / 流程控制类工具（askUser、loadTools、plan*、task*、spec* 等）与 runScript 自身不可调用

示例：
const { content } = await api.readFile('out.txt');
return { ok: content.includes('done') };`;

export const serializeScriptResult = (value: unknown): unknown => {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    throw new Error('脚本返回值须为可 JSON 序列化的数据');
  }
};
