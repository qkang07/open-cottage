import type { IndexPhase, IndexProgress } from './types';

export interface IndexStepDef {
  phase: IndexPhase;
  title: string;
  description: string;
}

export const INDEX_STEPS: IndexStepDef[] = [
  {
    phase: 'init',
    title: '初始化',
    description: '加载嵌入库与模型',
  },
  {
    phase: 'scanning',
    title: '扫描结构',
    description: '读取工作区文件列表',
  },
  {
    phase: 'analyzing',
    title: '比对变更',
    description: '检测新增与修改的文件',
  },
  {
    phase: 'chunking',
    title: '文件分块',
    description: '逐文件切分文本片段',
  },
  {
    phase: 'embedding',
    title: '向量嵌入',
    description: '计算语义向量',
  },
  {
    phase: 'saving',
    title: '保存索引',
    description: '写入 .cottage/index/',
  },
];

const PHASE_ORDER: IndexPhase[] = [
  'init',
  'scanning',
  'analyzing',
  'chunking',
  'embedding',
  'saving',
  'done',
];

export const getPhaseIndex = (phase: IndexPhase): number => {
  const idx = PHASE_ORDER.indexOf(phase);
  return idx === -1 ? 0 : Math.min(idx, INDEX_STEPS.length - 1);
};

export const getStepStatus = (
  stepPhase: IndexPhase,
  currentPhase: IndexPhase,
): 'wait' | 'process' | 'finish' => {
  const stepIdx = getPhaseIndex(stepPhase);
  const currentIdx = getPhaseIndex(currentPhase);
  if (currentPhase === 'done') return 'finish';
  if (stepIdx < currentIdx) return 'finish';
  if (stepIdx === currentIdx) return 'process';
  return 'wait';
};

export const formatProgressPercent = (progress: IndexProgress): number => {
  if (progress.phase === 'done') return 100;
  if (progress.total <= 0) {
    return progress.phase === 'init' ? 30 : 0;
  }
  return Math.min(100, Math.round((progress.current / progress.total) * 100));
};

export const formatProgressDetail = (progress: IndexProgress): string => {
  if (progress.detail) return progress.detail;

  switch (progress.phase) {
    case 'init':
      return '准备嵌入环境…';
    case 'scanning':
      return progress.total > 0
        ? `发现 ${progress.total} 个可索引文件`
        : '正在枚举工作区文件…';
    case 'analyzing':
      return progress.currentFile
        ? `比对 ${progress.current}/${progress.total} · ${progress.currentFile}`
        : `比对文件变更 ${progress.current}/${progress.total}`;
    case 'chunking':
      return progress.currentFile
        ? `分块 ${progress.current}/${progress.total} · ${progress.currentFile}`
        : `分块 ${progress.current}/${progress.total}`;
    case 'embedding':
      return progress.currentFile
        ? `嵌入 ${progress.current}/${progress.total} 片段 · ${progress.currentFile}`
        : `嵌入 ${progress.current}/${progress.total} 片段`;
    case 'saving':
      return progress.detail ?? `保存索引 ${progress.current}/${progress.total}`;
    case 'done':
      return `完成，共 ${progress.total} 个片段`;
  }
};
