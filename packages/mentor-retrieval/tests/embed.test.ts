/**
 * Tests for the Ollama embedder.
 *
 * Covers:
 *
 *   - `extractEmbedding` shape validation
 *   - `vectorToBlob` / `blobToVector` round-trip
 *   - `createOllamaEmbedder` happy-path with a mocked fetch
 *   - HTTP-error path
 *   - Network/abort error path
 *   - JSON-shape error path
 */

import { describe, expect, it, vi } from 'vitest';

import {
  blobToVector,
  createOllamaEmbedder,
  DEFAULT_EMBED_MODEL,
  DEFAULT_OLLAMA_URL,
  extractEmbedding,
  vectorToBlob
} from '../src/embed.js';

describe('extractEmbedding', () => {
  it('parses a valid response into a Float32Array', () => {
    const v = extractEmbedding({ embedding: [0.1, 0.2, 0.3] });
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(3);
    // Float32 imprecision tolerance.
    expect(Array.from(v).map((x) => Number(x.toFixed(4)))).toEqual([0.1, 0.2, 0.3]);
  });

  it('rejects non-object responses', () => {
    expect(() => extractEmbedding('not an object')).toThrow(/not an object/);
    expect(() => extractEmbedding(null)).toThrow(/not an object/);
    expect(() => extractEmbedding(42)).toThrow(/not an object/);
  });

  it('rejects responses missing the embedding field', () => {
    expect(() => extractEmbedding({})).toThrow(/missing required `embedding`/);
  });

  it('rejects responses with empty embedding', () => {
    expect(() => extractEmbedding({ embedding: [] })).toThrow(/empty embedding/);
  });

  it('rejects responses with non-finite values', () => {
    expect(() => extractEmbedding({ embedding: [1, 'x', 3] })).toThrow(
      /non-finite value at index 1/
    );
    expect(() => extractEmbedding({ embedding: [1, NaN, 3] })).toThrow(
      /non-finite value at index 1/
    );
  });
});

describe('vectorToBlob / blobToVector', () => {
  it('round-trips arbitrary Float32 vectors', () => {
    const v = new Float32Array([0, -1, 1, 0.5, -0.5, 1e-6, 12345.678]);
    const blob = vectorToBlob(v);
    expect(blob.length).toBe(v.length * 4);
    const back = blobToVector(blob, v.length);
    expect(Array.from(back)).toEqual(Array.from(v));
  });

  it('rejects blob with mismatched dim', () => {
    const v = new Float32Array([1, 2, 3]);
    const blob = vectorToBlob(v);
    expect(() => blobToVector(blob, 4)).toThrow(/does not match dim/);
  });
});

describe('createOllamaEmbedder', () => {
  function fakeFetch(
    body: unknown,
    init: { ok?: boolean; status?: number; statusText?: string } = {}
  ): typeof fetch {
    const ok = init.ok ?? true;
    const status = init.status ?? 200;
    const statusText = init.statusText ?? 'OK';
    return vi.fn(async () => ({
      ok,
      status,
      statusText,
      json: async () => body,
      text: async () => JSON.stringify(body)
    }) as unknown as Response);
  }

  it('hits the configured URL with model + prompt and returns the vector', async () => {
    const fetchSpy = vi.fn(async (url: unknown, init: unknown) => {
      expect(url).toBe('http://127.0.0.1:11434/api/embeddings');
      const i = init as { method?: string; body?: string; headers?: Record<string, string> };
      expect(i.method).toBe('POST');
      expect(i.headers?.['Content-Type']).toBe('application/json');
      const parsed = JSON.parse(i.body ?? '{}');
      expect(parsed.model).toBe(DEFAULT_EMBED_MODEL);
      expect(parsed.prompt).toBe('hello world');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ embedding: [0.5, 0.25, 0.125] }),
        text: async () => '...'
      } as unknown as Response;
    });

    const embed = createOllamaEmbedder({ fetchImpl: fetchSpy });
    const result = await embed('hello world');
    expect(result.model).toBe(DEFAULT_EMBED_MODEL);
    expect(result.vector.length).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('honors custom URL + model', async () => {
    const fetchSpy = vi.fn(async (url: unknown) => {
      expect(url).toBe('http://example.test:9999/api/embeddings');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ embedding: [1] }),
        text: async () => ''
      } as unknown as Response;
    });
    const embed = createOllamaEmbedder({
      url: 'http://example.test:9999/',
      model: 'custom-model',
      fetchImpl: fetchSpy
    });
    const r = await embed('text');
    expect(r.model).toBe('custom-model');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('throws on HTTP non-2xx responses', async () => {
    const f = fakeFetch({ error: 'model not found' }, {
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });
    const embed = createOllamaEmbedder({ fetchImpl: f });
    await expect(embed('x')).rejects.toThrow(/ollama embed http 404/);
  });

  it('wraps network errors with cause', async () => {
    const cause = new Error('connection refused');
    const f = vi.fn(async () => {
      throw cause;
    });
    const embed = createOllamaEmbedder({ fetchImpl: f as unknown as typeof fetch });
    let thrown: unknown;
    try {
      await embed('x');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/ollama embed request failed/);
    expect((thrown as Error).cause).toBe(cause);
  });

  it('wraps invalid JSON responses with cause', async () => {
    const cause = new SyntaxError('Unexpected token');
    const f = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => {
        throw cause;
      },
      text: async () => 'not json'
    }) as unknown as Response);
    const embed = createOllamaEmbedder({ fetchImpl: f as unknown as typeof fetch });
    let thrown: unknown;
    try {
      await embed('x');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/not valid JSON/);
    expect((thrown as Error).cause).toBe(cause);
  });

  it('uses defaults when no opts are provided (URL constant is exported)', () => {
    expect(DEFAULT_OLLAMA_URL).toBe('http://127.0.0.1:11434');
    expect(DEFAULT_EMBED_MODEL).toBe('nomic-embed-text');
  });
});
