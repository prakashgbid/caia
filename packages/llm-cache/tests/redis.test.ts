import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the redis module before importing RedisBackend
vi.mock('redis', () => {
  const store = new Map<string, string>();
  const zsets = new Map<string, Array<{ score: number; value: string }>>();

  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockImplementation(async (key: string) => store.get(key) ?? null),
    set: vi.fn().mockImplementation(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    incr: vi.fn().mockImplementation(async (key: string) => {
      const cur = parseInt(store.get(key) ?? '0', 10);
      const next = cur + 1;
      store.set(key, String(next));
      return next;
    }),
    zAdd: vi.fn().mockImplementation(async (key: string, entry: { score: number; value: string }) => {
      const set = zsets.get(key) ?? [];
      set.push(entry);
      zsets.set(key, set);
      return 1;
    }),
    zRange: vi.fn().mockImplementation(async (key: string, max: string, min: string, opts: { BY: string; REV: boolean; LIMIT: { offset: number; count: number } }) => {
      const set = zsets.get(key) ?? [];
      const sorted = [...set].sort((a, b) => b.score - a.score);
      return sorted.slice(opts.LIMIT.offset, opts.LIMIT.offset + opts.LIMIT.count).map((e) => e.value);
    }),
    zRemRangeByScore: vi.fn().mockImplementation(async (key: string, min: string, max: number) => {
      const set = zsets.get(key) ?? [];
      const before = set.length;
      const after = set.filter((e) => e.score > max);
      zsets.set(key, after);
      return before - after.length;
    }),
    zCard: vi.fn().mockImplementation(async (key: string) => (zsets.get(key) ?? []).length),
    keys: vi.fn().mockImplementation(async (pattern: string) => {
      const prefix = pattern.replace('*', '');
      return [...zsets.keys(), ...store.keys()].filter((k) => k.startsWith(prefix));
    }),
    _store: store,
    _zsets: zsets,
    _reset: () => { store.clear(); zsets.clear(); },
  };

  return { createClient: vi.fn(() => client) };
});

import { RedisBackend } from '../src/backends/redis.js';
import type { CachedResponse } from '../src/types.js';

const SAMPLE: CachedResponse = {
  response: 'auth',
  model: 'qwen2.5-coder:7b',
  provider: 'local',
  durationMs: 120,
};

let backend: RedisBackend;

beforeEach(async () => {
  const { createClient } = await import('redis');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (createClient() as any)._reset();
  backend = new RedisBackend({ url: 'redis://localhost:6379', keyPrefix: 'test' });
  await backend.connect();
});

describe('RedisBackend — exact path', () => {
  it('returns undefined on cache miss', async () => {
    const result = await backend.getExactByHash('nonexistent-hash');
    expect(result).toBeUndefined();
  });

  it('stores and retrieves exact entries', async () => {
    const now = Date.now();
    await backend.putExact('hash-abc', 'ns', 'model', SAMPLE, now);
    const hit = await backend.getExactByHash('hash-abc');
    expect(hit).toBeDefined();
    expect(hit?.value).toEqual(SAMPLE);
    expect(hit?.createdAt).toBe(now);
  });

  it('increments exact count on put', async () => {
    await backend.putExact('hash-1', 'ns', 'model', SAMPLE, Date.now());
    await backend.putExact('hash-2', 'ns', 'model', SAMPLE, Date.now());
    const counts = await backend.countAll();
    expect(counts.exact).toBe(2);
  });
});

describe('RedisBackend — semantic path', () => {
  it('stores and lists semantic rows', async () => {
    const emb = Float32Array.from([0.1, 0.2, 0.3]);
    const now = Date.now();
    await backend.putSemantic('ns', 'model', 'hello world', emb, SAMPLE, now);

    const rows = await backend.listSemanticRows('ns', 'model', 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.prompt).toBe('hello world');
    expect(rows[0]?.value).toEqual(SAMPLE);
    expect(rows[0]?.createdAt).toBe(now);
    // Embedding round-trips through base64
    expect(rows[0]?.embedding).toBeInstanceOf(Float32Array);
    expect(rows[0]?.embedding.length).toBe(3);
    expect(rows[0]?.embedding[0]).toBeCloseTo(0.1);
  });

  it('returns newest-first order', async () => {
    const emb = Float32Array.from([1, 0]);
    await backend.putSemantic('ns', 'model', 'first', emb, SAMPLE, 1000);
    await backend.putSemantic('ns', 'model', 'second', emb, SAMPLE, 2000);

    const rows = await backend.listSemanticRows('ns', 'model', 10);
    expect(rows[0]?.prompt).toBe('second');
    expect(rows[1]?.prompt).toBe('first');
  });

  it('respects the limit parameter', async () => {
    const emb = Float32Array.from([1, 0]);
    for (let i = 0; i < 5; i++) {
      await backend.putSemantic('ns', 'model', `prompt-${i}`, emb, SAMPLE, i * 100);
    }
    const rows = await backend.listSemanticRows('ns', 'model', 3);
    expect(rows).toHaveLength(3);
  });
});

describe('RedisBackend — eviction', () => {
  it('evictOlderThan removes semantic rows below cutoff', async () => {
    const emb = Float32Array.from([1]);
    await backend.putSemantic('ns', 'model', 'old', emb, SAMPLE, 1000);
    await backend.putSemantic('ns', 'model', 'new', emb, SAMPLE, 9000);

    const removed = await backend.evictOlderThan(5000);
    expect(removed.semantic).toBe(1);

    const rows = await backend.listSemanticRows('ns', 'model', 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.prompt).toBe('new');
  });

  it('returns exact=0 since redis TTL handles exact expiry', async () => {
    const removed = await backend.evictOlderThan(Date.now());
    expect(removed.exact).toBe(0);
  });
});

describe('RedisBackend — close', () => {
  it('calls quit on close', async () => {
    const { createClient } = await import('redis');
    await backend.close();
    expect((createClient() as ReturnType<typeof createClient>).quit).toHaveBeenCalled();
  });
});
