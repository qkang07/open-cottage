import {
  runAcceptanceCheck,
  type AcceptanceCheck,
  type CheckResult,
} from '../platform/verify';
import { workspace } from '../workspace/FileSystemWorkspace';
import { hashBytes } from '../history/storage';
import type {
  AcceptanceCriterion,
  PlanManifest,
  VerificationCapability,
  VerificationAssurance,
  VerificationRuntime,
  JsonSchema,
} from './types';

export interface VerifyContext {
  manifest?: PlanManifest | null;
  signal?: AbortSignal;
  capabilitySnapshot?: VerificationCapability[];
  allowedPathPrefixes?: string[];
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface VerificationProvider {
  id: string;
  version: string;
  label: string;
  runtime: VerificationRuntime;
  assurance: VerificationAssurance;
  configSchema: JsonSchema;
  trusted?: boolean;
  capabilities: string[];
  isAvailable(context?: VerifyContext): boolean;
  validateConfig(config: unknown): ValidationResult;
  run(
    criterion: AcceptanceCriterion,
    context: VerifyContext,
  ): Promise<CheckResult>;
}

const objectSchema = (required: string[] = []): JsonSchema => ({
  type: 'object',
  properties: Object.fromEntries(
    required.map((key) => [key, { type: key === 'inputPaths' ? 'array' : 'string' }]),
  ),
  required,
  additionalProperties: true,
});

const schemaDigest = (schema: JsonSchema): string => {
  const source = JSON.stringify(schema);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const unavailable = (
  criterion: AcceptanceCriterion,
  runtime: VerificationRuntime,
  reason: string,
): CheckResult => ({
  id: criterion.id,
  type: 'contentMatches',
  description: criterion.description,
  target: criterion.providerId,
  pass: false,
  status: 'unavailable',
  providerId: criterion.providerId,
  runtime,
  reason,
});

const failedConfig = (
  criterion: AcceptanceCriterion,
  runtime: VerificationRuntime,
  reason: string,
): CheckResult => ({
  ...unavailable(criterion, runtime, reason),
  status: 'failed',
});

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const workspaceCheckProvider = (
  id: string,
  label: string,
  type: AcceptanceCheck['type'],
  requiredKeys: string[],
): VerificationProvider => ({
  id,
  version: '1',
  label,
  runtime: 'browser',
  assurance: 'structural',
  configSchema: objectSchema(requiredKeys),
  capabilities: [type],
  isAvailable: () => workspace.isOpen,
  validateConfig: (config) => {
    if (!config || typeof config !== 'object') return { valid: false, reason: 'config 必须是对象' };
    const record = config as Record<string, unknown>;
    const missing = requiredKeys.filter((key) => record[key] === undefined || record[key] === '');
    return missing.length
      ? { valid: false, reason: `缺少配置：${missing.join(', ')}` }
      : { valid: true };
  },
  run: async (criterion) => {
    const validation = workspaceCheckProvider(id, label, type, requiredKeys).validateConfig(
      criterion.config,
    );
    if (!validation.valid) {
      return failedConfig(criterion, 'browser', validation.reason ?? '配置无效');
    }
    const result = await runAcceptanceCheck({
      id: criterion.id,
      type,
      description: criterion.description,
      ...criterion.config,
    } as AcceptanceCheck);
    return {
      ...result,
      status: result.pass ? 'passed' : 'failed',
      providerId: id,
      runtime: 'browser',
    };
  },
});

const manifestProvider: VerificationProvider = {
  id: 'workspace.manifestCoverage',
  version: '1',
  label: '交付清单覆盖',
  runtime: 'browser',
  assurance: 'structural',
  configSchema: objectSchema(),
  capabilities: ['manifestCoverage'],
  isAvailable: () => workspace.isOpen,
  validateConfig: () => ({ valid: true }),
  run: async (criterion, context) => {
    const manifest = context.manifest;
    if (!manifest) return unavailable(criterion, 'browser', '尚未生成交付清单');
    const missing: string[] = [];
    for (const path of manifest.paths) {
      if (!(await workspace.exists(path))) missing.push(path);
    }
    const minCount = Number(criterion.config.minCount ?? 0);
    const pass = missing.length === 0 && manifest.paths.length >= minCount;
    return {
      id: criterion.id,
      type: 'manifestCoverage',
      description: criterion.description,
      target: 'manifest',
      pass,
      status: pass ? 'passed' : 'failed',
      providerId: criterion.providerId,
      runtime: 'browser',
      reason: pass
        ? undefined
        : missing.length
          ? `清单路径不存在：${missing.join(', ')}`
          : `清单条目数少于 ${minCount}`,
    };
  },
};

const userAcceptanceProvider: VerificationProvider = {
  id: 'user.acceptance',
  version: '1',
  label: '用户人工验收',
  runtime: 'human',
  assurance: 'human',
  configSchema: objectSchema(),
  capabilities: ['manual'],
  isAvailable: () => true,
  validateConfig: () => ({ valid: true }),
  run: async (criterion) => ({
    id: criterion.id,
    type: 'contentMatches',
    description: criterion.description,
    target: 'user',
    pass: false,
    status: 'manual',
    providerId: criterion.providerId,
    runtime: 'human',
    reason: '需要用户确认',
  }),
};

const jsonValidProvider: VerificationProvider = {
  id: 'workspace.jsonValid',
  version: '1',
  label: 'JSON 可解析',
  runtime: 'browser',
  assurance: 'structural',
  configSchema: objectSchema(['path']),
  capabilities: ['jsonValid'],
  isAvailable: () => workspace.isOpen,
  validateConfig: (config) => {
    const path = config && typeof config === 'object'
      ? asString((config as Record<string, unknown>).path)
      : undefined;
    return path ? { valid: true } : { valid: false, reason: '需要 path' };
  },
  run: async (criterion) => {
    const validation = jsonValidProvider.validateConfig(criterion.config);
    if (!validation.valid) return failedConfig(criterion, 'browser', validation.reason ?? '配置无效');
    const path = String(criterion.config.path);
    try {
      JSON.parse((await workspace.readFile(path)).content);
      return {
        id: criterion.id,
        type: 'jsonField',
        description: criterion.description,
        target: path,
        pass: true,
        status: 'passed',
        providerId: criterion.providerId,
        runtime: 'browser',
      };
    } catch (error) {
      return failedConfig(
        criterion,
        'browser',
        `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },
};

const contentHashProvider: VerificationProvider = {
  id: 'workspace.contentHash',
  version: '2',
  label: '内容回读与 SHA-256',
  runtime: 'browser',
  assurance: 'structural',
  configSchema: objectSchema(['path']),
  capabilities: ['contentHash'],
  isAvailable: () => workspace.isOpen,
  validateConfig: (config) => {
    if (!config || typeof config !== 'object') return { valid: false, reason: 'config 必须是对象' };
    const record = config as Record<string, unknown>;
    return asString(record.path)
      ? { valid: true }
      : { valid: false, reason: '需要 path；sha256 可选，仅用于比对预期值' };
  },
  run: async (criterion) => {
    const validation = contentHashProvider.validateConfig(criterion.config);
    if (!validation.valid) return failedConfig(criterion, 'browser', validation.reason ?? '配置无效');
    const path = String(criterion.config.path);
    try {
      const actual = await hashBytes(await workspace.readFileBytes(path));
      const expected = asString(criterion.config.sha256)?.toLowerCase();
      const pass = expected ? actual === expected : true;
      return {
        id: criterion.id,
        type: 'contentMatches',
        description: criterion.description,
        target: path,
        pass,
        status: pass ? 'passed' : 'failed',
        providerId: criterion.providerId,
        runtime: 'browser',
        reason: pass ? undefined : `SHA-256 不匹配：${actual}`,
      };
    } catch (error) {
      return failedConfig(
        criterion,
        'browser',
        error instanceof Error ? error.message : String(error),
      );
    }
  },
};

interface WorkerCheckConfig {
  source: string;
  inputPaths: string[];
  timeoutMs?: number;
}

const validateWorkerConfig = (config: unknown): ValidationResult => {
  if (!config || typeof config !== 'object') return { valid: false, reason: 'config 必须是对象' };
  const value = config as Record<string, unknown>;
  const source = asString(value.source);
  if (!source) return { valid: false, reason: '缺少 source' };
  if (
    /\b(?:importScripts|fetch|XMLHttpRequest|WebSocket|EventSource|WebTransport|Worker|SharedWorker|BroadcastChannel|indexedDB|caches|navigator|self|globalThis)\b|\bimport\s*\(/.test(
      source,
    )
  ) {
    return { valid: false, reason: 'source 包含 Worker 验证器禁止的网络、存储或全局访问' };
  }
  if (!Array.isArray(value.inputPaths) || value.inputPaths.some((path) => !asString(path))) {
    return { valid: false, reason: 'inputPaths 必须是路径数组' };
  }
  return { valid: true };
};

const runRestrictedWorker = async (
  config: WorkerCheckConfig,
  signal?: AbortSignal,
): Promise<unknown> => {
  const inputs: Record<string, string> = {};
  for (const path of config.inputPaths) {
    inputs[path] = (await workspace.readFile(path)).content;
  }
  const bootstrap = `
self.fetch = () => Promise.reject(new Error('network disabled'));
self.XMLHttpRequest = undefined;
self.WebSocket = undefined;
self.EventSource = undefined;
self.WebTransport = undefined;
self.Worker = undefined;
self.SharedWorker = undefined;
self.BroadcastChannel = undefined;
self.indexedDB = undefined;
self.caches = undefined;
self.importScripts = () => { throw new Error('importScripts disabled'); };
self.onmessage = async (event) => {
  try {
    const fn = new Function('inputs', '"use strict"; return (async () => { ' + event.data.source + '\n })();');
    const result = await fn(Object.freeze(event.data.inputs));
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};`;
  const url = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }));
  const worker = new Worker(url);
  const timeoutMs = Math.min(Math.max(config.timeoutMs ?? 3000, 100), 10_000);
  try {
    return await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Worker 验证超时')), timeoutMs);
      const abort = () => reject(new DOMException('已停止', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event) => {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        event.data?.ok ? resolve(event.data.result) : reject(new Error(event.data?.error ?? 'Worker 验证失败'));
      };
      worker.onerror = (event) => {
        window.clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        reject(new Error(event.message || 'Worker 验证异常'));
      };
      worker.postMessage({ source: config.source, inputs });
    });
  } finally {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
};

const browserWorkerProvider: VerificationProvider = {
  id: 'browser.worker',
  version: '1',
  label: '受限 Browser Worker',
  runtime: 'worker',
  assurance: 'structural',
  configSchema: objectSchema(['source', 'inputPaths']),
  capabilities: ['readonly-script'],
  isAvailable: () => typeof Worker !== 'undefined' && workspace.isOpen,
  validateConfig: validateWorkerConfig,
  run: async (criterion, context) => {
    const validation = validateWorkerConfig(criterion.config);
    if (!validation.valid) return failedConfig(criterion, 'worker', validation.reason ?? '配置无效');
    try {
      const config = criterion.config as unknown as WorkerCheckConfig;
      if (context.allowedPathPrefixes?.length) {
        const outside = config.inputPaths.find((path) => {
          const candidate = path.replace(/\\/g, '/').toLowerCase();
          return !context.allowedPathPrefixes!.some((prefix) => {
            const root = prefix.replace(/\\/g, '/').toLowerCase();
            return candidate === root || candidate.startsWith(`${root}/`);
          });
        });
        if (outside) {
          return failedConfig(criterion, 'worker', `输入路径超出批准白名单：${outside}`);
        }
      }
      const result = await runRestrictedWorker(
        config,
        context.signal,
      );
      const pass = result === true || (
        typeof result === 'object' && result !== null && (result as { ok?: boolean }).ok === true
      );
      return {
        id: criterion.id,
        type: 'contentMatches',
        description: criterion.description,
        target: 'browser-worker',
        pass,
        status: pass ? 'passed' : 'failed',
        providerId: criterion.providerId,
        runtime: 'worker',
        reason: pass ? undefined : `Worker 未返回 true 或 { ok: true }：${JSON.stringify(result)}`,
      };
    } catch (error) {
      return failedConfig(
        criterion,
        'worker',
        error instanceof Error ? error.message : String(error),
      );
    }
  },
};

export class VerificationRegistry {
  private readonly providers = new Map<string, VerificationProvider>();

  register(provider: VerificationProvider): void {
    if (provider.assurance === 'functional' && provider.trusted !== true) {
      throw new Error(`functional provider 必须显式标记 trusted：${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): VerificationProvider | undefined {
    return this.providers.get(id);
  }

  validate(criterion: AcceptanceCriterion): ValidationResult {
    const provider = this.providers.get(criterion.providerId);
    if (!provider) return { valid: false, reason: `验证器未注册：${criterion.providerId}` };
    return provider.validateConfig(criterion.config);
  }

  capabilities(context?: VerifyContext): VerificationCapability[] {
    return [...this.providers.values()].map((provider) => ({
      providerId: provider.id,
      label: provider.label,
      runtime: provider.runtime,
      available: provider.isAvailable(context),
      kinds: [...provider.capabilities],
      version: provider.version,
      assurance: provider.assurance,
      configSchema: provider.configSchema,
      configSchemaDigest: schemaDigest(provider.configSchema),
      trusted: provider.trusted === true,
    }));
  }

  async run(
    criterion: AcceptanceCriterion,
    context: VerifyContext = {},
  ): Promise<CheckResult> {
    const provider = this.providers.get(criterion.providerId);
    if (!provider) {
      return unavailable(criterion, 'browser', `验证器未注册：${criterion.providerId}`);
    }
    try {
      const approved = context.capabilitySnapshot?.find(
        (capability) => capability.providerId === criterion.providerId,
      );
      const approvedVersion = approved ? approved.version ?? '1' : undefined;
      if (approvedVersion && approvedVersion !== provider.version) {
        return unavailable(
          criterion,
          provider.runtime,
          `provider_version_mismatch：批准版本 ${approvedVersion}，当前版本 ${provider.version}`,
        );
      }
      const approvedAssurance = approved
        ? approved.assurance ?? (approved.runtime === 'human' ? 'human' : 'structural')
        : undefined;
      if (approvedAssurance && approvedAssurance !== provider.assurance) {
        return unavailable(
          criterion,
          provider.runtime,
          `provider_version_mismatch：批准可信等级 ${approvedAssurance}，当前为 ${provider.assurance}`,
        );
      }
      if (
        approved?.configSchemaDigest &&
        approved.configSchemaDigest !== schemaDigest(provider.configSchema)
      ) {
        return unavailable(
          criterion,
          provider.runtime,
          'provider_version_mismatch：配置 schema 已变化',
        );
      }
      if (context.allowedPathPrefixes?.length) {
        const config = criterion.config as Record<string, unknown>;
        const inputPaths = [
          ...(typeof config.path === 'string' ? [config.path] : []),
          ...(Array.isArray(config.inputPaths)
            ? config.inputPaths.filter((item): item is string => typeof item === 'string')
            : []),
        ];
        const outside = inputPaths.find((path) => {
          const candidate = path.replace(/\\/g, '/').toLowerCase();
          return !context.allowedPathPrefixes!.some((prefix) => {
            const root = prefix.replace(/\\/g, '/').toLowerCase();
            return candidate === root || candidate.startsWith(`${root}/`);
          });
        });
        if (outside) {
          return failedConfig(
            criterion,
            provider.runtime,
            `验证输入路径超出批准白名单：${outside}`,
          );
        }
      }
      if (!provider.isAvailable(context)) {
        return unavailable(criterion, provider.runtime, `验证器当前不可用：${provider.label}`);
      }
      const result = await provider.run(criterion, context);
      return { ...result, assurance: provider.assurance };
    } catch (error) {
      return failedConfig(
        criterion,
        provider.runtime,
        `验证器异常：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

const registry = new VerificationRegistry();
registry.register(workspaceCheckProvider('workspace.fileExists', '路径存在', 'fileExists', ['path']));
registry.register(workspaceCheckProvider('workspace.contentContains', '内容包含', 'contentContains', ['path', 'expected']));
registry.register(workspaceCheckProvider('workspace.contentMatches', '内容匹配', 'contentMatches', ['path', 'expected']));
registry.register(workspaceCheckProvider('workspace.jsonField', 'JSON 字段', 'jsonField', ['path', 'field']));
registry.register(manifestProvider);
registry.register(contentHashProvider);
registry.register(jsonValidProvider);
registry.register(browserWorkerProvider);
registry.register(userAcceptanceProvider);

export const getVerificationRegistry = () => registry;

export const runCriteria = async (
  criteria: readonly AcceptanceCriterion[],
  context: VerifyContext = {},
): Promise<CheckResult[]> => {
  const results: CheckResult[] = [];
  for (const criterion of criteria) {
    results.push(await registry.run(criterion, context));
  }
  return results;
};

export const verificationStateFromResults = (
  results: readonly CheckResult[],
): 'verified' | 'partially_verified' | 'unverified' | 'failed' | 'unavailable' => {
  if (!results.length) return 'unverified';
  if (results.some((result) => result.status === 'failed')) return 'failed';
  if (results.some((result) => result.status === 'unavailable')) return 'unavailable';
  if (results.some((result) => result.status === 'manual')) return 'unverified';
  if (results.every((result) => result.status === 'passed' || result.pass)) {
    return results.some((result) => result.assurance === 'functional')
      ? 'verified'
      : 'partially_verified';
  }
  return 'partially_verified';
};
