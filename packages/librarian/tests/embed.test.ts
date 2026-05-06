import { describe, expect, it } from 'vitest';

import {
  blobToVector,
  createOllamaEmbedder,
  DEFAULT_EMBED_MODEL,
  DEFAULT_OLLAMA_URL,
  extractEmbedding,
  vectorToBlob
} from '../src/embed.js';

describe('extractEmbedding', () => {
  it('rejects non-objects', () => {
    expect(() => extractEmbedding(null)).toThrow(/not an object/);
    expect(() => extractEmbedding(42)).toThrow(/not an object/);
  });
  it('rejects missing embedding field', () => {
    expect(() => extractEmbedding({})).toThrow(/missing required `embedding`/);
  });
  it('rejects empty embeddings', () => {
    expect(() => extractEmbedding({ embedding: [] })).toThrow(/empty embedding/);
  });
  it('rejects non-finite values', () => {
    expect(() => extractEmbedding({ embedding: [1, NaN, 3] })).toThrow(/non-finite/);
    expect(() => extractEmbedding({ embedding: [1, 'x', 3] })).toThrow(/non-finite/);
  });
  it('extracts a Float32Array', () => {
    const out = extractEmbedding({ embedding: [1, 2, 3] });
    expect(out).toBeInstanceOf(Float32Array);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
});

describe('vector <-> blob round-trip', () => {
  it('round-trips a 768-dim vector exactly', () => {
    const v = new Float32Array(768);
    for (let i = 0; i < 768; i++) v[i] = (i % 7) * 0.137 - 0.5;
    const blob = vectorToBlob(v);
    expect(blob.length).toBe(768 * 4);
    const back = blobToVector(blob, 768);
    expect(back.length).toBe(768);
    for (let i = 0; i < 768; i++) {
      // Float32 round-trip is exact here because we used Float32 values
      expect(back[i]).toBeCloseTo(v[i] ?? 0, 5);
    }
  });
  it('blobToVector validates dim against blob length', () => {
    const blob = Buffer.alloc(16); // 4 floats
    expect(() => blobToVector(blob, 5)).toThrow(/does not match dim/);
  });
});

describe('createOllamaEmbedder', () => {
  it('returns an embedder bound to defaults', async () => {
    const fakeFetch: typeof fetch = async (url, init) => {
      expect(String(url)).toBe(`${DEFAULT_OLLAMA_URL}/api/embeddings`);
      const body = init?.body;
      expect(typeof body).toBe('string');
      const parsed = JSON.parse(body as string);
      expect(parsed.model).toBe(DEFAULT_EMBED_MODEL);
      expect(parsed.prompt).toBe('hello');
      return new Response(JSON.stringify({ embedding: [0.1, 0.2, 0.3] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    const embedder = createOllamaEmbedder({ fetchImpl: fakeFetch });
    const out = await embedder('hello');
    expect(out.model).toBe(DEFAULT_EMBED_MODEL);
    expect(Array.from(out.vector)).toEqual([
      Math.fround(0.1),
      Math.fround(0.2),
      Math.fround(0.3)
    ]);
  });

  it('passes through ollama URL override', async () => {
    let capturedUrl = '';
    const fakeFetch: typeof fetch = async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ embedding: [1] }), { status: 200 });
    };
    const embedder = createOllamaEmbedder({
      url: 'http://example.org:9999/',
      fetchImpl: fakeFetch
    });
    await embedder('x');
    expect(capturedUrl).toBe('http://example.org:9999/api/embeddings');
  });

  it('throws on non-2xx response with body', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('boom', { status: 500, statusText: 'srv-err' });
    const embedder = createOllamaEmbedder({ fetchImpl: fakeFetch });
    await expect(embedder('x')).rejects.toThrow(/ollama embed http 500/);
  });

  it('wraps fetch errors with cause', async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error('connection refused');
    };
    const embedder = createOllamaEmbedder({ fetchImpl: fakeFetch });
    await expect(embedder('x')).rejects.toThrow(/ollama embed request failed/);
  });

  it('rejects malformed JSON body', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('{not-json', { status: 200 });
    const embedder = createOllamaEmbedder({ fetchImpl: fakeFetch });
    await expect(embedder('x')).rejects.toThrow(/not valid JSON/);
  });
});
