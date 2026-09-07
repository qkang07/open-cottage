import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const scenarioIds = [];
const tags = [];
let reportPath;

const takeValue = (flag, index) => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} 需要一个值`);
  }
  return value;
};

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--scenario') {
    scenarioIds.push(takeValue(arg, index));
    index += 1;
  } else if (arg === '--tag') {
    tags.push(takeValue(arg, index));
    index += 1;
  } else if (arg === '--report') {
    reportPath = takeValue(arg, index);
    index += 1;
  } else {
    throw new Error(`未知参数：${arg}`);
  }
}

const vitestBin = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
);
const env = {
  ...process.env,
  COTTAGE_EVAL_SCENARIOS: scenarioIds.join(','),
  COTTAGE_EVAL_TAGS: tags.join(','),
  ...(reportPath ? { COTTAGE_EVAL_REPORT: reportPath } : {}),
};
const child = spawn(
  process.execPath,
  [
    vitestBin,
    'run',
    'src/evals/runner.test.ts',
    'src/evals/selection.test.ts',
    'src/evals/checkpointRecovery.test.ts',
    'src/evals/protocolMatrix.test.ts',
    'src/evals/workspaceLockContention.test.ts',
    'src/evals/live/config.test.ts',
    'src/evals/live/budget.test.ts',
    'src/agent/conversationCheckpoint.test.ts',
    'src/plan/repository.test.ts',
    'src/plan/runner.test.ts',
  ],
  { stdio: 'inherit', env },
);

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
