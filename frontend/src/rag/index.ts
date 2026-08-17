/**
 * RAG 模块导出
 */

export type {
  TextChunk,
  IndexedFileEntry,
  IndexManifest,
  StoredChunkMeta,
  RetrievalResult,
  IndexPhase,
  IndexProgress,
  EmbeddingProvider,
} from './types';

export { chunkText, chunkByAst, chunkFile, hashContent } from './chunker';
export {
  buildMerkleSnapshot,
  planFileReads,
  type MerkleSnapshot,
} from './merkle';
export { loadMerkle, saveMerkle } from './merkleStore';
export {
  getLocalEmbeddingProvider,
  disposeLocalEmbeddingProvider,
  getEmbeddingProvider,
  getExpectedEmbeddingModelId,
} from './embeddingProvider';
export { disposeVendorEmbeddingProvider } from './vendorEmbeddingProvider';
export {
  loadManifest,
  loadFilesIndex,
  loadChunksMeta,
  loadVectors,
  saveManifest,
  saveFilesIndex,
  saveChunksMeta,
  saveVectors,
  clearIndex,
} from './vectorStore';
export {
  buildIndex,
  incrementalIndex,
  isIndexing,
  abortIndexing,
  resetIndexWorker,
} from './indexer';
export {
  buildIndexInWorker,
  terminateIndexWorker,
} from './indexWorkerHost';
export { searchSemantic, getIndexStats, getIndexStorageInfo } from './retrieve';
export {
  scheduleBackgroundIndex,
  startBackgroundIndex,
  subscribeBackgroundIndex,
  getBackgroundIndexState,
} from './indexBackground';
export type { BackgroundIndexState } from './indexBackground';
export { createRagCottageTools } from './ragCottageTools';
export { migrateLegacyVectors } from './chunkVectorStore';
export { extractOfficeText, isOfficeFile } from './officeExtractor';
