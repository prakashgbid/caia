/**
 * @chiefaia/librarian — public surface.
 *
 * Phase 1 (this release):
 *   - Corpus aggregator + classifier (`source-readers.ts`)
 *   - SQLite index (`index-store.ts`)
 *   - Index builder with Ollama embeddings (`index-builder.ts`)
 *   - Retrieval API (`retrieve.ts`)
 *   - Pre-spawn prompt augmentation (`prepend.ts`)
 *   - Three CLIs (caia-librarian-index|retrieve|prepend)
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
