// RR-3 (2026-05-16) — /admin/warmup endpoint tests.
//
// Mounts the Hono app via buildApp() and exercises the endpoint against the
// router-singleton OllamaAdapter (wired via __setAdapters). We don't talk to
// a real Ollama; the adapter's fetch is mocked.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../src/server.js';
import { __setAdapters } from '../src/router.js';
import { OllamaAdapter } from '../src/ollama-adapter.js';
import type { ClaudeAdapter } from '../src/claude-adapter.js';

const ORIGINAL_FETCH = globalThis.fetch;

function fakeClaude(): ClaudeAdapter {
  return {
    generate: vi.fn(),
  } as unknown as ClaudeAdapter;
}

describe('/admin/warmup', () => {
  beforeEach(() => {
    __setAdapters(null, null);
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    __setAdapters(null, null);
    vi.restoreAllMocks();
  });

  it('with no body, returns the currently-warm set without calling ollama', async () => {
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    __setAdapters(adapter, fakeClaude());

    globalThis.fetch = vi.fn(async () => {
      throw new Error('should not call ollama for no-op warmup');
    }) as unknown as typeof globalThis.fetch;

    const app = buildApp();
    const res = await app.request('/admin/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      warmed?: string[];
      currently_warm?: string[];
    };
    expect(body.warmed).toEqual([]);
    expect(body.currently_warm).toEqual([]);
  });

  it('warms each requested model and reports per-model status', async () => {
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    __setAdapters(adapter, fakeClaude());

    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({ model: 'mock', response: '', done: true }),
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    const app = buildApp();
    const res = await app.request('/admin/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: ['qwen2.5-coder:7b', 'qwen2.5-coder:14b'],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ model: string; status: string }>;
      currently_warm: string[];
    };
    expect(body.results).toHaveLength(2);
    expect(body.results.map(r => r.status)).toEqual(['warmed', 'warmed']);
    expect(body.currently_warm).toContain('qwen2.5-coder:7b');
    expect(body.currently_warm).toContain('qwen2.5-coder:14b');
  });

  it('reports already_warm for models that are already warm', async () => {
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    __setAdapters(adapter, fakeClaude());

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ model: 'mock', response: '', done: true }),
    } as Response)) as unknown as typeof globalThis.fetch;

    // Pre-warm one of the models.
    await adapter.warmup('qwen2.5-coder:7b');
    const fetchCallsAfterPrewarm = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    const app = buildApp();
    const res = await app.request('/admin/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: ['qwen2.5-coder:7b', 'qwen2.5-coder:14b'],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ model: string; status: string }>;
    };
    const byModel = Object.fromEntries(body.results.map(r => [r.model, r.status]));
    expect(byModel['qwen2.5-coder:7b']).toBe('already_warm');
    expect(byModel['qwen2.5-coder:14b']).toBe('warmed');

    // Only ONE additional fetch should have happened (for qwen2.5-coder:14b).
    const fetchCallsAfter = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchCallsAfter - fetchCallsAfterPrewarm).toBe(1);
  });

  it('supports the single-model convenience form (body.model)', async () => {
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    __setAdapters(adapter, fakeClaude());

    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ model: 'mock', response: '', done: true }),
    } as Response)) as unknown as typeof globalThis.fetch;

    const app = buildApp();
    const res = await app.request('/admin/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'qwen2.5-coder:32b' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ model: string; status: string }>;
    };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.model).toBe('qwen2.5-coder:32b');
    expect(body.results[0]!.status).toBe('warmed');
  });

  it('returns error status per model on Ollama failure, without 500-ing the request', async () => {
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    __setAdapters(adapter, fakeClaude());

    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({ model: 'mock', response: '', done: true }),
        } as Response;
      }
      return {
        ok: false,
        status: 500,
        text: async () => 'model not found',
      } as Response;
    }) as unknown as typeof globalThis.fetch;

    const app = buildApp();
    const res = await app.request('/admin/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        models: ['qwen2.5-coder:7b', 'does-not-exist:99b'],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: Array<{ model: string; status: string; error?: string }>;
      currently_warm: string[];
    };
    const byModel = Object.fromEntries(body.results.map(r => [r.model, r]));
    expect(byModel['qwen2.5-coder:7b']!.status).toBe('warmed');
    expect(byModel['does-not-exist:99b']!.status).toBe('error');
    expect(byModel['does-not-exist:99b']!.error).toMatch(/Ollama API error 500/);
    // Only the successful model appears in currently_warm.
    expect(body.currently_warm).toContain('qwen2.5-coder:7b');
    expect(body.currently_warm).not.toContain('does-not-exist:99b');
  });

  it('400s on invalid JSON', async () => {
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434' });
    __setAdapters(adapter, fakeClaude());

    const app = buildApp();
    const res = await app.request('/admin/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json {{{',
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('invalid-json');
  });
});
