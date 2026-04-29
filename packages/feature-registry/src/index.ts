/**
 * @chiefaia/feature-registry — public exports
 *
 * FREG-001: schema + dedup key.
 * FREG-002: storage layer (sqlite-vec + FTS5) + EmbeddingClient.
 * FREG-003: story.completed event subscriber.
 * FREG-004: backfill script.
 * FREG-005: hybrid search API.
 * FREG-006: PO Agent integration.
 */

export {
  FeatureRegistryRowSchema,
  ClassificationVerdictSchema,
  SearchHitSchema,
  SearchResultSchema,
  FEATURE_REGISTRY_SOURCES,
  FEATURE_REGISTRY_VERSION,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_VERSION,
  DEFAULT_ENHANCE_THRESHOLD,
  DEFAULT_AMBIGUOUS_THRESHOLD,
  MAX_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS,
} from './schema';
export type {
  FeatureRegistryRow,
  FeatureRegistrySource,
  ClassificationVerdict,
  SearchHit,
  SearchResult,
} from './schema';

export { computeDedupKey } from './dedup-key';
export type { DedupKeyInput } from './dedup-key';

export {
  bootstrapVecTable,
  bootstrapVectorTables,
  upsertRegistryRow,
  buildFtsText,
  queryDense,
  querySparse,
} from './storage';
export type { DenseHit, SparseHit, QueryOpts, VecTableOpts } from './storage';

export {
  OllamaEmbeddingClient,
  StubEmbeddingClient,
  EmbedderUnavailableError,
} from './embedding-client';
export type {
  EmbeddingClient,
  EmbedResult,
  OllamaClientOpts,
} from './embedding-client';

export { search } from './search';
export type { SearchOpts, SearchClientDeps } from './search';
