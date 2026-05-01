import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PromptCache } from '../src/cache.js';
import type {
  CacheLookupKey,
  CachedResponse,
  EmbeddingFn,
} from '../src/types.js';

let cache: PromptCache;

const SAMPLE_RESPONSE: CachedResponse = {
  response: 'auth',
  model: 'qwen2.5-coder:7b',
  provider: 'local',
  durationMs: 200,
  usage: { promptTokens: 8, completionTokens: 1, totalTokens: 9 },
};

function key(prompt: string, namespace = 'domain-classification'): CacheLookupKey {
  return {
    namespace,
    model: 'qwen2.5-coder:7b',
    prompt,
  };
}

/** Bag-of-words mock embedder — deterministic and shares dims for shared tokens. */
function makeMockEmbedder(): EmbeddingFn {
  return async (text: string): Promise<Float32Array> => {
    const e = new Array<number>(64).fill(0);
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    for (const t of tokens) {
      let h = 0;
      for (let i = 0; i < t.length; i++) {
        h = (h * 31 + t.charCodeAt(i)) & 0xffff;
      }
      e[h % 64]! += 1;
    }
    return Float32Array.from(e);
  };
}

afterEach(async () => {
  await cache.close();
});

describe('PromptCache (exact-only mode)', () => {
  beforeEach(() => {
    cache = new PromptCache({ dbPath: ':memory:' });
  });

  it('starts empty and counts misses', async () => {
    const hit = await cache.lookup(key('hello'));
    expect(hit).toBeUndefined();
    const s = await cache.stats();
    expect(s.exactHits).toBe(0);
    expect(s.misses).toBe(1);
    expect(s.size).toBe(0);
  });

  it('returns an exact hit on identical prompt + model + namespace', async () => {
    await cache.put(key('user signs in'), SAMPLE_RESPONSE);
    const hit = await cache.lookup(key('user signs in'));
    expect(hit).toBeDefined();
    expect(hit?.kind).toBe('exact');
    expect(hit?.similarity).toBe(1);
    expect(hit?.value).toEqual(SAMPLE_RESPONSE);
    const s = await cache.stats();
    expect(s.exactHits).toBe(1);
  });

  it('does not match across different namespaces', async () => {
    await cache.put(key('hello', 'task-a'), SAMPLE_RESPONSE);
    const hit = await cache.lookup(key('hello', 'task-b'));
    expect(hit).toBeUndefined();
  });

  it('does not match across different models', async () => {
    await cache.put(
      { namespace: 'a', model: 'qwen2.5-coder:7b', prompt: 'hi' },
      SAMPLE_RESPONSE,
    );
    const hit = await cache.lookup({
      namespace: 'a',
      model: 'qwen3:14b',
      prompt: 'hi',
    });
    expect(hit).toBeUndefined();
  });

  it('does not match when system prompt differs', async () => {
    await cache.put(
      { ...key('hi'), systemPrompt: 'You are A.' },
      SAMPLE_RESPONSE,
    );
    const hit = await cache.lookup({
      ...key('hi'),
      systemPrompt: 'You are B.',
    });
    expect(hit).toBeUndefined();
  });

  it('returns no hit when no embedder is configured (semantic disabled)', async () => {
    await cache.put(key('user signs in with email'), SAMPLE_RESPONSE);
    // Different wording — exact hash won't match, and we have no embedder.
    const hit = await cache.lookup(key('user logs in with email'));
    expect(hit).toBeUndefined();
  });

  it('expires entries past the TTL', async () => {
    await cache.close();
    cache = new PromptCache({ dbPath: ':memory:', ttlMs: 1_000 });
    const t0 = 1_000;
    await cache.put(key('hi'), SAMPLE_RESPONSE, t0);

    // Within TTL: hit
    const fresh = await cache.lookup(key('hi'), t0 + 500);
    expect(fresh?.kind).toBe('exact');

    // Past TTL: miss
    const stale = await cache.lookup(key('hi'), t0 + 5_000);
    expect(stale).toBeUndefined();
  });

  it('sweep evicts expired rows', async () => {
    await cache.close();
    cache = new PromptCache({ dbPath: ':memory:', ttlMs: 1_000 });
    await cache.put(key('a'), SAMPLE_RESPONSE, 0);
    await cache.put(key('b'), SAMPLE_RESPONSE, 0);
    const s0 = await cache.stats();
    expect(s0.size).toBe(2);

    const removed = await cache.sweep(10_000);
    expect(removed.exact).toBe(2);
    const s1 = await cache.stats();
    expect(s1.size).toBe(0);
  });
});

describe('PromptCache (semantic mode)', () => {
  beforeEach(() => {
    cache = new PromptCache({
      dbPath: ':memory:',
      embed: makeMockEmbedder(),
      // Lower threshold so we can exercise hits with our crude mock
      // embedder; production default is 0.95.
      semantic: { threshold: 0.6 },
    });
  });

  it('returns a semantic hit when prompt is similar enough', async () => {
    await cache.put(
      key('user signs in with email auth'),
      SAMPLE_RESPONSE,
    );
    const hit = await cache.lookup(
      key('user signs in with email'),
    );
    expect(hit).toBeDefined();
    expect(hit?.kind).toBe('semantic');
    expect(hit?.similarity).toBeGreaterThanOrEqual(0.6);
    expect(hit?.value).toEqual(SAMPLE_RESPONSE);
  });

  it('falls through to miss when no cached prompt clears the threshold', async () => {
    await cache.close();
    cache = new PromptCache({
      dbPath: ':memory:',
      embed: makeMockEmbedder(),
      semantic: { threshold: 0.99 },
    });
    await cache.put(key('user signs in with email auth'), SAMPLE_RESPONSE);
    const hit = await cache.lookup(key('totally unrelated query'));
    expect(hit).toBeUndefined();
    const s = await cache.stats();
    expect(s.misses).toBeGreaterThan(0);
  });

  it('prefers exact match over semantic when both could fire', async () => {
    await cache.put(key('hello world'), SAMPLE_RESPONSE);
    const hit = await cache.lookup(key('hello world'));
    expect(hit?.kind).toBe('exact');
    const s = await cache.stats();
    expect(s.exactHits).toBe(1);
    expect(s.semanticHits).toBe(0);
  });

  it('stats counters segment by hit kind', async () => {
    await cache.put(key('hello world'), SAMPLE_RESPONSE);
    await cache.lookup(key('hello world')); // exact
    await cache.lookup(key('hello world cup')); // semantic-or-miss
    await cache.lookup(key('completely orthogonal text 123 xyz'));
    const s = await cache.stats();
    expect(s.exactHits).toBe(1);
    // Don't assert exact counts on the mock embedder; just sanity-check
    // they sum to the number of lookups.
    expect(s.exactHits + s.semanticHits + s.misses).toBe(3);
  });
});
