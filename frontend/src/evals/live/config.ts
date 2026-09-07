import {
  isKnownProviderId,
  type LlmProviderId,
} from '../../config/llmProviders';
import type { LiveEvalConfig } from './types';

const positiveNumber = (
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number => {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} 必须是正数`);
  return value;
};

const list = (value: string | undefined) =>
  (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

export const loadLiveEvalConfig = (
  env: Record<string, string | undefined> = process.env,
): LiveEvalConfig => {
  const providerRaw = env.COTTAGE_LIVE_PROVIDER?.trim().toLowerCase();
  const model = env.COTTAGE_LIVE_MODEL?.trim() ?? '';
  const apiKeyEnv = env.COTTAGE_LIVE_API_KEY_ENV?.trim() ?? '';
  if (!providerRaw) throw new Error('缺少 --provider');
  if (!isKnownProviderId(providerRaw)) throw new Error(`不支持的 provider：${providerRaw}`);
  if (!model) throw new Error('缺少 --model');
  if (!apiKeyEnv) throw new Error('缺少 --api-key-env');
  if (!/^[A-Z_][A-Z0-9_]*$/i.test(apiKeyEnv)) {
    throw new Error('--api-key-env 必须是合法的环境变量名');
  }
  const apiKey = env[apiKeyEnv]?.trim() ?? '';
  if (!apiKey) throw new Error(`环境变量 ${apiKeyEnv} 未设置或为空`);

  return {
    enabled: env.COTTAGE_LIVE_ENABLED === '1',
    dryRun: env.COTTAGE_LIVE_DRY_RUN === '1',
    provider: providerRaw as LlmProviderId,
    model,
    connectionId: 'live-eval',
    apiKeyEnv,
    apiKey,
    ...(env.COTTAGE_LIVE_BASE_URL?.trim()
      ? { baseUrl: env.COTTAGE_LIVE_BASE_URL.trim() }
      : {}),
    caseIds: list(env.COTTAGE_LIVE_CASES),
    tags: list(env.COTTAGE_LIVE_TAGS),
    budget: {
      maxCases: Math.floor(positiveNumber(env, 'COTTAGE_LIVE_MAX_CASES', 3)),
      maxModelCalls: Math.floor(positiveNumber(env, 'COTTAGE_LIVE_MAX_MODEL_CALLS', 8)),
      maxTotalTokens: Math.floor(positiveNumber(env, 'COTTAGE_LIVE_MAX_TOTAL_TOKENS', 12_000)),
      maxDurationMs: Math.floor(positiveNumber(env, 'COTTAGE_LIVE_MAX_DURATION_MS', 180_000)),
      maxOutputTokens: Math.floor(positiveNumber(env, 'COTTAGE_LIVE_MAX_OUTPUT_TOKENS', 1_000)),
    },
    minimumScore: positiveNumber(env, 'COTTAGE_LIVE_MIN_SCORE', 0.8),
    ...(env.COTTAGE_LIVE_INPUT_PRICE_PER_MILLION?.trim()
      ? { inputPricePerMillion: positiveNumber(env, 'COTTAGE_LIVE_INPUT_PRICE_PER_MILLION', 0) }
      : {}),
    ...(env.COTTAGE_LIVE_OUTPUT_PRICE_PER_MILLION?.trim()
      ? { outputPricePerMillion: positiveNumber(env, 'COTTAGE_LIVE_OUTPUT_PRICE_PER_MILLION', 0) }
      : {}),
    reportPath: env.COTTAGE_LIVE_REPORT?.trim() || '.artifacts/evals/live-report.json',
  };
};

export const validateLiveEvalConfig = (config: LiveEvalConfig): string[] => {
  const errors: string[] = [];
  if (!config.enabled && !config.dryRun) errors.push('必须显式传入 --live 或 --dry-run');
  if (config.minimumScore > 1) errors.push('最低得分不能大于 1');
  if (config.budget.maxCases > 30) errors.push('单次真实模型评测最多允许 30 个 case');
  if (config.budget.maxModelCalls > 200) errors.push('单次真实模型评测最多允许 200 次模型调用');
  return errors;
};
