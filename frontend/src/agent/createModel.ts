/**
 * 模型工厂的稳定入口。具体 SDK 仅存在于 agent/runtime 适配层，调用方只依赖
 * CottageModelDriver，避免 provider 或 UI 层泄漏 AI SDK 类型。
 */
export {
  createAiSdkModel as createChatModel,
  LlmConfigError,
  type CreateChatModelOptions,
} from './runtime/aiSdkDriver';
