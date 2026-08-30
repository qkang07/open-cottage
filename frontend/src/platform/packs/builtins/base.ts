import type { CapabilityRiskLevel } from '../../capabilities/types';
import { BASE_TOOL_NAMES } from '../../../agent/toolCatalog';

/**
 * 基础能力包：默认始终可用，无需开关。
 * 聚合最基础的文件读写、查找、搜索与压缩解压等操作，是其他领域能力包的底座。
 */
export interface BaseCapabilityPack {
  id: string;
  name: string;
  description: string;
  /** 该包提供的工具名（始终可用） */
  toolNames: readonly string[];
  /** 领域提示词要点 */
  promptOverlay: string;
  /** 整体风险级别（用于治理展示） */
  riskLevel: CapabilityRiskLevel;
  /** 始终启用，不可关闭 */
  alwaysOn: true;
}

const BASE_PROMPT = `【基础能力包（始终可用）】
- 项目约定与技能：系统已注入 AGENTS.md/AGENT.md（若存在）与 SKILLS 摘要/小技能全文；勿为熟悉项目而扫根目录或重读这些文件。
- 核心工具（直接可调用）：listDirectory、findFiles、searchFiles、readFile、editFile、writeFile/createFile、deleteFiles、mkdir、rename、copy；联网 webSearch/fetchWebPage；askUser。
- 延后工具：见 <available_deferred_tools>（如 runScript、applyPatch、compress、statFile、历史检查点等）。先 loadTools({ names: [...] }) 获取参数说明并启用，再调用。
- 浏览定位优先 findFiles / searchFiles / listDirectory；大文件用 readFile 的 offset/limit。
- 修改优先 editFile；多文件/unified diff 等先 loadTools('applyPatch')。
- 批量编辑多个文件前先完成只读影响分析，再进入计划模式提交覆盖全部目标的一份变更计划；用户一次批准后连续执行范围内普通写入，不要逐文件询问。
- 删除文件或文件夹（递归）统一用 deleteFiles；多个目标一次传入批量删除，勿逐个调用。
- 脚本 / 压缩等低频能力均走延后加载，避免默认撑爆工具列表。`;

export const BASE_PACK: BaseCapabilityPack = {
  id: 'builtin.base',
  name: '基础能力包',
  description:
    '默认始终可用：文件读写与管理、内容查找与搜索、压缩解压、脚本执行与联网搜索等基础操作，是所有任务的底座。',
  toolNames: BASE_TOOL_NAMES,
  promptOverlay: BASE_PROMPT,
  riskLevel: 'write',
  alwaysOn: true,
};
