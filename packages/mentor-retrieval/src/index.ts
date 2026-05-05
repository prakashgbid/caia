/**
 * Mentor Phase-3 retrieval — public surface.
 *
 * PR-1 ships the index builder + persistence + Ollama embedding wrapper.
 * PR-2 will extend this surface with the retrieval API + CLI; PR-3
 * wires the pre-spawn injection hook.
 */

export {
  createOllamaEmbedder,
  extractEmbedding,
  vectorToBlob,
  blobToVector,
  DEFAULT_OLLAMA_URL,
  DEFAULT_EMBED_MODEL,
  type OllamaEmbedderOptions
} from './embed.js';

export {
  defaultFsReader,
  isFeedbackFile,
  isProposalFile,
  pathToSlug
} from './source-readers.js';

export {
  openIndexStore,
  indexDbPath,
  INDEX_DB_FILENAME,
  SNIPPET_MAX_BYTES,
  type IndexStore,
  type IndexStoreOptions
} from './index-store.js';

export {
  buildIndex,
  sha256Hex,
  snippet,
  type BuildIndexOptions
} from './index-builder.js';

export type {
  BuildIndexStats,
  EmbedResult,
  Embedder,
  FsReader,
  IndexedLesson,
  LessonKind,
  SourceFile
} from './types.js';
