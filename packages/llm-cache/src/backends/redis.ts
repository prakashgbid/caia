// Redis-backed CacheBackend using the 'redis' package (node-redis v4).
//
// Key schema:
//   exact:{hash}                   → JSON {payload, createdAt}  (with TTL)
//   sem:{namespace}:{model}        → sorted set scored by createdAt, member = row JSON
//   sem:{namespace}:{model}:count  → approximate counter for semantic row count
//   exact:count                    → approximate counter for exact entry count
//
// The exact entries use Redis native TTL (PEXPIRE) so eviction is automatic.
// Semantic rows use a sorted set; eviction is manual via ZREMRANGEBYSCORE.
// Counts are approximate because TTL-based expiry doesn't decrement the counter.

import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import type { CachedResponse } from '../types.js';
import type { CacheBackend, SemanticRow } from './interface.js';

export interface RedisSocketOptions {
  /**
   * TCP connect timeout in milliseconds. Default: 5000.
   */
  connectTimeout?: number;
  /**
   * Enable TCP keepalive. Pass the initial delay in milliseconds (e.g. 5000).
   * Disabled by default.
   */
  keepAlive?: number;
  /**
   * Enable TLS/SSL. When true uses default TLS settings; pass a TLS options
   * object for custom CA/cert/key. Default: false.
   */
  tls?: boolean;
}

export interface RedisBackendOptions {
  /**
   * Redis connection URL, e.g. "redis://localhost:6379" or
   * "rediss://user:pass@host:6380/2". When url is provided the individual
   * auth/socket fields below are still applied as overrides if present.
   */
  url: string;
  /**
   * Redis AUTH password. Overrides any password in the url.
   */
  password?: string;
  /**
   * Redis ACL username (Redis 6+). Overrides any username in the url.
   */
  username?: string;
  /**
   * Redis logical database index (0–15). Default: 0.
   */
  database?: number;
  /**
   * Low-level socket/TLS options forwarded to the Redis client.
   */
  socket?: RedisSocketOptions;
  /**
   * Optional key prefix to namespace all keys, e.g. "llm-cache".
   * Defaults to "llm".
   */
  keyPrefix?: string;
  /**
   * Default TTL in milliseconds applied to exact-match entries.
   * The PromptCache also checks TTL on read; this is the Redis-native
   * expiry that prevents unbounded memory growth. Default: 30 days.
   */
  ttlMs?: number;
}

interface ExactEntry {
  payload: string;
  createdAt: number;
}

