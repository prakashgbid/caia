import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Redis from 'ioredis';
import { RedisCache } from '../src/cache.js';

// ---------------------------------------------------------------------------
// In-memory Redis stub — satisfies the subset of ioredis.Redis that
// RedisCache uses without opening a real TCP connection.
// ---------------------------------------------------------------------------

interface PipelineEntry {
  key: string;
  value: string;
  ttlSeconds: number;
}

class MockRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== -1 && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, _ex: 'EX', seconds: number): Promise<'OK'> {
    this.store.set(key, {
      value,
      expiresAt: seconds > 0 ? Date.now() + seconds * 1_000 : -1,
    });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    if (entry.expiresAt !== -1 && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return 0;
    }
    return 1;
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    return Promise.all(keys.flat().map((k) => this.get(k)));
  }

  pipeline() {
    const pending: PipelineEntry[] = [];
    const self = this;
    const pipe = {
      set(key: string, value: string, _ex: 'EX', seconds: number) {
        pending.push({ key, value, ttlSeconds: seconds });
        return pipe;
      },
      async exec(): Promise<Array<['OK', null]>> {
        for (const { key, value, ttlSeconds } of pending) {
          await self.set(key, value, 'EX', ttlSeconds);
        }
        return pending.map(() => ['OK', null]);
      },
    };
    return pipe;
  }

  async quit(): Promise<'OK'> {
    this.store.clear();
    return 'OK';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCache<T = unknown>(opts: { prefix?: string; defaultTtlMs?: number } = {}) {
  const mock = new MockRedis();
  const cache = new RedisCache<T>(
    { keyPrefix: opts.prefix, defaultTtlMs: opts.defaultTtlMs },
    mock as unknown as Redis,
  );
  return { cache, mock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RedisCache — basic get / set / del / has', () => {
  let cache: RedisCache<{ name: string }>;

  beforeEach(() => {
    ({ cache } = makeCache<{ name: string }>());
  });

  afterEach(async () => {
    await cache.close();
  });

  it('returns undefined for a missing key', async () => {
    expect(await cache.get('missing')).toBeUndefined();
  });

  it('stores and retrieves a value', async () => {
    await cache.set('user:1', { name: 'Alice' });
    expect(await cache.get('user:1')).toEqual({ name: 'Alice' });
  });

  it('del removes the entry', async () => {
    await cache.set('user:1', { name: 'Alice' });
    await cache.del('user:1');
    expect(await cache.get('user:1')).toBeUndefined();
  });

  it('has returns true for existing key and false for missing', async () => {
    await cache.set('user:2', { name: 'Bob' });
    expect(await cache.has('user:2')).toBe(true);
    expect(await cache.has('user:999')).toBe(false);
  });

  it('overwrites an existing entry on set', async () => {
    await cache.set('user:1', { name: 'Alice' });
    await cache.set('user:1', { name: 'Alice-v2' });
    expect(await cache.get('user:1')).toEqual({ name: 'Alice-v2' });
  });
});

describe('RedisCache — stats', () => {
  let cache: RedisCache<number>;

  beforeEach(() => {
    ({ cache } = makeCache<number>());
  });

  afterEach(async () => {
    await cache.close();
  });

  it('starts with all counters at zero', () => {
    expect(cache.stats()).toEqual({ hits: 0, misses: 0, sets: 0, deletes: 0 });
  });

  it('increments hits and sets correctly', async () => {
    await cache.set('k', 42);
    await cache.get('k');
    expect(cache.stats()).toEqual({ hits: 1, misses: 0, sets: 1, deletes: 0 });
  });

  it('increments misses on missing key', async () => {
    await cache.get('absent');
    expect(cache.stats().misses).toBe(1);
    expect(cache.stats().hits).toBe(0);
  });

  it('increments deletes', async () => {
    await cache.set('k', 1);
    await cache.del('k');
    expect(cache.stats().deletes).toBe(1);
  });

  it('resetStats zeroes counters without flushing data', async () => {
    await cache.set('k', 99);
    await cache.get('k');
    cache.resetStats();
    expect(cache.stats()).toEqual({ hits: 0, misses: 0, sets: 0, deletes: 0 });
    expect(await cache.get('k')).toBe(99);
  });
});

describe('RedisCache — key prefix', () => {
  afterEach(async () => {
    // caches are closed inside each test
  });

  it('two caches with different prefixes do not share entries', async () => {
    const { cache: cacheA } = makeCache({ prefix: 'svc-a' });
    const { cache: cacheB } = makeCache({ prefix: 'svc-b' });

    // We need both to share the same underlying mock store.
    // Simplest: use a single mock and inject into both.
    const shared = new MockRedis();
    const a = new RedisCache<number>({ keyPrefix: 'svc-a' }, shared as unknown as Redis);
    const b = new RedisCache<number>({ keyPrefix: 'svc-b' }, shared as unknown as Redis);

    await a.set('counter', 1);
    expect(await b.get('counter')).toBeUndefined();
    expect(await a.get('counter')).toBe(1);

    await a.close();
    await b.close();
    // suppress unused warning
    void cacheA;
    void cacheB;
  });
});

describe('RedisCache — TTL options', () => {
  it('uses defaultTtlMs when no per-key TTL is given', async () => {
    const mock = new MockRedis();
    const setSpy: Array<number> = [];
    const origSet = mock.set.bind(mock);
    mock.set = async (key, value, ex, seconds) => {
      setSpy.push(seconds);
      return origSet(key, value, ex, seconds);
    };

    const cache = new RedisCache<string>(
      { defaultTtlMs: 60_000 }, // 60 seconds
      mock as unknown as Redis,
    );

    await cache.set('k', 'v');
    expect(setSpy[0]).toBe(60);
    await cache.close();
  });

  it('per-key TTL overrides the default', async () => {
    const mock = new MockRedis();
    const setSpy: Array<number> = [];
    const origSet = mock.set.bind(mock);
    mock.set = async (key, value, ex, seconds) => {
      setSpy.push(seconds);
      return origSet(key, value, ex, seconds);
    };

    const cache = new RedisCache<string>(
      { defaultTtlMs: 60_000 }, // 60 s default
      mock as unknown as Redis,
    );

    await cache.set('k', 'v', 5_000); // 5 s override
    expect(setSpy[0]).toBe(5);
    await cache.close();
  });

  it('rounds sub-second TTL up to 1 second', async () => {
    const mock = new MockRedis();
    const setSpy: Array<number> = [];
    const origSet = mock.set.bind(mock);
    mock.set = async (key, value, ex, seconds) => {
      setSpy.push(seconds);
      return origSet(key, value, ex, seconds);
    };

    const cache = new RedisCache<string>(
      { defaultTtlMs: 500 }, // 0.5 s → rounds to 1 s
      mock as unknown as Redis,
    );

    await cache.set('k', 'v');
    expect(setSpy[0]).toBe(1);
    await cache.close();
  });
});

describe('RedisCache — mget / mset', () => {
  let cache: RedisCache<string>;

  beforeEach(() => {
    ({ cache } = makeCache<string>());
  });

  afterEach(async () => {
    await cache.close();
  });

  it('mget returns values for existing keys and undefined for missing', async () => {
    await cache.set('a', 'alpha');
    await cache.set('b', 'beta');
    const results = await cache.mget(['a', 'b', 'c']);
    expect(results).toEqual(['alpha', 'beta', undefined]);
  });

  it('mget on empty array returns empty array', async () => {
    expect(await cache.mget([])).toEqual([]);
  });

  it('mget increments hits and misses', async () => {
    await cache.set('x', 'X');
    await cache.mget(['x', 'y']);
    const s = cache.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
  });

  it('mset writes all entries', async () => {
    await cache.mset([
      { key: 'one', value: '1' },
      { key: 'two', value: '2' },
    ]);
    expect(await cache.get('one')).toBe('1');
    expect(await cache.get('two')).toBe('2');
    expect(cache.stats().sets).toBe(2);
  });

  it('mset on empty array is a no-op', async () => {
    await cache.mset([]);
    expect(cache.stats().sets).toBe(0);
  });
});
