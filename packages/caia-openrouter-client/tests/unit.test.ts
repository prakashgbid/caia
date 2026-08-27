import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { extractJson, callOpenRouter, envKeyResolver, MissingKeyError, DEFAULT_FREE_TIER_LADDER } from '../src/index.js';

describe('extractJson', () => {
  it('parses whole-text JSON', () => {
    const r = extractJson('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });
  it('parses fenced JSON', () => {
    const r = extractJson('sure!\n```json\n{"b":2}\n```\n');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ b: 2 });
  });
  it('parses first brace-matched substring', () => {
    const r = extractJson('here you go: {"c":3, "nested":{"d":4}} thanks!');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ c: 3, nested: { d: 4 } });
  });
  it('fails on empty', () => {
    expect(extractJson('').ok).toBe(false);
  });
  it('fails on no JSON', () => {
    expect(extractJson('just prose').ok).toBe(false);
  });
});

describe('envKeyResolver', () => {
  const origKey = process.env.OPENROUTER_API_KEY;
  afterEach(() => {
    if (origKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = origKey;
  });
  it('returns the env var when set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-test-abc';
    expect(envKeyResolver(null)).toBe('sk-test-abc');
  });
  it('throws MissingKeyError when unset', () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => envKeyResolver(null)).toThrow(MissingKeyError);
  });
});

describe('callOpenRouter (mocked fetch)', () => {
  const origKey = process.env.OPENROUTER_API_KEY;
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'sk-fake';
  });
  afterEach(() => {
    if (origKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = origKey;
    globalThis.fetch = origFetch;
    vi.restoreAllMocks();
  });

  it('returns ok:true with text + model + usage on 200', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'gen-abc',
          model: 'test/model:free',
          choices: [{ message: { content: 'BLUE' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6, cost: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    const r = await callOpenRouter({ purpose: 'test.hello', userPrompt: 'say BLUE', model: 'test/model:free' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toBe('BLUE');
      expect(r.model).toBe('test/model:free');
      expect(r.costUsd).toBe(0);
      expect(r.usage.totalTokens).toBe(6);
      expect(r.attempts).toBe(1);
    }
  });

  it('sends OpenRouter native models fallback array (single call, up to 3 models)', async () => {
    let sentPayload: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body && typeof init.body === 'string') {
        sentPayload = JSON.parse(init.body) as Record<string, unknown>;
      }
      // OpenRouter picked the second one (as if slot 1 was down)
      return new Response(
        JSON.stringify({
          id: 'gen-2',
          model: DEFAULT_FREE_TIER_LADDER[1],
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const r = await callOpenRouter({ purpose: 'test.orfallback', userPrompt: 'hi', model: 'free' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // With OR native fallback we make exactly ONE outbound call.
      expect(r.attempts).toBe(1);
      // The models array should have been in the payload with up to 3 entries.
      expect(sentPayload).not.toBeNull();
      expect(Array.isArray(sentPayload!.models)).toBe(true);
      const arr = sentPayload!.models as string[];
      expect(arr.length).toBeGreaterThanOrEqual(2);
      expect(arr.length).toBeLessThanOrEqual(3);
      // Last slot should be the paid guarantee (mistral-nemo) since paidFallback defaults to true
      expect(arr[arr.length - 1]).toBe('mistralai/mistral-nemo');
    }
  });

  it('honors stickyModel to keep multi-turn conversations on the same model', async () => {
    let sentPayload: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body && typeof init.body === 'string') {
        sentPayload = JSON.parse(init.body) as Record<string, unknown>;
      }
      return new Response(
        JSON.stringify({
          id: 'gen-s',
          model: 'z-ai/glm-5.2:free',
          choices: [{ message: { content: 'ok' } }],
          usage: { total_tokens: 2 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const r = await callOpenRouter({
      purpose: 'test.sticky',
      userPrompt: 'turn 2',
      model: 'free',
      stickyModel: 'z-ai/glm-5.2:free',
    });
    expect(r.ok).toBe(true);
    expect(sentPayload).not.toBeNull();
    // Sticky model must be slot 1 in the payload
    expect(sentPayload!.model).toBe('z-ai/glm-5.2:free');
    const arr = sentPayload!.models as string[];
    expect(arr[0]).toBe('z-ai/glm-5.2:free');
  });

  it('disables paid fallback when paidFallback=false', async () => {
    let sentPayload: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body && typeof init.body === 'string') {
        sentPayload = JSON.parse(init.body) as Record<string, unknown>;
      }
      return new Response(
        JSON.stringify({
          id: 'gen-nopaid',
          model: DEFAULT_FREE_TIER_LADDER[0],
          choices: [{ message: { content: 'ok' } }],
          usage: { total_tokens: 2 },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const r = await callOpenRouter({
      purpose: 'test.nopaid',
      userPrompt: 'hi',
      model: 'free',
      paidFallback: false,
    });
    expect(r.ok).toBe(true);
    const arr = sentPayload!.models as string[] | undefined;
    // Should NOT contain the paid guarantee
    if (arr) {
      expect(arr.includes('mistralai/mistral-nemo')).toBe(false);
    }
  });

  it('returns ok:false retryable:false on hard error (401)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'invalid key', code: 401 } }), { status: 401 }),
    ) as unknown as typeof fetch;
    const r = await callOpenRouter({ purpose: 'test.auth', userPrompt: 'hi', model: 'test/model' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.retryable).toBe(false);
      expect(r.error).toContain('invalid key');
    }
  });

  it('parses JSON response when responseFormat=json', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'gen-j',
          model: 'x',
          choices: [{ message: { content: '```json\n{"q":"What is your target user?"}\n```' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const r = await callOpenRouter({ purpose: 'test.json', userPrompt: 'ask one', model: 'x', responseFormat: 'json' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.json).toEqual({ q: 'What is your target user?' });
    }
  });

  it('throws on empty userPrompt', async () => {
    await expect(callOpenRouter({ purpose: 'test', userPrompt: '   ' })).rejects.toThrow(/userPrompt/);
  });
});
