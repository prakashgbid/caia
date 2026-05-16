// RR-3 (2026-05-15) — cold-start timeout fix.
//
// Pins the contract for POST /admin/warmup + GET /admin/warmup/status, and
// the behaviour of the per-model is_warm flag on OllamaAdapter that lets
// the inference path apply a longer first-request timeout for cold loads.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../src/server.js';
import { OllamaAdapter } from '../src/ollama-adapter.js';

const ORIGINAL_FETCH = globalThis.fetch;

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Stub global fetch so the adapter never touches a real Ollama. The
 * `responses` table maps URL path → handler returning the JSON body. A
 * handler may delay (return a Promise) to simulate a slow cold-load.
 */
function stubFetch(
  responses: Record<string, () => unknown | Promise<unknown>>,
  captured: CapturedCall[],
): typeof globalThis.fetch {
  return vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    captured.push({ url, body });
    const path = new URL(url).pathname;
    const handler = responses[path];
    if (!handler) {
      return new Response('not-mocked', { status: 500 });
    }
    const data = await handler();
    return {
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
    } as Response;
  }) as unknown as typeof globalThis.fetch;
}

describe('RR-3 OllamaAdapter — per-model warm state', () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('starts cold: isWarm(model) is false until first successful request', async () => {
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    expect(adapter.isWarm('qwen2.5-coder:7b')).toBe(false);
    expect(adapter.warmModelList()).toEqual([]);
  });

  it('warmup() POSTs /api/generate with empty prompt + keep_alive and marks the model warm', async () => {
    const captured: CapturedCall[] = [];
    globalThis.fetch = stubFetch(
      {
        '/api/generate': () => ({
          model: 'qwen2.5-coder:7b',
          response: '',
          done: true,
        }),
      },
      captured,
    );

    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    const r = await adapter.warmup('qwen2.5-coder:7b');

    expect(r.model).toBe('qwen2.5-coder:7b');
    expect(typeof r.durationMs).toBe('number');
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe('http://localhost:11434/api/generate');
    // Warmup uses empty prompt so Ollama just loads the model — no output.
    expect(captured[0]!.body['prompt']).toBe('');
    expect(captured[0]!.body['keep_alive']).toBeDefined();
    expect(adapter.isWarm('qwen2.5-coder:7b')).toBe(true);
    expect(adapter.warmModelList()).toEqual(['qwen2.5-coder:7b']);
  });

  it('a successful generate() marks the model warm so the next call skips the cold-load grace', async () => {
    const captured: CapturedCall[] = [];
    let timeoutsSeen: number[] = [];
    // Spy on AbortSignal.timeout so we can verify the cold-vs-warm choice.
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      timeoutsSeen.push(ms);
      return realTimeout(ms);
    });
    globalThis.fetch = stubFetch(
      {
        '/api/generate': () => ({
          model: 'qwen2.5-coder:7b',
          response: 'ok',
          done: true,
          prompt_eval_count: 1,
          eval_count: 1,
        }),
      },
      captured,
    );

    const adapter = new OllamaAdapter({
      baseUrl: 'http://localhost:11434',
      firstRequestTimeoutMs: 60_000,
      requestTimeoutMs: 7_000,
    });

    // First request — model is cold → 60s timeout.
    await adapter.generate('qwen2.5-coder:7b', {
      taskType: 'commit-message',
      prompt: 'first',
    });
    expect(adapter.isWarm('qwen2.5-coder:7b')).toBe(true);

    // Second request — model is warm → 7s timeout.
    timeoutsSeen = [];
    await adapter.generate('qwen2.5-coder:7b', {
      taskType: 'commit-message',
      prompt: 'second',
    });

    // The most recent timeout passed to AbortSignal.timeout was the WARM
    // budget. The cold-budget was used on the first call.
    expect(timeoutsSeen).toContain(7_000);
    expect(timeoutsSeen).not.toContain(60_000);
  });

  it('cold-request uses firstRequestTimeoutMs, not requestTimeoutMs', async () => {
    const timeouts: number[] = [];
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      timeouts.push(ms);
      return realTimeout(ms);
    });
    globalThis.fetch = stubFetch(
      {
        '/api/generate': () => ({
          model: 'qwen2.5-coder:7b',
          response: 'ok',
          done: true,
        }),
      },
      [],
    );

    const adapter = new OllamaAdapter({
      baseUrl: 'http://localhost:11434',
      firstRequestTimeoutMs: 60_000,
      requestTimeoutMs: 5_000,
    });

    await adapter.generate('qwen2.5-coder:7b', {
      taskType: 'commit-message',
      prompt: 'first',
    });

    expect(timeouts).toContain(60_000);
  });

  it('a failed request does NOT mark the model warm (next call still gets the cold-load grace)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as Response);

    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    await expect(
      adapter.generate('qwen2.5-coder:7b', {
        taskType: 'commit-message',
        prompt: 'first',
      }),
    ).rejects.toThrow(/Ollama API error 500/);
    expect(adapter.isWarm('qwen2.5-coder:7b')).toBe(false);
  });

  it('warm-state is per-model — warming model A does not warm model B', async () => {
    globalThis.fetch = stubFetch(
      {
        '/api/generate': () => ({ model: 'qwen2.5-coder:7b', response: 'ok', done: true }),
      },
      [],
    );
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    await adapter.warmup('qwen2.5-coder:7b');
    expect(adapter.isWarm('qwen2.5-coder:7b')).toBe(true);
    expect(adapter.isWarm('qwen2.5-coder:14b')).toBe(false);
  });

  it('markWarm(model, false) clears the warm flag', async () => {
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    adapter.markWarm('qwen2.5-coder:7b');
    expect(adapter.isWarm('qwen2.5-coder:7b')).toBe(true);
    adapter.markWarm('qwen2.5-coder:7b', false);
    expect(adapter.isWarm('qwen2.5-coder:7b')).toBe(false);
  });
});

