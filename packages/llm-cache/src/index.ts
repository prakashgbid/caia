// Public API for @chiefaia/llm-cache.

export { PromptCache } from './cache.js';
export { withCache } from './wrap.js';
export { CacheStore } from './store.js';

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
