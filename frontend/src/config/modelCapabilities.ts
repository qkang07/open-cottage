import type { LlmModelConfig } from './constants';
import {
  getProviderDefinition,
  normalizeProviderId,
  providerSupportsNativeSearch,
  type LlmModelOption,
  type LlmProviderId,
} from './llmProviders';

export type CottageCapabilitySupport = boolean | 'unknown';

/**
 * Cottage 对聊天模型能力的唯一运行时视图。
 * `unknown` 与 `false` 严格区分：目录缺失不能被解释为模型明确不支持。
 */
export interface CottageModelCapabilities {
  provider: LlmProviderId;
  model: string;
  source: 'catalog' | 'provider' | 'unknown';
  temperature: CottageCapabilitySupport;
  reasoning: CottageCapabilitySupport;
  reasoningToggle: CottageCapabilitySupport;
  reasoningEffortValues: readonly string[];
  vision: CottageCapabilitySupport;
  tools: CottageCapabilitySupport;
  nativeSearch: boolean;
  structuredOutput: CottageCapabilitySupport;
  contextLimit?: number;
  outputLimit?: number;
}

const support = (value: boolean | undefined): CottageCapabilitySupport =>
  typeof value === 'boolean' ? value : 'unknown';

export const resolveCottageModelCapabilities = (
  config: Pick<LlmModelConfig, 'provider' | 'model'>,
  meta?: LlmModelOption | null,
): CottageModelCapabilities => {
  const provider = normalizeProviderId(config.provider);
  const providerKind = getProviderDefinition(provider).kind;
  return {
    provider,
    model: config.model,
    source: meta ? 'catalog' : providerKind === 'openai_compatible' ? 'unknown' : 'provider',
    temperature: support(meta?.temperature),
    reasoning: support(meta?.reasoning),
    reasoningToggle: support(meta?.reasoningToggle),
    reasoningEffortValues: meta?.reasoningEffortValues ?? [],
    vision: support(meta?.vision),
    tools: support(meta?.tools),
    nativeSearch: providerSupportsNativeSearch(provider, config.model),
    // Direct provider packages expose their native structured-output mapping.
    // OpenAI-compatible endpoints vary, so keep that state explicit.
    structuredOutput: providerKind === 'openai_compatible' ? 'unknown' : true,
    contextLimit: meta?.contextLimit,
    outputLimit: meta?.outputLimit,
  };
};

export const supportsThinkingControl = (
  capabilities: CottageModelCapabilities,
): boolean =>
  capabilities.reasoning === true ||
  capabilities.reasoningToggle === true ||
  capabilities.reasoningEffortValues.length > 0;

export const supportsVisionInput = (
  capabilities: CottageModelCapabilities,
): boolean => capabilities.vision === true;

