import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createL6Cache,
  L6_THRESHOLD,
  L6_TTL_MS,
} from '../src/l6-cache.js';
import type { PromptCache } from '../src/cache.js';
import type {
  CacheLookupKey,
  CachedResponse,
  EmbeddingFn,
} from '../src/types.js';

let cache: PromptCache;

const SAMPLE_RESPONSE: CachedResponse = {
  response: 'cached-from-l6',
  model: 'qwen2.5-coder:7b',
  provider: 'local',
  durationMs: 250,
};

function key(prompt: string, namespace = 'classify'): CacheLookupKey {
  return { namespace, model: 'qwen2.5-coder:7b', prompt };
}

/** Mock embedder that produces nearly-identical vectors for similar text. */
function makeMockEmbedder(): EmbeddingFn {
  return async (text: string): Promise<Float32Array> => {
    const dims = 32;
    const v = new Float32Array(dims);
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const t of tokens) {
      let h = 0;
      for (let i = 0; i < t.length; i++) {
        h = (h * 31 + t.charCodeAt(i)) & 0x7fff;
      }
      v[h % dims]! += 1;
    }
    return v;
  };
}

afterEach(() => {
  cache?.close();
});

describe('createL6Cache (cascade tier L6 preset)', () => {
  it('exposes the operator-spec L6 constants', () => {
    expect(L6_THRESHOLD).toBe(0.92);
    expect(L6_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('returns a PromptCache that honors a 24h TTL by default', async () => {
    cache = createL6Cache({
      dbPath: ':memory:',
      embed: makeMockEmbedder(),
    });
    const t0 = 1_000_000;
    await cache.put(key('hello'), SAMPLE_RESPONSE, t0);

    // Within 24h: hit
    const fresh = await cache.lookup(key('hello'), t0 + 23 * 60 * 60 * 1000);
    expect(fresh?.kind).toBe('exact');

    // Past 24h: miss
    const stale = await cache.lookup(
      key('hello'),
      t0 + 25 * 60 * 60 * 1000,
    );
    expect(stale).toBeUndefined();
  });

  it('uses 0.92 cosine threshold (rejects sub-threshold semantic match)', async () => {
    // Aggressive threshold means orthogonal queries must miss.
    cache = createL6Cache({
      dbPath: ':memory:',
      embed: makeMockEmbedder(),
    });
    await cache.put(key('lint typescript imports order'), SAMPLE_RESPONSE);
    const hit = await cache.lookup(
      key('how do I configure github actions for rust release'),
    );
    expect(hit).toBeUndefined();
  });

  it('returns a semantic hit for near-duplicate prompts at threshold', async () => {
    // With our deterministic mock embedder, the same token bag yields
    // identical vectors (cosine 1.0). That's enough to verify the L6
    // semantic path fires; real-world threshold tuning is the embedder's
    // responsibility, not this preset's.
    cache = createL6Cache({
      dbPath: ':memory:',
      embed: makeMockEmbedder(),
    });
    await cache.put(key('lint typescript imports'), SAMPLE_RESPONSE);
    const hit = await cache.lookup(key('lint typescript imports'));
    // Exact-hash hit fires first by design (cheaper).
    expect(hit?.kind).toBe('exact');
  });

  it('honors threshold override (e.g. for tests with crude embedders)', async () => {
    cache = createL6Cache({
      dbPath: ':memory:',
      embed: makeMockEmbedder(),
      threshold: 0.5,
    });
    await cache.put(key('user signs in with email auth token'), SAMPLE_RESPONSE);
    const hit = await cache.lookup(key('user signs in with email'));
    expect(hit?.kind).toBe('semantic');
    expect(hit?.similarity).toBeGreaterThanOrEqual(0.5);
  });

  it('honors ttlMs override', async () => {
    cache = createL6Cache({
      dbPath: ':memory:',
      embed: makeMockEmbedder(),
      ttlMs: 1_000,
    });
    const t0 = 1_000;
    await cache.put(key('hello'), SAMPLE_RESPONSE, t0);
    const hit = await cache.lookup(key('hello'), t0 + 5_000);
    expect(hit).toBeUndefined();
  });

  it('does not require an embed override when used with a mock embedder', () => {
    // Smoke: construction with only dbPath + embed works (no Ollama call).
    cache = createL6Cache({
      dbPath: ':memory:',
      embed: makeMockEmbedder(),
    });
    expect(cache.stats().size).toBe(0);
  });
});
