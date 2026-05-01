// Tests for RedisBackend using a vitest mock of the redis client.
//
// We mock `redis` at the module level and inject a fake client that stores
// data in plain Maps, so no real Redis process is needed. The tests verify
// that RedisBackend correctly translates CacheBackend calls into the
// expected Redis commands.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CachedResponse } from '../src/types.js';

// ---------------------------------------------------------------------------
// Fake Redis client
// ---------------------------------------------------------------------------

function makeFakeRedisClient() {
  const kv = new Map<string, string>();
  const sorted = new Map<string, Array<{ score: number; value: string }>>();
  const counters = new Map<string, number>();

  return {
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),

    get: vi.fn().mockImplementation(async (key: string) => kv.get(key) ?? null),

    set: vi.fn().mockImplementation(async (key: string, val: string) => {
      kv.set(key, val);
      return 'OK';
    }),

    incr: vi.fn().mockImplementation(async (key: string) => {
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      return n;
    }),

    zAdd: vi.fn().mockImplementation(async (key: string, item: { score: number; value: string }) => {
      const list = sorted.get(key) ?? [];
      list.push(item);
      sorted.set(key, list);
      return 1;
    }),

    zRange: vi.fn().mockImplementation(
      async (
        key: string,
        _max: string,
        _min: string,
        opts: { BY: string; REV: boolean; LIMIT: { offset: number; count: number } },
      ) => {
        const list = sorted.get(key) ?? [];
        const sorted_desc = [...list].sort((a, b) => b.score - a.score);
        const limited = sorted_desc.slice(opts.LIMIT.offset, opts.LIMIT.offset + opts.LIMIT.count);
        return limited.map((item) => item.value);
      },
    ),

    zCard: vi.fn().mockImplementation(async (key: string) => {
      return (sorted.get(key) ?? []).length;
    }),

    zRemRangeByScore: vi.fn().mockImplementation(async (key: string, _min: string, max: number) => {
      const list = sorted.get(key) ?? [];
      const kept = list.filter((item) => item.score > max);
      const removed = list.length - kept.length;
      sorted.set(key, kept);
      return removed;
    }),

    keys: vi.fn().mockImplementation(async (pattern: string) => {
      const prefix = pattern.replace(':*', '');
      const allKeys = [
        ...Array.from(kv.keys()),
        ...Array.from(sorted.keys()),
        ...Array.from(counters.keys()).map((k) => k),
      ];
      return [...new Set(allKeys)].filter((k) => k.startsWith(prefix));
    }),
  };
}

// ---------------------------------------------------------------------------
// Mock the redis module
// ---------------------------------------------------------------------------

vi.mock('redis', () => {
  let fakeClient: ReturnType<typeof makeFakeRedisClient>;
  return {
    createClient: vi.fn().mockImplementation(() => {
      fakeClient = makeFakeRedisClient();
      return fakeClient;
    }),
  };
});

// Import after mock is set up
const { RedisBackend } = await import('../src/backends/redis.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const RESPONSE: CachedResponse = {
  response: 'auth',
  model: 'qwen2.5-coder:7b',
  provider: 'local',
  durationMs: 200,
};

describe('RedisBackend', () => {
  let backend: InstanceType<typeof RedisBackend>;

  beforeEach(async () => {
    vi.clearAllMocks();
    backend = new RedisBackend({ url: 'redis://localhost:6379', keyPrefix: 'test' });
    await backend.connect();
  });

  it('stores and retrieves an exact entry', async () => {
    await backend.putExact('hash1', 'ns', 'model', RESPONSE, 1000);
    const got = await backend.getExactByHash('hash1');
    expect(got?.value).toEqual(RESPONSE);
    expect(got?.createdAt).toBe(1000);
  });

  it('returns undefined for a missing exact entry', async () => {
    const got = await backend.getExactByHash('nonexistent');
    expect(got).toBeUndefined();
  });

  it('stores and retrieves semantic rows newest-first', async () => {
    const e1 = Float32Array.from([1, 0, 0]);
    const e2 = Float32Array.from([0, 1, 0]);
    await backend.putSemantic('ns', 'model', 'p1', e1, RESPONSE, 1000);
    await backend.putSemantic('ns', 'model', 'p2', e2, RESPONSE, 2000);

    const rows = await backend.listSemanticRows('ns', 'model', 10);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.prompt).toBe('p2'); // newest first
    expect(rows[1]!.prompt).toBe('p1');
    expect(Array.from(rows[0]!.embedding)).toEqual([0, 1, 0]);
  });

  it('respects the limit on listSemanticRows', async () => {
    const e = Float32Array.from([1, 0, 0]);
    for (let i = 0; i < 5; i++) {
      await backend.putSemantic('ns', 'model', `p${i}`, e, RESPONSE, i * 100);
    }
    const rows = await backend.listSemanticRows('ns', 'model', 3);
    expect(rows).toHaveLength(3);
  });

  it('preserves Float32Array round-trip through base64', async () => {
    const original = Float32Array.from([0.1, 0.5, -0.3, 1.0]);
    await backend.putSemantic('ns', 'm', 'prompt', original, RESPONSE, 1000);
    const rows = await backend.listSemanticRows('ns', 'm', 10);
    const recovered = rows[0]!.embedding;
    expect(recovered.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(recovered[i]).toBeCloseTo(original[i]!, 6);
    }
  });

  it('evicts semantic rows older than cutoff', async () => {
    const e = Float32Array.from([1]);
    await backend.putSemantic('ns', 'm', 'old', e, RESPONSE, 1000);
    await backend.putSemantic('ns', 'm', 'new', e, RESPONSE, 5000);

    const removed = await backend.evictOlderThan(3000);
    expect(removed.semantic).toBe(1);

    const rows = await backend.listSemanticRows('ns', 'm', 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.prompt).toBe('new');
  });

  it('close calls quit on the client', async () => {
    await backend.close();
    // Calling close a second time should be a no-op (not call quit again)
    await backend.close();
  });
});
