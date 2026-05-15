import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/server.js';

describe('A.9.12 — /v1/search-memory endpoint', () => {
  it('rejects missing query with 400 error', async () => {
    const app = buildApp();
    const res = await app.request('/v1/search-memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k: 5 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('query-required');
  });

  it('rejects empty query with 400 error', async () => {
    const app = buildApp();
    const res = await app.request('/v1/search-memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON body with 400 error', async () => {
    const app = buildApp();
    const res = await app.request('/v1/search-memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid-json');
  });

  it('returns 200 + hits/warnings shape when ollama is unreachable (graceful failure)', async () => {
    // The handler does not require a reachable ollama daemon at the
    // endpoint level — the embedder is constructed but if it throws
    // (e.g., 127.0.0.1:11434 closed in CI), the librarian/mentor
    // helpers warn-and-return-empty. Either way the response is 200.
    const app = buildApp({ ollamaBaseUrl: 'http://127.0.0.1:1' /* closed */ });
    const res = await app.request('/v1/search-memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test query', k: 3, source: 'both' }),
    });
    // Either a 200 with empty hits + warnings, OR a 502 with the same
    // shape are acceptable — the contract is "no crash, structured
    // response".
    expect([200, 502]).toContain(res.status);
    const body = (await res.json()) as {
      query?: string;
      hits?: unknown[];
      warnings?: string[];
      error?: string;
    };
    if (res.status === 200) {
      expect(body.query).toBe('test query');
      expect(Array.isArray(body.hits)).toBe(true);
      expect(Array.isArray(body.warnings)).toBe(true);
    } else {
      expect(body.error).toBe('search-memory-failed');
    }
  });

  it('clamps k to the [1, 50] range', async () => {
    const app = buildApp({ ollamaBaseUrl: 'http://127.0.0.1:1' });
    // k=1000 should be clamped to 50 internally; the response shape
    // must still come back successfully (or as a 502 with the error
    // envelope — both are acceptable for the no-ollama case).
    const res = await app.request('/v1/search-memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'x', k: 1000 }),
    });
    expect([200, 502]).toContain(res.status);
    const body = (await res.json()) as { k?: number };
    if (res.status === 200) {
      expect(body.k).toBeLessThanOrEqual(50);
    }
  });
});
