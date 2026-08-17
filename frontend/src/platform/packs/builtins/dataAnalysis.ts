import type { CottageTool } from '@/agent/runtime/tool';
import { createPythonCottageTool } from '../../../agent/pythonCottageTool';
import { PYTHON_TOOL_NAMES } from '../../../agent/toolCatalog';
import { getCottageConfig } from '../../../config/store';
import type { BuiltinCapabilityPack } from './types';

const PYTHON_PROMPT = `【数据分析（Python）能力包已启用】
- runPython：在浏览器内 Pyodide (WASM) 执行 Python，支持 numpy / pandas / scipy / matplotlib。
- 无网络访问、无持久化文件系统，超时 120s；适合数据分析、计算与统计绘图。
- 大量数据处理优先用 Python，而非手工逐条编辑。`;

export const DATA_ANALYSIS_PACK: BuiltinCapabilityPack = {
  id: 'builtin.data-analysis',
  name: '数据分析（Python）',
  domain: 'coding',
  description: '在 Pyodide 中运行 Python 完成数据分析、计算与绘图。',
  groupId: 'python',
  toolNames: PYTHON_TOOL_NAMES,
  capabilityIds: ['data.python'],
  promptOverlay: PYTHON_PROMPT,
  riskLevel: 'write',
  intentKeywords: [
    'python',
    '数据分析',
    'pandas',
    'numpy',
    '统计',
    '绘图',
    'matplotlib',
    '计算',
  ],
  createTools: (): CottageTool[] => {
    // Python 工具额外受 python.enabled 配置门控
    if (!getCottageConfig().python?.enabled) return [];
    return [createPythonCottageTool()];
  },
};
