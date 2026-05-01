// In-memory key-value cache backed by node-cache.
//
// Drop-in alternative to RedisCache for local development, testing, and
// lightweight deployments that don't require a Redis instance.
// Exposes the same async get/set/del/has/mget/mset/stats/close surface.

import NC from 'node-cache';
import type { CacheStats, NodeCacheAdapterOptions } from './types.js';

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_CHECK_PERIOD_MS = 10 * 60 * 1000;   // 10 minutes

export class NodeCacheAdapter<T = unknown> {
  private readonly nc: NC;
  private readonly prefix: string;
  private readonly defaultTtlMs: number;
  private hits = 0;
  private misses = 0;
  private sets = 0;
  private deletes = 0;

  constructor(options: NodeCacheAdapterOptions = {}) {
    this.prefix = options.keyPrefix ?? '';
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;

    const checkPeriodMs = options.checkPeriodMs ?? DEFAULT_CHECK_PERIOD_MS;
    this.nc = new NC({
      stdTTL: Math.ceil(this.defaultTtlMs / 1_000),
      checkperiod: Math.ceil(checkPeriodMs / 1_000),
      useClones: false,
      ...(options.maxKeys !== undefined ? { maxKeys: options.maxKeys } : {}),
    });
  }

  private prefixed(key: string): string {
    return this.prefix ? `${this.prefix}:${key}` : key;
  }

  async get(key: string): Promise<T | undefined> {
    const value = this.nc.get<T>(this.prefixed(key));
    if (value === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    return value;
  }

  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    const ttlSeconds = Math.ceil((ttlMs ?? this.defaultTtlMs) / 1_000);
    this.nc.set(this.prefixed(key), value, ttlSeconds);
    this.sets++;
  }

  async del(key: string): Promise<void> {
    this.nc.del(this.prefixed(key));
    this.deletes++;
  }

  async has(key: string): Promise<boolean> {
    return this.nc.has(this.prefixed(key));
  }

  async mget(keys: string[]): Promise<Array<T | undefined>> {
    if (keys.length === 0) return [];
    return keys.map((key) => {
      const value = this.nc.get<T>(this.prefixed(key));
      if (value === undefined) {
        this.misses++;
        return undefined;
      }
      this.hits++;
      return value;
    });
  }

  async mset(entries: Array<{ key: string; value: T; ttlMs?: number }>): Promise<void> {
    if (entries.length === 0) return;
    for (const entry of entries) {
      const ttlSeconds = Math.ceil((entry.ttlMs ?? this.defaultTtlMs) / 1_000);
      this.nc.set(this.prefixed(entry.key), entry.value, ttlSeconds);
    }
    this.sets += entries.length;
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      sets: this.sets,
      deletes: this.deletes,
    };
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.sets = 0;
    this.deletes = 0;
  }

  /** Return all stored keys (with prefix stripped). */
  keys(): string[] {
    const raw = this.nc.keys();
    if (!this.prefix) return raw;
    const stripped: string[] = [];
    for (const k of raw) {
      stripped.push(k.startsWith(`${this.prefix}:`) ? k.slice(this.prefix.length + 1) : k);
    }
    return stripped;
  }

  /** Return TTL expiry timestamp (ms since epoch) for a key, or undefined if not set / no TTL. */
  ttlMs(key: string): number | undefined {
    const ts = this.nc.getTtl(this.prefixed(key));
    if (ts === undefined || ts === false || ts === 0) return undefined;
    return ts as number;
  }

  /** Flush all entries (does not reset stats counters). */
  async flush(): Promise<void> {
    this.nc.flushAll();
  }

  /** Flush all entries and stop the internal cleanup timer. */
  async close(): Promise<void> {
    this.nc.flushAll();
    this.nc.close();
  }
}