describe('RR-3 server — POST /admin/warmup', () => {
  beforeEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('warms a single model and returns ok=true with the warm model in the snapshot', async () => {
    const captured: CapturedCall[] = [];
    globalThis.fetch = stubFetch(
      {
        '/api/generate': () => ({
          model: 'qwen2.5-coder:7b',
          response: '',
          done: true,
        }),
      },
      captured,
    );
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    const app = buildApp({ ollamaAdapter: adapter });

    const res = await app.request('/admin/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen2.5-coder:7b' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      results: Array<{ model: string; ok: boolean; duration_ms?: number; error?: string }>;
      warm_models: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.model).toBe('qwen2.5-coder:7b');
    expect(body.results[0]!.ok).toBe(true);
    expect(body.warm_models).toContain('qwen2.5-coder:7b');
  });

  it('warms multiple models in one call and dedupes the list', async () => {
    const captured: CapturedCall[] = [];
    globalThis.fetch = stubFetch(
      {
        '/api/generate': () => ({ model: 'x', response: '', done: true }),
      },
      captured,
    );
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    const app = buildApp({ ollamaAdapter: adapter });

    const res = await app.request('/admin/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: ['qwen2.5-coder:7b', 'qwen3:14b', 'qwen2.5-coder:7b'],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      results: Array<{ model: string; ok: boolean }>;
      warm_models: string[];
    };
    expect(body.results.map(r => r.model)).toEqual(['qwen2.5-coder:7b', 'qwen3:14b']);
    expect(body.ok).toBe(true);
    expect(body.warm_models).toEqual(expect.arrayContaining(['qwen2.5-coder:7b', 'qwen3:14b']));
  });

  it('returns 400 when neither model nor models is provided', async () => {
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    const app = buildApp({ ollamaAdapter: adapter });
    const res = await app.request('/admin/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('model-required');
  });

  it('returns 400 on invalid JSON', async () => {
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    const app = buildApp({ ollamaAdapter: adapter });
    const res = await app.request('/admin/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 502 when every requested warmup fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as Response);
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    const app = buildApp({ ollamaAdapter: adapter });
    const res = await app.request('/admin/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen2.5-coder:7b' }),
    });
    expect(res.status).toBe(502);
    const body = await res.json() as {
      ok: boolean;
      results: Array<{ ok: boolean; error?: string }>;
    };
    expect(body.ok).toBe(false);
    expect(body.results[0]!.ok).toBe(false);
    expect(body.results[0]!.error).toBeDefined();
  });

  it('GET /admin/warmup/status reports the adapter warm-model snapshot', async () => {
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    adapter.markWarm('qwen2.5-coder:7b');
    adapter.markWarm('qwen3:14b');
    const app = buildApp({
      ollamaBaseUrl: 'http://localhost:11434',
      ollamaAdapter: adapter,
    });
    const res = await app.request('/admin/warmup/status', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as { warm_models: string[]; ollama_base_url: string };
    expect(body.warm_models).toEqual(expect.arrayContaining(['qwen2.5-coder:7b', 'qwen3:14b']));
    expect(body.ollama_base_url).toBe('http://localhost:11434');
  });
});
