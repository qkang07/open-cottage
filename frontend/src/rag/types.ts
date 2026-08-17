/**
 * 本地 RAG 模块共享类型
 */

/** 单个文本块（chunk） */
export interface TextChunk {
  /** 唯一 ID（path + 起始行） */
  id: string;
  /** 源文件相对路径 */
  path: string;
  /** 起始行号（1-based） */
  startLine: number;
  /** 结束行号（1-based） */
  endLine: number;
  /** 文本内容（用于嵌入） */
  text: string;
}

/** 单文件在索引中的元数据 */
export interface IndexedFileEntry {
  /** 内容哈希（用于增量检测） */
  hash: string;
  /** 最后修改时间戳 */
  mtime: number;
  /** 该文件拆分出的 chunk ID 列表 */
  chunkIds: string[];
}

/** .cottage/index/manifest.json 结构 */
export interface IndexManifest {
  /** 嵌入模型标识 */
  model: string;
  /** 向量维度 */
  dim: number;
  /** 最后构建时间戳 */
  builtAt: number;
  /** 分块参数 */
  chunkParams: {
    chunkSize: number;
    chunkOverlap: number;
  };
  /** 总 chunk 数 */
  totalChunks: number;
  /** 向量存储格式；缺省为 legacy monolith */
  vectorStorage?: 'monolith' | 'per-chunk';
}

/** .cottage/index/chunks.json 的单项 */
export interface StoredChunkMeta {
  path: string;
  startLine: number;
  endLine: number;
  /** 前 80 字符预览 */
  preview: string;
}

/** 检索结果 */
export interface RetrievalResult {
  /** chunk ID */
  id: string;
  /** 源文件路径 */
  path: string;
  /** 起始行 */
  startLine: number;
  /** 结束行 */
  endLine: number;
  /** 文本片段 */
  text: string;
  /** 余弦相似度 */
  score: number;
}

/** 建库阶段 */
export type IndexPhase =
  | 'init'
  | 'scanning'
  | 'analyzing'
  | 'chunking'
  | 'embedding'
  | 'saving'
  | 'done';

/** 索引进度回调 */
export interface IndexProgress {
  phase: IndexPhase;
  current: number;
  total: number;
  /** 当前处理的文件路径 */
  currentFile?: string;
  /** 阶段内详细说明（如「正在下载模型…」） */
  detail?: string;
}

/** 嵌入 Provider 接口 */
export interface EmbeddingProvider {
  /** 模型标识 */
  modelId: string;
  /** 向量维度 */
  dim: number;
  /** 批量嵌入文本 */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** 单条嵌入（查询用） */
  embedQuery(text: string): Promise<Float32Array>;
  /** 释放资源 */
  dispose(): void;
}
