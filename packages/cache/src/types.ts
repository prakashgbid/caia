/** Connection and behaviour options for RedisCache. */
export interface RedisCacheOptions {
  /**
   * Redis host. Ignored when `url` is provided.
   * @default '127.0.0.1'
   */
  host?: string;
  /**
   * Redis port. Ignored when `url` is provided.
   * @default 6379
   */
  port?: number;
  /** Redis AUTH password. */
  password?: string;
  /**
   * Redis database index.
   * @default 0
   */
  db?: number;
  /**
   * Full Redis URL (e.g. `redis://:password@host:6379/0`).
   * When present, `host` / `port` / `db` / `password` are ignored.
   */
  url?: string;
  /**
   * String prefix prepended to every key as `<prefix>:<key>`.
   * Useful for sharing one Redis instance across multiple services.
   */
  keyPrefix?: string;
  /**
   * Default TTL in milliseconds applied when `set()` is called without an
   * explicit ttlMs argument.
   * @default 2592000000 (30 days)
   */
  defaultTtlMs?: number;
  /**
   * TCP connection timeout in milliseconds.
   * @default 5000
   */
  connectTimeoutMs?: number;
}

/** Options for NodeCacheAdapter. */
export interface NodeCacheAdapterOptions {
  /**
   * String prefix prepended to every key as `<prefix>:<key>`.
   * Useful for logical namespacing within a single in-memory store.
   */
  keyPrefix?: string;
  /**
   * Default TTL in milliseconds applied when `set()` is called without an
   * explicit ttlMs argument.
   * @default 2592000000 (30 days)
   */
  defaultTtlMs?: number;
  /**
   * Maximum number of keys stored. Exceeding this causes node-cache to throw.
   * Omit to allow unlimited keys.
   */
  maxKeys?: number;
  /**
   * Interval in milliseconds at which expired keys are swept.
   * @default 600000 (10 minutes)
   */
  checkPeriodMs?: number;
}

/** Per-instance counters reset by `resetStats()`. */
export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
}
