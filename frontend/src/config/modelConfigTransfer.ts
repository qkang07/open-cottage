/**
 * 模型配置包传输。
 *
 * 一个配置包可同时包含 Agent 模型、生图模型及其实际引用的服务商连接。
 * 包内连接引用只在传输过程中有效，导入时会生成新的本地连接 ID。
 */
import type { ImageGenModelPreset, LlmModelConfig, ModelPreset } from './constants';
import { LLM_PROVIDER_DEFINITIONS, type LlmProviderId } from './llmProviders';
import { getProviderConnections, type ProviderSecrets } from './secrets';

export interface TransferredConnection {
  ref: string;
  provider: LlmProviderId;
  alias?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface TransferredAgentModel {
  name: string;
  config: Omit<LlmModelConfig, 'connectionId' | 'apiKey'>;
  connectionRef?: string;
}

export interface TransferredImageModel {
  name: string;
  provider: LlmProviderId;
  model: string;
  defaultSize?: string;
  connectionRef?: string;
}

export interface ModelConfigTransferBundle {
  schema: 'open-cottage/model-config';
  version: 1;
  connections: TransferredConnection[];
  agentModels: TransferredAgentModel[];
  imageModels: TransferredImageModel[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CJK_BASE = 0x4e00;
const CJK_RADIX = 16384;
const CJK_BITS = 14;
const WIRE_RAW = 0;
const WIRE_DEFLATED = 1;
const NO_CONNECTION = 0xff;
const PROVIDER_IDS = LLM_PROVIDER_DEFINITIONS.map((item) => item.id);
const PROVIDER_CODE = new Map(PROVIDER_IDS.map((id, index) => [id, index]));

const CONNECTION_HAS_ALIAS = 1 << 0;
const CONNECTION_HAS_BASE_URL = 1 << 1;
const CONNECTION_HAS_API_KEY = 1 << 2;
const AGENT_HAS_NAME = 1 << 0;
const AGENT_HAS_TEMPERATURE = 1 << 1;
const AGENT_HAS_MAX_TOKENS = 1 << 2;
const AGENT_HAS_REASONING = 1 << 3;
const AGENT_HAS_THINKING = 1 << 4;
const AGENT_THINKING_ENABLED = 1 << 5;
const AGENT_HAS_BASE_URL = 1 << 6;
const IMAGE_HAS_NAME = 1 << 0;
const IMAGE_HAS_DEFAULT_SIZE = 1 << 1;

class ByteWriter {
  private readonly bytes: number[] = [];

  u8(value: number) { this.bytes.push(value & 0xff); }
  u16(value: number) { this.u8(value); this.u8(value >>> 8); }
  u32(value: number) { this.u8(value); this.u8(value >>> 8); this.u8(value >>> 16); this.u8(value >>> 24); }
  i16(value: number) { this.u16(value < 0 ? value + 0x10000 : value); }
  text(value: string) {
    const bytes = encoder.encode(value);
    if (bytes.length > 0xffff) throw new Error('模型配置字段过长');
    this.u16(bytes.length);
    for (const byte of bytes) this.u8(byte);
  }
  finish() { return Uint8Array.from(this.bytes); }
}

class ByteReader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  get remaining() { return this.bytes.length - this.offset; }
  u8() {
    if (this.offset >= this.bytes.length) throw new Error('模型配置包不完整');
    return this.bytes[this.offset++]!;
  }
  u16() { return this.u8() | (this.u8() << 8); }
  u32() { return (this.u8() | (this.u8() << 8) | (this.u8() << 16) | (this.u8() << 24)) >>> 0; }
  i16() { const value = this.u16(); return value > 0x7fff ? value - 0x10000 : value; }
  text() {
    const length = this.u16();
    if (this.offset + length > this.bytes.length) throw new Error('模型配置包字符串不完整');
    const value = decoder.decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }
}

const bytesToCjk = (bytes: Uint8Array): string => {
  if (bytes.length >= CJK_RADIX) throw new Error('模型配置包过大，无法编码');
  const chars = [String.fromCodePoint(CJK_BASE + bytes.length)];
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= CJK_BITS) {
      bits -= CJK_BITS;
      chars.push(String.fromCodePoint(CJK_BASE + ((buffer >>> bits) & (CJK_RADIX - 1))));
      buffer &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  if (bits > 0) chars.push(String.fromCodePoint(CJK_BASE + ((buffer << (CJK_BITS - bits)) & (CJK_RADIX - 1))));
  return chars.join('');
};

const cjkToBytes = (value: string): Uint8Array => {
  const codes = [...value].map((char) => {
    const code = char.codePointAt(0);
    if (code === undefined || code < CJK_BASE || code >= CJK_BASE + CJK_RADIX) {
      throw new Error('模型配置包包含无效字符');
    }
    return code - CJK_BASE;
  });
  if (!codes.length) throw new Error('模型配置包为空');
  const output = new Uint8Array(codes[0]!);
  let offset = 0;
  let buffer = 0;
  let bits = 0;
  for (const code of codes.slice(1)) {
    buffer = (buffer << CJK_BITS) | code;
    bits += CJK_BITS;
    while (bits >= 8 && offset < output.length) {
      bits -= 8;
      output[offset++] = (buffer >>> bits) & 0xff;
      buffer &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  if (offset !== output.length) throw new Error('模型配置包长度不完整');
  return output;
};

const compress = async (bytes: Uint8Array): Promise<Uint8Array | undefined> => {
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return undefined;
  }
};

const decompress = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const connectionRef = (provider: LlmProviderId, id?: string): string =>
  `${provider}/${id || 'default'}`;

const resolveConnection = (
  secrets: ProviderSecrets,
  provider: LlmProviderId,
  id?: string,
) => getProviderConnections(secrets, provider).find((item) =>
  id ? item.id === id : true,
);

export const buildModelConfigTransfer = (
  agentModels: ModelPreset[],
  imageModels: ImageGenModelPreset[],
  secrets: ProviderSecrets,
  options: { includeApiKey?: boolean } = {},
): ModelConfigTransferBundle => {
  const connections = new Map<string, TransferredConnection>();
  const addConnection = (provider: LlmProviderId, id?: string): string | undefined => {
    const connection = resolveConnection(secrets, provider, id);
    if (!connection) return undefined;
    const ref = connectionRef(provider, connection.id);
    if (!connections.has(ref)) {
      connections.set(ref, {
        ref,
        provider,
        ...(connection.alias?.trim() ? { alias: connection.alias.trim() } : {}),
        ...(connection.baseUrl?.trim() ? { baseUrl: connection.baseUrl.trim() } : {}),
        ...(options.includeApiKey && connection.apiKey.trim()
          ? { apiKey: connection.apiKey.trim() }
          : {}),
      });
    }
    return ref;
  };

  const transferredAgentModels = agentModels.map((preset) => {
    const { connectionId: _, apiKey: __, ...config } = preset.config;
    const ref = addConnection(preset.config.provider, preset.config.connectionId);
    return {
      name: preset.name,
      config,
      ...(ref ? { connectionRef: ref } : {}),
    };
  });
  const transferredImageModels = imageModels.map((preset) => {
    const ref = addConnection(preset.provider, preset.connectionId);
    return {
      name: preset.name,
      provider: preset.provider,
      model: preset.model,
      ...(preset.defaultSize ? { defaultSize: preset.defaultSize } : {}),
      ...(ref ? { connectionRef: ref } : {}),
    };
  });

  return {
    schema: 'open-cottage/model-config',
    version: 1,
    connections: [...connections.values()],
    agentModels: transferredAgentModels,
    imageModels: transferredImageModels,
  };
};

const providerCode = (provider: LlmProviderId): number => {
  const code = PROVIDER_CODE.get(provider);
  if (code === undefined) throw new Error(`不支持的服务商：${provider}`);
  return code;
};

const providerFromCode = (code: number): LlmProviderId => {
  const provider = PROVIDER_IDS[code];
  if (!provider) throw new Error('模型配置包包含未知服务商');
  return provider;
};

const writeCount = (writer: ByteWriter, count: number) => {
  if (count > 0xff) throw new Error('单个配置包最多包含 255 个项目');
  writer.u8(count);
};

const encodeBundle = (bundle: ModelConfigTransferBundle): Uint8Array => {
  const writer = new ByteWriter();
  const connectionIndexes = new Map(bundle.connections.map((item, index) => [item.ref, index]));
  writeCount(writer, bundle.connections.length);
  for (const connection of bundle.connections) {
    let flags = 0;
    if (connection.alias) flags |= CONNECTION_HAS_ALIAS;
    if (connection.baseUrl) flags |= CONNECTION_HAS_BASE_URL;
    if (connection.apiKey) flags |= CONNECTION_HAS_API_KEY;
    writer.u8(providerCode(connection.provider));
    writer.u8(flags);
    if (flags & CONNECTION_HAS_ALIAS) writer.text(connection.alias!);
    if (flags & CONNECTION_HAS_BASE_URL) writer.text(connection.baseUrl!);
    if (flags & CONNECTION_HAS_API_KEY) writer.text(connection.apiKey!);
  }

  writeCount(writer, bundle.agentModels.length);
  for (const item of bundle.agentModels) {
    const config = item.config;
    let flags = 0;
    if (item.name) flags |= AGENT_HAS_NAME;
    if (config.temperature !== undefined) flags |= AGENT_HAS_TEMPERATURE;
    if (config.maxTokens !== undefined) flags |= AGENT_HAS_MAX_TOKENS;
    if (config.reasoningEffort) flags |= AGENT_HAS_REASONING;
    if (config.thinkingEnabled !== undefined) {
      flags |= AGENT_HAS_THINKING;
      if (config.thinkingEnabled) flags |= AGENT_THINKING_ENABLED;
    }
    if (config.baseUrl) flags |= AGENT_HAS_BASE_URL;
    writer.u8(item.connectionRef ? connectionIndexes.get(item.connectionRef) ?? NO_CONNECTION : NO_CONNECTION);
    writer.u8(providerCode(config.provider));
    writer.u8(flags);
    writer.text(config.model);
    if (flags & AGENT_HAS_NAME) writer.text(item.name);
    if (flags & AGENT_HAS_TEMPERATURE) writer.i16(Math.round(config.temperature! * 100));
    if (flags & AGENT_HAS_MAX_TOKENS) writer.u32(Math.max(0, Math.floor(config.maxTokens!)));
    if (flags & AGENT_HAS_REASONING) writer.text(config.reasoningEffort!);
    if (flags & AGENT_HAS_BASE_URL) writer.text(config.baseUrl!);
  }

  writeCount(writer, bundle.imageModels.length);
  for (const item of bundle.imageModels) {
    let flags = 0;
    if (item.name) flags |= IMAGE_HAS_NAME;
    if (item.defaultSize) flags |= IMAGE_HAS_DEFAULT_SIZE;
    writer.u8(item.connectionRef ? connectionIndexes.get(item.connectionRef) ?? NO_CONNECTION : NO_CONNECTION);
    writer.u8(providerCode(item.provider));
    writer.u8(flags);
    writer.text(item.model);
    if (flags & IMAGE_HAS_NAME) writer.text(item.name);
    if (flags & IMAGE_HAS_DEFAULT_SIZE) writer.text(item.defaultSize!);
  }
  return writer.finish();
};

const decodeRawBundle = (value: string): ModelConfigTransferBundle => {
  const parsed = JSON.parse(value) as Partial<ModelConfigTransferBundle>;
  if (parsed?.schema !== 'open-cottage/model-config' || parsed.version !== 1) {
    throw new Error('不是有效的模型配置包');
  }
  const connections = parsed.connections ?? [];
  const agentModels = parsed.agentModels ?? [];
  const imageModels = parsed.imageModels ?? [];
  if (!Array.isArray(connections) || !Array.isArray(agentModels) || !Array.isArray(imageModels)) {
    throw new Error('模型配置包结构不完整');
  }
  for (const connection of connections) {
    if (!connection?.ref || !PROVIDER_CODE.has(connection.provider)) throw new Error('模型配置包包含无效的服务商连接');
  }
  for (const item of agentModels) {
    if (!item?.config?.model || !PROVIDER_CODE.has(item.config.provider)) throw new Error('模型配置包包含无效的模型配置');
  }
  for (const item of imageModels) {
    if (!item?.model || !PROVIDER_CODE.has(item.provider)) throw new Error('模型配置包包含无效的生图模型');
  }
  if (!agentModels.length && !imageModels.length) throw new Error('模型配置包中没有可导入的模型');
  return { schema: 'open-cottage/model-config', version: 1, connections, agentModels, imageModels };
};

const decodeBundle = (bytes: Uint8Array): ModelConfigTransferBundle => {
  const reader = new ByteReader(bytes);
  const connections: TransferredConnection[] = [];
  const connectionCount = reader.u8();
  for (let index = 0; index < connectionCount; index += 1) {
    const provider = providerFromCode(reader.u8());
    const flags = reader.u8();
    connections.push({
      ref: `c${index}`,
      provider,
      ...(flags & CONNECTION_HAS_ALIAS ? { alias: reader.text() } : {}),
      ...(flags & CONNECTION_HAS_BASE_URL ? { baseUrl: reader.text() } : {}),
      ...(flags & CONNECTION_HAS_API_KEY ? { apiKey: reader.text() } : {}),
    });
  }
  const refFor = (index: number): string | undefined =>
    index === NO_CONNECTION ? undefined : connections[index]?.ref;

  const agentModels: TransferredAgentModel[] = [];
  const agentCount = reader.u8();
  for (let index = 0; index < agentCount; index += 1) {
    const connection = reader.u8();
    const provider = providerFromCode(reader.u8());
    const flags = reader.u8();
    const model = reader.text();
    const name = flags & AGENT_HAS_NAME ? reader.text() : '';
    const temperature = flags & AGENT_HAS_TEMPERATURE ? reader.i16() / 100 : undefined;
    const maxTokens = flags & AGENT_HAS_MAX_TOKENS ? reader.u32() : undefined;
    const reasoningEffort = flags & AGENT_HAS_REASONING ? reader.text() : undefined;
    const baseUrl = flags & AGENT_HAS_BASE_URL ? reader.text() : undefined;
    const connectionRef = refFor(connection);
    if (connection !== NO_CONNECTION && !connectionRef) throw new Error('模型配置包引用了不存在的服务商连接');
    agentModels.push({
      name,
      config: {
        provider,
        model,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(flags & AGENT_HAS_THINKING ? { thinkingEnabled: Boolean(flags & AGENT_THINKING_ENABLED) } : {}),
        ...(baseUrl ? { baseUrl } : {}),
      },
      ...(connectionRef ? { connectionRef } : {}),
    });
  }

  const imageModels: TransferredImageModel[] = [];
  const imageCount = reader.u8();
  for (let index = 0; index < imageCount; index += 1) {
    const connection = reader.u8();
    const provider = providerFromCode(reader.u8());
    const flags = reader.u8();
    const model = reader.text();
    const name = flags & IMAGE_HAS_NAME ? reader.text() : '';
    const defaultSize = flags & IMAGE_HAS_DEFAULT_SIZE ? reader.text() : undefined;
    const connectionRef = refFor(connection);
    if (connection !== NO_CONNECTION && !connectionRef) throw new Error('模型配置包引用了不存在的服务商连接');
    imageModels.push({ name, provider, model, ...(defaultSize ? { defaultSize } : {}), ...(connectionRef ? { connectionRef } : {}) });
  }
  if (reader.remaining !== 0) throw new Error('模型配置包存在冗余数据');
  if (!agentModels.length && !imageModels.length) throw new Error('模型配置包中没有可导入的模型');
  return { schema: 'open-cottage/model-config', version: 1, connections, agentModels, imageModels };
};

export const encodeModelConfigTransfer = async (bundle: ModelConfigTransferBundle): Promise<string> => {
  const raw = encodeBundle(bundle);
  const compressed = await compress(raw);
  const useCompressed = Boolean(compressed && compressed.length < raw.length);
  const payload = useCompressed ? compressed! : raw;
  const wire = new Uint8Array(payload.length + 1);
  wire[0] = useCompressed ? WIRE_DEFLATED : WIRE_RAW;
  wire.set(payload, 1);
  return bytesToCjk(wire);
};

export const decodeModelConfigTransfer = async (encoded: string): Promise<ModelConfigTransferBundle> => {
  const raw = encoded.trim();
  try {
    if (raw.startsWith('{')) return decodeRawBundle(raw);
    const wire = cjkToBytes(raw);
    if (wire.length < 2) throw new Error('模型配置包为空');
    const payload = wire.subarray(1);
    const bytes = wire[0] === WIRE_DEFLATED
      ? await decompress(payload)
      : wire[0] === WIRE_RAW
        ? payload
        : (() => { throw new Error('不支持的模型配置包压缩方式'); })();
    return decodeBundle(bytes);
  } catch (error) {
    // 保留具体原因，便于用户定位配置包问题
    throw error instanceof Error ? error : new Error('模型配置包无法解析');
  }
};
