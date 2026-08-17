import type { BuiltinCapabilityPack } from '../../platform/packs/builtins/types';

export const DATA_ANALYSIS_PACK: BuiltinCapabilityPack = {
  id: 'builtin.data-analysis',
  name: '数据分析（Python）',
  domain: 'coding',
  description: '当前构建未包含 Python 数据分析能力。',
  groupId: 'python',
  toolNames: ['runPython'],
  capabilityIds: ['data.python'],
  promptOverlay: '',
  riskLevel: 'write',
  intentKeywords: [],
  createTools: () => [],
};

