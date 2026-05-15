// Public API for @chiefaia/llm-cache.

export { PromptCache } from './cache.js';
export { withCache } from './wrap.js';
export { CacheStore } from './store.js';
export {
  createL6Cache,
  L6_THRESHOLD,
  L6_TTL_MS,
  L6_MAX_ROWS_SCANNED,
} from './l6-cache.js';
export {
  createNomicEmbedder,
  NomicEmbedError,
} from './embedders/nomic.js';

export type {
  PromptCacheOptions,
} from './cache.js';
export type {
  RouteFn,
  WrapOptions,
  ResolveEvent,
} from './wrap.js';
export type {
  CacheHit,
  CacheLookupKey,
  CacheStats,
  CachedResponse,
  EmbeddingFn,
  SemanticCacheOptions,
} from './types.js';
export type { L6CacheOptions } from './l6-cache.js';
export type { NomicEmbedderOptions } from './embedders/nomic.js';
