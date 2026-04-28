import { describe, it, expect, vi, afterEach } from 'vitest';
import { Embedder } from '../src/embedder.js';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

function mockEmbeddings(embedding: number[]): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ embedding }),
  } as Response);
}

describe('Embedder', () => {
  it('POSTs to /api/embeddings with the configured model', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = vi.fn(async (input, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      calls.push({
        url,
        body:
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {},
      });
      return {
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    const e = new Embedder({
      baseUrl: 'http://localhost:11434',
      model: 'nomic-embed-text',
      keepAlive: '15m',
    });
    const out = await e.embed('hello');

    expect(out).toBeInstanceOf(Float32Array);
    expect(Array.from(out)).toEqual([0.1, 0.2, 0.3].map((x) => Math.fround(x)));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://localhost:11434/api/embeddings');
    expect(calls[0]!.body['model']).toBe('nomic-embed-text');
    expect(calls[0]!.body['prompt']).toBe('hello');
    expect(calls[0]!.body['keep_alive']).toBe('15m');
  });

  it('throws when Ollama returns a non-OK status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as Response);
    const e = new Embedder({ baseUrl: 'http://localhost:11434' });
    await expect(e.embed('x')).rejects.toThrow(/embeddings.*failed.*500/);
  });

  it('throws when the embedding array is empty', async () => {
    mockEmbeddings([]);
    const e = new Embedder({ baseUrl: 'http://localhost:11434' });
    await expect(e.embed('x')).rejects.toThrow(/empty embedding/);
  });

  it('embedBatch reports progress and runs sequentially', async () => {
    mockEmbeddings([0.5, 0.5]);
    const e = new Embedder({ baseUrl: 'http://localhost:11434' });
    const seen: Array<[number, number]> = [];
    const out = await e.embedBatch(['a', 'b', 'c'], (done, total) => {
      seen.push([done, total]);
    });
    expect(out).toHaveLength(3);
    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('exposes the configured model tag', () => {
    const e = new Embedder({ model: 'mxbai-embed-large' });
    expect(e.modelTag).toBe('mxbai-embed-large');
  });
});
