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

  it('retries on 429 and eventually succeeds via ladder', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: 'rate limit', code: 429 } }), { status: 429 });
      }
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
    const r = await callOpenRouter({ purpose: 'test.retry', userPrompt: 'hi', model: 'free' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.attempts).toBe(2);
      expect(calls).toBe(2);
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
