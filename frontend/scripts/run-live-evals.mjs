import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const env = { ...process.env };
const cases = [];
const tags = [];
let mode;

const valueFor = (flag, index) => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} 需要一个值`);
  return value;
};

const valueFlags = new Map([
  ['--provider', 'COTTAGE_LIVE_PROVIDER'],
  ['--model', 'COTTAGE_LIVE_MODEL'],
  ['--api-key-env', 'COTTAGE_LIVE_API_KEY_ENV'],
  ['--base-url', 'COTTAGE_LIVE_BASE_URL'],
  ['--report', 'COTTAGE_LIVE_REPORT'],
  ['--max-cases', 'COTTAGE_LIVE_MAX_CASES'],
  ['--max-model-calls', 'COTTAGE_LIVE_MAX_MODEL_CALLS'],
  ['--max-total-tokens', 'COTTAGE_LIVE_MAX_TOTAL_TOKENS'],
  ['--max-duration-ms', 'COTTAGE_LIVE_MAX_DURATION_MS'],
  ['--max-output-tokens', 'COTTAGE_LIVE_MAX_OUTPUT_TOKENS'],
  ['--min-score', 'COTTAGE_LIVE_MIN_SCORE'],
  ['--input-price-per-million', 'COTTAGE_LIVE_INPUT_PRICE_PER_MILLION'],
  ['--output-price-per-million', 'COTTAGE_LIVE_OUTPUT_PRICE_PER_MILLION'],
]);

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--') {
    continue;
  } else if (arg === '--live' || arg === '--dry-run') {
    if (mode) throw new Error('--live 与 --dry-run 只能选择一个');
    mode = arg;
  } else if (arg === '--case' || arg === '--tag') {
    const value = valueFor(arg, index);
    (arg === '--case' ? cases : tags).push(value);
    index += 1;
  } else if (valueFlags.has(arg)) {
    env[valueFlags.get(arg)] = valueFor(arg, index);
    index += 1;
  } else {
    throw new Error(`未知参数：${arg}`);
  }
}

if (!mode) throw new Error('必须显式传入 --live 或 --dry-run');
env.COTTAGE_LIVE_ENABLED = mode === '--live' ? '1' : '0';
env.COTTAGE_LIVE_DRY_RUN = mode === '--dry-run' ? '1' : '0';
env.COTTAGE_LIVE_CASES = cases.join(',');
env.COTTAGE_LIVE_TAGS = tags.join(',');

const vitestBin = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
);
const child = spawn(
  process.execPath,
  [vitestBin, 'run', 'src/evals/live/liveEntry.test.ts'],
  { stdio: 'inherit', env },
);
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
