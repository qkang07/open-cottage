export interface DoomLoopPattern {
  reason: string;
  pattern: string;
}

type DoomLoopStatus = 'ok' | 'error' | 'blocked';

interface DoomLoopRecord {
  name: string;
  argsHash: string;
  status: DoomLoopStatus;
}

export interface DoomLoopDetector {
  check: (input: { name: string; args: unknown }) => DoomLoopPattern | null;
  record: (input: {
    name: string;
    args: unknown;
    status: DoomLoopStatus;
  }) => void;
  reset: () => void;
}

export interface CreateDoomLoopDetectorOptions {
  sameArgsThreshold?: number;
  sameNameFailThreshold?: number;
  windowSize?: number;
}

const hashArgs = (args: unknown): string => JSON.stringify(args ?? {});

export const createDoomLoopDetector = (
  options: CreateDoomLoopDetectorOptions = {},
): DoomLoopDetector => {
  const sameArgsThreshold = options.sameArgsThreshold ?? 3;
  const sameNameFailThreshold = options.sameNameFailThreshold ?? 3;
  const windowSize = options.windowSize ?? 12;
  const records: DoomLoopRecord[] = [];

  const trim = () => {
    if (records.length > windowSize * 2) {
      records.splice(0, records.length - windowSize);
    }
  };

  return {
    check({ name, args }) {
      const argsHash = hashArgs(args);
      const recent = records.slice(-windowSize);
      const sameArgsCount = recent.filter(
        (record) => record.name === name && record.argsHash === argsHash,
      ).length;
      if (sameArgsCount >= sameArgsThreshold - 1) {
        return {
          reason: '同工具同参数重复调用',
          pattern: `${name} · ${argsHash.slice(0, 120)}`,
        };
      }

      const sameNameErrors = recent.filter(
        (record) => record.name === name && record.status === 'error',
      ).length;
      if (sameNameErrors >= sameNameFailThreshold - 1) {
        return {
          reason: '同工具连续失败',
          pattern: name,
        };
      }

      return null;
    },
    record(input) {
      records.push({
        name: input.name,
        argsHash: hashArgs(input.args),
        status: input.status,
      });
      trim();
    },
    reset() {
      records.length = 0;
    },
  };
};

export const DOOM_LOOP_TOOL_NAME = 'doom_loop';

/** 同一回合内，前 N 次 doom loop 仅向模型返回提醒；之后再提用户闸门 */
export const DOOM_LOOP_SOFT_WARN_LIMIT = 2;

export const buildDoomLoopSoftWarnMessage = (input: {
  toolName: string;
  reason: string;
  pattern: string;
  hitCount: number;
  softLimit: number;
}): string => {
  const remaining = Math.max(0, input.softLimit - input.hitCount);
  const escalateHint =
    remaining > 0
      ? `若再出现 ${remaining} 次类似循环，将暂停并请用户确认。`
      : '若继续循环，将暂停并请用户确认。';
  return (
    `疑似工具调用循环（${input.reason}）。` +
    `本次已跳过对「${input.toolName}」的执行（${input.pattern}）。` +
    `请换参数、换工具，或先总结已有结果再继续；不要用相同方式原样重试。` +
    escalateHint
  );
};
