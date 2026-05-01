import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PromptCache } from '../src/cache.js';
import { withCache, type ResolveEvent } from '../src/wrap.js';
import type { CachedResponse } from '../src/types.js';

let cache: PromptCache;

const RESPONSE_A: CachedResponse = {
  response: 'auth',
  model: 'qwen2.5-coder:7b',
  provider: 'local',
  durationMs: 180,
};

const RESPONSE_B: CachedResponse = {
  response: 'ui',
  model: 'qwen2.5-coder:7b',
  provider: 'local',
  durationMs: 200,
};

afterEach(async () => {
  await cache.close();
});

describe('withCache', () => {
  beforeEach(() => {
    cache = new PromptCache({ dbPath: ':memory:' });
  });

  it('calls the inner route on first invocation (miss) and caches the response', async () => {
    let calls = 0;
    const inner = async (
      _task: string,
      _prompt: string,
    ): Promise<CachedResponse> => {
      calls++;
      return RESPONSE_A;
    };
    const wrapped = withCache(cache, inner, () => 'qwen2.5-coder:7b');

    const first = await wrapped('domain-classification', 'user signs in');
    const second = await wrapped('domain-classification', 'user signs in');

    expect(first.response).toBe('auth');
    expect(second.response).toBe('auth');
    expect(calls).toBe(1);
  });

  it('separates entries by taskType', async () => {
    let calls = 0;
    const inner = async (
      task: string,
      _prompt: string,
    ): Promise<CachedResponse> => {
      calls++;
      return task === 'domain-classification' ? RESPONSE_A : RESPONSE_B;
    };
    const wrapped = withCache(cache, inner, () => 'qwen2.5-coder:7b');

    await wrapped('domain-classification', 'shared prompt');
    await wrapped('nature-classification', 'shared prompt');
    await wrapped('domain-classification', 'shared prompt');
    await wrapped('nature-classification', 'shared prompt');

    expect(calls).toBe(2);
  });

  it('emits resolve events for hits and misses', async () => {
    const inner = async (): Promise<CachedResponse> => RESPONSE_A;
    const events: ResolveEvent[] = [];
    const wrapped = withCache(
      cache,
      inner,
      () => 'qwen2.5-coder:7b',
      { onResolve: (e) => events.push(e) },
    );

    await wrapped('classify', 'hello');
    await wrapped('classify', 'hello');

    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe('miss');
    expect(events[1]!.kind).toBe('hit');
    if (events[1]!.kind === 'hit') {
      expect(events[1]!.hitKind).toBe('exact');
      expect(events[1]!.taskType).toBe('classify');
    }
  });

  it('respects the modelByTaskType resolver when seeding the cache key', async () => {
    let calls = 0;
    const inner = async (): Promise<CachedResponse> => {
      calls++;
      return { ...RESPONSE_A, model: 'qwen2.5-coder:7b' };
    };
    const modelByTask = (task: string): string =>
      task === 'reasoning' ? 'phi4' : 'qwen2.5-coder:7b';
    const wrapped = withCache(cache, inner, modelByTask);

    await wrapped('classify', 'hi');
    await wrapped('reasoning', 'hi');
    // Different model in the key -> different cache slot, so this misses
    expect(calls).toBe(2);
  });
});