interface SemanticMember {
  id: number;
  prompt: string;
  embedding: string; // base64-encoded Float32Array bytes
  payload: string;
  createdAt: number;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export class RedisBackend implements CacheBackend {
  private readonly client: RedisClientType;
  private readonly prefix: string;
  private readonly ttlMs: number;
  private connected = false;

  constructor(options: RedisBackendOptions) {
    this.prefix = options.keyPrefix ?? 'llm';
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.client = createClient({
      url: options.url,
      ...(options.password !== undefined && { password: options.password }),
      ...(options.username !== undefined && { username: options.username }),
      ...(options.database !== undefined && { database: options.database }),
      socket: {
        connectTimeout: options.socket?.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS,
        ...(options.socket?.keepAlive !== undefined && { keepAlive: options.socket.keepAlive }),
        ...(options.socket?.tls !== undefined && { tls: options.socket.tls }),
      },
    }) as RedisClientType;
  }

  /**
   * Build a RedisBackend from environment variables. Useful for 12-factor
   * app deployments where the connection config lives in env.
   *
   * Variables read:
   *   REDIS_URL         — required; full connection URL
   *   REDIS_PASSWORD    — optional; overrides password in URL
   *   REDIS_USERNAME    — optional; ACL username (Redis 6+)
   *   REDIS_DB          — optional; logical database index (integer 0–15)
   *   REDIS_TLS         — optional; "true" to enable TLS
   *   REDIS_CONNECT_TIMEOUT_MS — optional; socket connect timeout in ms
   *   LLM_CACHE_KEY_PREFIX    — optional; key namespace (default "llm")
   *   LLM_CACHE_TTL_MS        — optional; entry TTL in ms (default 30 days)
   */
  static fromEnv(env: Record<string, string | undefined> = process.env): RedisBackend {
    const url = env['REDIS_URL'];
    if (!url) {
      throw new Error('RedisBackend.fromEnv: REDIS_URL is required');
    }

    const dbRaw = env['REDIS_DB'];
    const database = dbRaw !== undefined ? parseInt(dbRaw, 10) : undefined;
    if (database !== undefined && (isNaN(database) || database < 0 || database > 15)) {
      throw new Error(`RedisBackend.fromEnv: REDIS_DB must be an integer 0–15, got "${dbRaw}"`);
    }

    const ttlRaw = env['LLM_CACHE_TTL_MS'];
    const ttlMs = ttlRaw !== undefined ? parseInt(ttlRaw, 10) : undefined;
    if (ttlMs !== undefined && (isNaN(ttlMs) || ttlMs <= 0)) {
      throw new Error(`RedisBackend.fromEnv: LLM_CACHE_TTL_MS must be a positive integer, got "${ttlRaw}"`);
    }

    const timeoutRaw = env['REDIS_CONNECT_TIMEOUT_MS'];
    const connectTimeout = timeoutRaw !== undefined ? parseInt(timeoutRaw, 10) : undefined;
    if (connectTimeout !== undefined && (isNaN(connectTimeout) || connectTimeout <= 0)) {
      throw new Error(
        `RedisBackend.fromEnv: REDIS_CONNECT_TIMEOUT_MS must be a positive integer, got "${timeoutRaw}"`,
      );
    }

    return new RedisBackend({
      url,
      ...(env['REDIS_PASSWORD'] !== undefined && { password: env['REDIS_PASSWORD'] }),
      ...(env['REDIS_USERNAME'] !== undefined && { username: env['REDIS_USERNAME'] }),
      ...(database !== undefined && { database }),
      ...(env['LLM_CACHE_KEY_PREFIX'] !== undefined && { keyPrefix: env['LLM_CACHE_KEY_PREFIX'] }),
      ...(ttlMs !== undefined && { ttlMs }),
      socket: {
        ...(env['REDIS_TLS'] === 'true' && { tls: true }),
        ...(connectTimeout !== undefined && { connectTimeout }),
      },
    });
  }

  /** Must be called before any other method. */
  async connect(): Promise<void> {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async getExactByHash(hash: string): Promise<{ value: CachedResponse; createdAt: number } | undefined> {
    const raw = await this.client.get(this.exactKey(hash));
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as ExactEntry;
    return {
      value: JSON.parse(entry.payload) as CachedResponse,
      createdAt: entry.createdAt,
    };
  }

  async putExact(
    hash: string,
    _namespace: string,
    _model: string,
    value: CachedResponse,
    createdAt: number,
  ): Promise<void> {
    const entry: ExactEntry = { payload: JSON.stringify(value), createdAt };
    await Promise.all([
      this.client.set(this.exactKey(hash), JSON.stringify(entry), { PX: this.ttlMs }),
      this.client.incr(this.exactCountKey()),
    ]);
  }

  async listSemanticRows(namespace: string, model: string, limit: number): Promise<SemanticRow[]> {
    // ZREVRANGE returns newest-first (highest score = most recent createdAt).
    const members = await this.client.zRange(
      this.semKey(namespace, model),
      '+inf',
      '-inf',
      { BY: 'SCORE', REV: true, LIMIT: { offset: 0, count: limit } },
    );
    return members.map((raw) => {
      const m = JSON.parse(raw) as SemanticMember;
      return {
        id: m.id,
        prompt: m.prompt,
        embedding: base64ToFloat32(m.embedding),
        value: JSON.parse(m.payload) as CachedResponse,
        createdAt: m.createdAt,
      };
    });
  }

  async putSemantic(
    namespace: string,
    model: string,
    prompt: string,
    embedding: Float32Array,
    value: CachedResponse,
    createdAt: number,
  ): Promise<void> {
    const counterKey = this.semCountKey(namespace, model);
    const id = await this.client.incr(counterKey);
    const member: SemanticMember = {
      id,
      prompt,
      embedding: float32ToBase64(embedding),
      payload: JSON.stringify(value),
      createdAt,
    };
    await this.client.zAdd(this.semKey(namespace, model), {
      score: createdAt,
      value: JSON.stringify(member),
    });
  }

  async countAll(): Promise<{ exact: number; semantic: number }> {
    const [exactRaw, semKeys] = await Promise.all([
      this.client.get(this.exactCountKey()),
      this.client.keys(`${this.prefix}:sem:*`),
    ]);
    const semKeysSorted = semKeys.filter((k) => !k.endsWith(':count'));
    const semCounts = semKeysSorted.length > 0
      ? await Promise.all(semKeysSorted.map((k) => this.client.zCard(k)))
      : [];
    return {
      exact: exactRaw ? parseInt(exactRaw, 10) : 0,
      semantic: semCounts.reduce((a, b) => a + b, 0),
    };
  }

  async evictOlderThan(cutoffMs: number): Promise<{ exact: number; semantic: number }> {
    // Exact entries expire via Redis TTL automatically; we can't efficiently
    // enumerate them. We decrement the counter by the eviction count, but
    // since we can't know how many expired naturally, exact count is approximate.
    const semKeys = (await this.client.keys(`${this.prefix}:sem:*`))
      .filter((k) => !k.endsWith(':count'));

    let semanticRemoved = 0;
    for (const key of semKeys) {
      const removed = await this.client.zRemRangeByScore(key, '-inf', cutoffMs - 1);
      semanticRemoved += removed;
    }

    return { exact: 0, semantic: semanticRemoved };
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.quit();
      this.connected = false;
    }
  }

  private exactKey(hash: string): string {
    return `${this.prefix}:exact:${hash}`;
  }

  private exactCountKey(): string {
    return `${this.prefix}:exact:count`;
  }

  private semKey(namespace: string, model: string): string {
    return `${this.prefix}:sem:${namespace}:${model}`;
  }

  private semCountKey(namespace: string, model: string): string {
    return `${this.prefix}:sem:${namespace}:${model}:count`;
  }
}

function float32ToBase64(arr: Float32Array): string {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
}

function base64ToFloat32(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  return new Float32Array(ab);
}
