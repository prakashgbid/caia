import { describe, expect, it } from 'vitest';

import { __TEST_ONLY, createOllamaClient } from '../src/ollama-client.js';

describe('parseSemver / meetsAdapterVersion', () => {
  it('parses valid semver', () => {
    expect(__TEST_ONLY.parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(__TEST_ONLY.parseSemver('0.4.0-beta')).toEqual({ major: 0, minor: 4, patch: 0 });
    expect(__TEST_ONLY.parseSemver('not-a-version')).toBeNull();
  });

  it('approves ≥ 0.4.x', () => {
    expect(__TEST_ONLY.meetsAdapterVersion('0.4.0')).toBe(true);
    expect(__TEST_ONLY.meetsAdapterVersion('0.5.1')).toBe(true);
    expect(__TEST_ONLY.meetsAdapterVersion('1.0.0')).toBe(true);
    expect(__TEST_ONLY.meetsAdapterVersion('0.3.9')).toBe(false);
    expect(__TEST_ONLY.meetsAdapterVersion('garbage')).toBe(false);
  });
});

function fakeFetch(scenarios: Map<string, { ok: boolean; status?: number; body?: unknown }>): typeof fetch {
  return (async (url: string | URL | Request, _init?: RequestInit) => {
    const u = typeof url === 'string' ? url : (url as URL).toString();
    const s = scenarios.get(u);
    if (!s) throw new Error(`unmocked url: ${u}`);
    const status = s.status ?? 200;
    return new Response(s.body !== undefined ? JSON.stringify(s.body) : '', { status });
  }) as typeof fetch;
}

describe('createOllamaClient', () => {
  it('ping resolves on 200, throws on non-OK', async () => {
    const ok = createOllamaClient({
      baseUrl: 'http://x',
      fetchImpl: fakeFetch(new Map([['http://x/api/tags', { ok: true, status: 200, body: { models: [] } }]]))
    });
    await expect(ok.ping()).resolves.toBeUndefined();
    const bad = createOllamaClient({
      baseUrl: 'http://x',
      fetchImpl: fakeFetch(new Map([['http://x/api/tags', { ok: false, status: 500 }]]))
    });
    await expect(bad.ping()).rejects.toThrow(/HTTP 500/);
  });

  it('supportsAdapters returns true on ≥ 0.4', async () => {
    const c = createOllamaClient({
      baseUrl: 'http://x',
      fetchImpl: fakeFetch(new Map([['http://x/api/version', { ok: true, body: { version: '0.5.1' } }]]))
    });
    expect(await c.supportsAdapters()).toBe(true);
  });

  it('supportsAdapters returns false on < 0.4', async () => {
    const c = createOllamaClient({
      baseUrl: 'http://x',
      fetchImpl: fakeFetch(new Map([['http://x/api/version', { ok: true, body: { version: '0.3.9' } }]]))
    });
    expect(await c.supportsAdapters()).toBe(false);
  });

  it('supportsAdapters returns false on error', async () => {
    const c = createOllamaClient({
      baseUrl: 'http://x',
      fetchImpl: fakeFetch(new Map([['http://x/api/version', { ok: false, status: 404 }]]))
    });
    expect(await c.supportsAdapters()).toBe(false);
  });

  it('generate posts the correct body and includes adapter when given', async () => {
    let capturedBody: string | undefined;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : (url as URL).toString();
      if (u !== 'http://x/api/generate') throw new Error(`unmocked: ${u}`);
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ response: 'pong' }), { status: 200 });
    }) as typeof fetch;
    const c = createOllamaClient({ baseUrl: 'http://x', fetchImpl });
    const r = await c.generate({
      model: 'm',
      prompt: 'hi',
      adapter: '/path/to/adapter',
      seed: 42,
      temperature: 0
    });
    expect(r.output).toBe('pong');
    expect(r.provider).toBe('ollama');
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.model).toBe('m');
    expect(parsed.adapter).toBe('/path/to/adapter');
    expect(parsed.options.seed).toBe(42);
  });

  it('generate throws on non-OK', async () => {
    const c = createOllamaClient({
      baseUrl: 'http://x',
      fetchImpl: fakeFetch(new Map([['http://x/api/generate', { ok: false, status: 503 }]]))
    });
    await expect(c.generate({ model: 'm', prompt: 'p' })).rejects.toThrow(/HTTP 503/);
  });
});
