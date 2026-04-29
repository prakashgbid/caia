import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CacheStore } from '../src/store.js';
import type { CachedResponse } from '../src/types.js';

let store: CacheStore;

const RESPONSE: CachedResponse = {
  response: 'auth',
  model: 'qwen2.5-coder:7b',
  provider: 'local',
  durationMs: 180,
};

beforeEach(() => {
  store = new CacheStore(':memory:');
});

afterEach(() => {
  store.close();
});

describe('CacheStore (exact path)', () => {
  it('round-trips an exact entry', () => {
    store.putExact('h1', 'task', 'qwen2.5-coder:7b', RESPONSE, 1_000);
    const got = store.getExactByHash('h1');
    expect(got?.value).toEqual(RESPONSE);
    expect(got?.createdAt).toBe(1_000);
  });

  it('returns undefined for an unknown hash', () => {
    expect(store.getExactByHash('missing')).toBeUndefined();
  });

  it('replaces a previous entry with the same hash', () => {
    store.putExact('h1', 'task', 'qwen2.5-coder:7b', RESPONSE, 1_000);
    const updated: CachedResponse = { ...RESPONSE, response: 'ui' };
    store.putExact('h1', 'task', 'qwen2.5-coder:7b', updated, 2_000);
    expect(store.getExactByHash('h1')?.value.response).toBe('ui');
    expect(store.countAll().exact).toBe(1);
  });
});

describe('CacheStore (semantic path)', () => {
  it('persists semantic rows and returns them in newest-first order', () => {
    const e1 = Float32Array.from([1, 0, 0]);
    const e2 = Float32Array.from([0, 1, 0]);
    store.putSemantic('task', 'qwen2.5-coder:7b', 'p1', e1, RESPONSE, 1);
    store.putSemantic('task', 'qwen2.5-coder:7b', 'p2', e2, RESPONSE, 2);

    const rows = store.listSemanticRows('task', 'qwen2.5-coder:7b', 10);
    expect(rows.map((r) => r.prompt)).toEqual(['p2', 'p1']);
    expect(Array.from(rows[0]!.embedding)).toEqual([0, 1, 0]);
  });

  it('namespaces rows by (namespace, model)', () => {
    const e = Float32Array.from([1, 0, 0]);
    store.putSemantic('task-a', 'qwen2.5-coder:7b', 'p', e, RESPONSE, 1);
    store.putSemantic('task-b', 'qwen2.5-coder:7b', 'p', e, RESPONSE, 1);
    store.putSemantic('task-a', 'qwen3:14b', 'p', e, RESPONSE, 1);

    expect(store.listSemanticRows('task-a', 'qwen2.5-coder:7b', 10)).toHaveLength(1);
    expect(store.listSemanticRows('task-b', 'qwen2.5-coder:7b', 10)).toHaveLength(1);
    expect(store.listSemanticRows('task-a', 'qwen3:14b', 10)).toHaveLength(1);
  });

  it('caps rows scanned with the provided limit', () => {
    const e = Float32Array.from([1, 0, 0]);
    for (let i = 0; i < 5; i++) {
      store.putSemantic('task', 'm', `p${i}`, e, RESPONSE, i);
    }
    expect(store.listSemanticRows('task', 'm', 3)).toHaveLength(3);
  });
});

describe('CacheStore eviction', () => {
  it('evicts old rows from both tables', () => {
    store.putExact('h1', 'task', 'm', RESPONSE, 1_000);
    store.putExact('h2', 'task', 'm', RESPONSE, 5_000);
    store.putSemantic('task', 'm', 'old', Float32Array.from([1]), RESPONSE, 1_000);
    store.putSemantic('task', 'm', 'new', Float32Array.from([1]), RESPONSE, 5_000);

    const removed = store.evictOlderThan(3_000);
    expect(removed.exact).toBe(1);
    expect(removed.semantic).toBe(1);
    expect(store.countAll()).toEqual({ exact: 1, semantic: 1 });
  });
});
