// Redis-backed key-value cache.
//
// Values are JSON-serialised on write and deserialised on read, so any
// JSON-safe type is supported. TTLs are stored as Redis EX seconds (rounded
// up to the nearest second so sub-second TTLs don't silently evict immediately).
//
// The optional second constructor argument lets tests inject a pre-built Redis
// client instead of opening a real TCP connection.

import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import type { CacheStats, RedisCacheOptions } from './types.js';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export class RedisCache<T = unknown> {
  private readonly client: Redis;
  private readonly prefix: string;
  private readonly defaultTtlMs: number;
  private hits = 0;
  private misses = 0;
  private sets = 0;
  private deletes = 0;

  constructor(options: RedisCacheOptions, client?: Redis) {
    this.prefix = options.keyPrefix ?? '';
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;

    if (client) {
      this.client = client;
      return;
    }

    const timeout = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    if (options.url) {
      this.client = new Redis(options.url, { connectTimeout: timeout });
    } else {
      const redisOptions: RedisOptions = {
        host: options.host ?? '127.0.0.1',
        port: options.port ?? 6379,
        db: options.db ?? 0,
        connectTimeout: timeout,
      };
      if (options.password !== undefined) {
        redisOptions.password = options.password;
      }
      this.client = new Redis(redisOptions);
    }
  }

  private prefixed(key: string): string {
    return this.prefix ? `${this.prefix}:${key}` : key;
  }

  /** Retrieve a cached value, or `undefined` on miss or expiry. */
  async get(key: string): Promise<T | undefined> {
    const raw = await this.client.get(this.prefixed(key));
    if (raw === null) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    return JSON.parse(raw) as T;
  }

  /**
   * Store a value under `key` with an optional TTL.
   * If `ttlMs` is omitted, `defaultTtlMs` from the constructor options applies.
   */
  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const ttlSeconds = Math.ceil(ttl / 1_000);
    await this.client.set(this.prefixed(key), JSON.stringify(value), 'EX', ttlSeconds);
    this.sets++;
  }

  /** Remove a key. No-ops silently if the key does not exist. */
  async del(key: string): Promise<void> {
    await this.client.del(this.prefixed(key));
    this.deletes++;
  }

  /** Return `true` if the key exists and has not expired. */
  async has(key: string): Promise<boolean> {
    const n = await this.client.exists(this.prefixed(key));
    return n > 0;
  }

  /**
   * Fetch multiple keys in a single round-trip.
   * Missing or expired keys map to `undefined` in the result array.
   */
  async mget(keys: string[]): Promise<Array<T | undefined>> {
    if (keys.length === 0) return [];
    const raws = await this.client.mget(...keys.map((k) => this.prefixed(k)));
    return raws.map((raw) => {
      if (raw === null) {
        this.misses++;
        return undefined;
      }
      this.hits++;
      return JSON.parse(raw) as T;
    });
  }

  /**
   * Write multiple entries using a pipeline (single round-trip).
   * Each entry may carry its own `ttlMs`; absent entries fall back to `defaultTtlMs`.
   */
  async mset(entries: Array<{ key: string; value: T; ttlMs?: number }>): Promise<void> {
    if (entries.length === 0) return;
    const pipeline = this.client.pipeline();
    for (const entry of entries) {
      const ttl = entry.ttlMs ?? this.defaultTtlMs;
      const ttlSeconds = Math.ceil(ttl / 1_000);
      pipeline.set(this.prefixed(entry.key), JSON.stringify(entry.value), 'EX', ttlSeconds);
    }
    await pipeline.exec();
    this.sets += entries.length;
  }

  /** Read and reset per-instance counters. */
  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      deletes: this.deletes,
    };
  }

  /** Reset counters without touching stored entries. */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.deletes = 0;
  }

  /** Disconnect from Redis. */
  async close(): Promise<void> {
    await this.client.quit();
  }
}
