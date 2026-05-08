/**
 * @chiefaia/librarian — public surface.
 *
 * Phase 1 (better-sqlite3 + JS-side cosine, the default backend):
 *   - Corpus aggregator + classifier (`source-readers.ts`)
 *   - SQLite index (`index-store.ts`)
 *   - Index builder with Ollama embeddings (`index-builder.ts`)
 *   - Retrieval API (`retrieve.ts`)
 *   - Pre-spawn prompt augmentation (`prepend.ts`)
 *   - Three CLIs (caia-librarian-index|retrieve|prepend)
 *
 * Phase 2 (validation decision #4, 2026-05-06):
 *   - Backend abstraction in `./backends/`
 *   - Mem0 OSS Node.js as an alternative retrieval backend
 *   - Dispatcher functions (`buildIndexWithBackend`,
 *     `retrieveWithBackend`, `prependWithBackend`) accept an
 *     optional `backend?: 'sqlite-vec' | 'mem0'` flag.
 *
 * Composes with `@chiefaia/mentor-retrieval`'s prepend so an
 * orchestrator can pipe BOTH preambles in either order.
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
  defaultReportsDir,
  isEligibleMarkdown,
  pathToKind,
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
  truncateUtf8,
  DEFAULT_EMBED_INPUT_MAX_BYTES,
  type BuildIndexOptions
} from './index-builder.js';

export {
  retrievePrecedent,
  cosineSimilarity,
  formatPrecedentPreamble,
  DEFAULT_TOP_N,
  DEFAULT_MIN_SIMILARITY,
  type RetrievedPrecedent,
  type RetrievePrecedentOptions
} from './retrieve.js';

export {
  prependPrecedent,
  type PrependPrecedentOptions,
  type PrependPrecedentResult
} from './prepend.js';

export {
  ALL_PRECEDENT_KINDS,
  isPrecedentKind,
  type BuildIndexStats,
  type EmbedResult,
  type Embedder,
  type FsReader,
  type IndexedPrecedent,
  type PrecedentKind,
  type SourceFile,
  type SourceRoots
} from './types.js';

// Phase-2 backend abstraction (validation decision #4, 2026-05-06).
export {
  DEFAULT_BACKEND,
  isLibrarianBackendName,
  Mem0Backend,
  buildMem0Index,
  retrieveMem0Precedent,
  buildMem0Config,
  defaultMemoryFactory,
  buildIndexWithBackend,
  retrieveWithBackend,
  prependWithBackend,
  MEM0_INDEX_DB_FILENAME,
  MEM0_HISTORY_DB_FILENAME,
  DEFAULT_MEM0_USER_ID,
  MEM0_DEFAULT_OLLAMA_URL,
  MEM0_DEFAULT_EMBED_MODEL,
  MEM0_DEFAULT_EMBED_DIM,
  MEM0_DEFAULT_EXTRACTION_MODEL,
  DEFAULT_MEM0_MIN_SIMILARITY,
  DEFAULT_MEM0_TOP_N,
  type LibrarianBackendName,
  type BuildMem0IndexOptions,
  type RetrieveMem0PrecedentOptions,
  type Mem0BackendOptions,
  type Mem0MemoryFactory,
  type Mem0MemoryLike,
  type BuildIndexWithBackendOptions,
  type RetrieveWithBackendOptions,
  type PrependWithBackendOptions
} from './backends/index.js';
