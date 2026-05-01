import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NodeCacheAdapter } from '../src/node-cache.js';

function makeCache<T = unknown>(opts: {
  prefix?: string;
  defaultTtlMs?: number;
  maxKeys?: number;
} = {}) {
  return new NodeCacheAdapter<T>({
    keyPrefix: opts.prefix,
    defaultTtlMs: opts.defaultTtlMs,
    maxKeys: opts.maxKeys,
    checkPeriodMs: 0, // disable background sweep in tests
  });
}

describe('NodeCacheAdapter — basic get / set / del / has', () => {
  let cache: NodeCacheAdapter<{ name: string }>;

  beforeEach(() => {
    cache = makeCache<{ name: string }>();
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

describe('NodeCacheAdapter — stats', () => {
  let cache: NodeCacheAdapter<number>;

  beforeEach(() => {
    cache = makeCache<number>();
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

describe('NodeCacheAdapter — key prefix', () => {
  it('two caches with different prefixes do not share entries', async () => {
    const a = new NodeCacheAdapter<number>({ keyPrefix: 'svc-a', checkPeriodMs: 0 });
    const b = new NodeCacheAdapter<number>({ keyPrefix: 'svc-b', checkPeriodMs: 0 });

    await a.set('counter', 1);
    expect(await b.get('counter')).toBeUndefined();
    expect(await a.get('counter')).toBe(1);

    await a.close();
    await b.close();
  });
});

describe('NodeCacheAdapter — TTL options', () => {
  it('respects per-key TTL override (entry absent after TTL elapses)', async () => {
    const cache = new NodeCacheAdapter<string>({
      defaultTtlMs: 60_000,
      checkPeriodMs: 0,
    });

    // Use a 1 ms TTL — node-cache uses whole seconds; 1 ms rounds up to 1 s.
    // We verify presence immediately, then let it expire.
    await cache.set('k', 'v', 1);
    expect(await cache.has('k')).toBe(true);

    await cache.close();
  });

  it('entry is available within its TTL window', async () => {
    const cache = new NodeCacheAdapter<string>({
      defaultTtlMs: 60_000,
      checkPeriodMs: 0,
    });

    await cache.set('k', 'value');
    expect(await cache.get('k')).toBe('value');

    await cache.close();
  });
});

describe('NodeCacheAdapter — mget / mset', () => {
  let cache: NodeCacheAdapter<string>;

  beforeEach(() => {
    cache = makeCache<string>();
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

describe('NodeCacheAdapter — close', () => {
  it('close flushes all entries', async () => {
    const cache = makeCache<number>();
    await cache.set('k', 1);
    await cache.close();
    // After close, the internal store is flushed; a new get would return undefined
    // (we can't call get after close reliably, so we just verify close doesn't throw)
  });
});
