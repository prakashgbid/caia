// Public API for @chiefaia/llm-cache.

export { PromptCache } from './cache.js';
export { withCache } from './wrap.js';
export { CacheStore } from './store.js';
export { SqliteBackend } from './backends/sqlite.js';
export { RedisBackend } from './backends/redis.js';
export { InMemoryBackend } from './backends/memory.js';

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
export type { CacheBackend, SemanticRow } from './backends/interface.js';
export type { RedisBackendOptions, RedisSocketOptions } from './backends/redis.js';
