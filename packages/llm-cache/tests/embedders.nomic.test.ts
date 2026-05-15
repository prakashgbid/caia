import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createNomicEmbedder,
  NomicEmbedError,
} from '../src/embedders/nomic.js';

const FETCH_KEY = 'fetch';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(FETCH_KEY, vi.fn(async (url: string | URL, init?: RequestInit) => {
    return handler(String(url), init ?? {});
  }));
}

describe('createNomicEmbedder', () => {
  it('POSTs to /api/embeddings with the right model + prompt', async () => {
    let captured: { url?: string; body?: unknown } = {};
    stubFetch(async (url, init) => {
      captured = {
        url,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      return new Response(
        JSON.stringify({ embedding: [0.1, 0.2, 0.3] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const embed = createNomicEmbedder({ baseUrl: 'http://test:1234' });
    const v = await embed('hello world');

    expect(captured.url).toBe('http://test:1234/api/embeddings');
    expect(captured.body).toEqual({ model: 'nomic-embed-text', prompt: 'hello world' });
    expect(v).toBeInstanceOf(Float32Array);
    expect(Array.from(v)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3),
    ]);
  });

  it('respects model + baseUrl + timeoutMs overrides', async () => {
    let captured: { url?: string; body?: unknown } = {};
    stubFetch(async (url, init) => {
      captured = {
        url,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      return new Response(JSON.stringify({ embedding: [1] }), { status: 200 });
    });
    const embed = createNomicEmbedder({
      baseUrl: 'http://other:9999',
      model: 'mxbai-embed-large',
      timeoutMs: 1_000,
    });
    await embed('foo');
    expect(captured.url).toBe('http://other:9999/api/embeddings');
    expect((captured.body as { model: string }).model).toBe('mxbai-embed-large');
  });

  it('throws NomicEmbedError on non-2xx response', async () => {
    stubFetch(async () => new Response('upstream down', { status: 503 }));
    const embed = createNomicEmbedder({ baseUrl: 'http://test:1' });
    await expect(embed('x')).rejects.toBeInstanceOf(NomicEmbedError);
    await expect(embed('x')).rejects.toMatchObject({ status: 503 });
  });

  it('throws NomicEmbedError when ollama returns an empty vector', async () => {
    stubFetch(async () => new Response(JSON.stringify({ embedding: [] }), { status: 200 }));
    const embed = createNomicEmbedder({ baseUrl: 'http://test:1' });
    await expect(embed('x')).rejects.toBeInstanceOf(NomicEmbedError);
  });

  it('throws NomicEmbedError when response is missing embedding field', async () => {
    stubFetch(async () => new Response(JSON.stringify({}), { status: 200 }));
    const embed = createNomicEmbedder({ baseUrl: 'http://test:1' });
    await expect(embed('x')).rejects.toBeInstanceOf(NomicEmbedError);
  });
});
