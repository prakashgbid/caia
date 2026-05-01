import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryBackend } from '../src/backends/memory.js';
import { PromptCache } from '../src/cache.js';
import type { CachedResponse } from '../src/types.js';

const RESPONSE: CachedResponse = {
  response: 'auth',
  model: 'qwen2.5-coder:7b',
  provider: 'local',
  durationMs: 200,
};

describe('InMemoryBackend', () => {
  let backend: InMemoryBackend;

  beforeEach(() => {
    backend = new InMemoryBackend();
  });

  it('stores and retrieves exact entries', async () => {
    await backend.putExact('h1', 'ns', 'm', RESPONSE, 1000);
    const got = await backend.getExactByHash('h1');
    expect(got?.value).toEqual(RESPONSE);
    expect(got?.createdAt).toBe(1000);
  });

  it('returns undefined for missing exact hash', async () => {
    expect(await backend.getExactByHash('missing')).toBeUndefined();
  });

  it('overwrites on duplicate hash', async () => {
    await backend.putExact('h1', 'ns', 'm', RESPONSE, 1000);
    const updated: CachedResponse = { ...RESPONSE, response: 'ui' };
    await backend.putExact('h1', 'ns', 'm', updated, 2000);
    const got = await backend.getExactByHash('h1');
    expect(got?.value.response).toBe('ui');
    const counts = await backend.countAll();
    expect(counts.exact).toBe(1);
  });

  it('stores and retrieves semantic rows newest-first', async () => {
    const e1 = Float32Array.from([1, 0]);
    const e2 = Float32Array.from([0, 1]);
    await backend.putSemantic('ns', 'm', 'p1', e1, RESPONSE, 1000);
    await backend.putSemantic('ns', 'm', 'p2', e2, RESPONSE, 2000);

    const rows = await backend.listSemanticRows('ns', 'm', 10);
    expect(rows[0]!.prompt).toBe('p2');
    expect(rows[1]!.prompt).toBe('p1');
  });

  it('namespaces semantic rows by (namespace, model)', async () => {
    const e = Float32Array.from([1]);
    await backend.putSemantic('task-a', 'm', 'p', e, RESPONSE, 1);
    await backend.putSemantic('task-b', 'm', 'p', e, RESPONSE, 1);

    expect(await backend.listSemanticRows('task-a', 'm', 10)).toHaveLength(1);
    expect(await backend.listSemanticRows('task-b', 'm', 10)).toHaveLength(1);
  });

  it('evicts entries older than cutoff', async () => {
    await backend.putExact('h1', 'ns', 'm', RESPONSE, 1000);
    await backend.putExact('h2', 'ns', 'm', RESPONSE, 5000);
    const e = Float32Array.from([1]);
    await backend.putSemantic('ns', 'm', 'old', e, RESPONSE, 1000);
    await backend.putSemantic('ns', 'm', 'new', e, RESPONSE, 5000);

    const removed = await backend.evictOlderThan(3000);
    expect(removed.exact).toBe(1);
    expect(removed.semantic).toBe(1);

    const counts = await backend.countAll();
    expect(counts.exact).toBe(1);
    expect(counts.semantic).toBe(1);
  });

  it('works as a PromptCache backend', async () => {
    const cache = new PromptCache({ backend });
    await cache.put({ namespace: 'ns', model: 'm', prompt: 'hello' }, RESPONSE);
    const hit = await cache.lookup({ namespace: 'ns', model: 'm', prompt: 'hello' });
    expect(hit?.kind).toBe('exact');
    expect(hit?.value).toEqual(RESPONSE);
    await cache.close();
  });
});
