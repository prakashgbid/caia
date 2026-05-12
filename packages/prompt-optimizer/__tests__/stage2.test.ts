import { describe, expect, it, vi } from 'vitest';

import { stage2Summarize } from '../src/stage2.js';

function makeFakeFetch(opts: {
  status?: number;
  body?: unknown;
  delayMs?: number;
  throwError?: Error;
}): typeof fetch {
  return vi.fn(async () => {
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.throwError) throw opts.throwError;
    return new Response(JSON.stringify(opts.body ?? {}), {
      status: opts.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('stage2 — short blob pass-through', () => {
  it('does not call the router when blob is below minTokensToCompress', async () => {
    const fetchImpl = vi.fn();
    const result = await stage2Summarize([{ id: 'a', content: 'short' }], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minTokensToCompress: 200,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.blobs[0].compressed).toBe(false);
    expect(result.blobs[0].content).toBe('short');
  });
});

describe('stage2 — router success path', () => {
  it('replaces blob content with router-compressed text', async () => {
    const longContent = 'verbose '.repeat(300); // ~600 tokens
    const compressed = 'concise summary';
    const fetchImpl = makeFakeFetch({
      body: { choices: [{ message: { content: compressed } }] },
    });

    const result = await stage2Summarize([{ id: 'b', content: longContent }], {
      fetchImpl,
      minTokensToCompress: 100,
    });

    expect(result.blobs[0].compressed).toBe(true);
    expect(result.blobs[0].content).toBe(compressed);
    expect(result.blobs[0].tokensOut).toBeLessThan(result.blobs[0].tokensIn);
  });

  it('sends the correct OpenAI-shape body to the router', async () => {
    const longContent = 'word '.repeat(200);
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'short' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    await stage2Summarize([{ id: 'c', content: longContent }], {
      fetchImpl,
      minTokensToCompress: 50,
      routerBaseUrl: 'http://test:7411',
    });

    expect(calls[0].url).toBe('http://test:7411/v1/chat/completions');
    const body = calls[0].body as Record<string, unknown>;
    expect(body.model).toBe('qwen2.5-coder:7b');
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.x_router).toMatchObject({ origin: 'prompt-optimizer-stage2' });
  });
});

describe('stage2 — failure modes degrade gracefully', () => {
  it('falls back to original content on router 5xx', async () => {
    const longContent = 'verbose '.repeat(300);
    const fetchImpl = makeFakeFetch({ status: 503 });
    const result = await stage2Summarize([{ id: 'd', content: longContent }], {
      fetchImpl,
      minTokensToCompress: 100,
    });
    expect(result.blobs[0].compressed).toBe(false);
    expect(result.blobs[0].content).toBe(longContent);
    expect(result.blobs[0].error).toContain('router-status-503');
  });

  it('falls back to original content on network error', async () => {
    const longContent = 'verbose '.repeat(300);
    const fetchImpl = makeFakeFetch({ throwError: new Error('ECONNREFUSED') });
    const result = await stage2Summarize([{ id: 'e', content: longContent }], {
      fetchImpl,
      minTokensToCompress: 100,
    });
    expect(result.blobs[0].compressed).toBe(false);
    expect(result.blobs[0].error).toContain('ECONNREFUSED');
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('ignores router output that expanded the blob beyond 120% of input', async () => {
    const longContent = 'short blob '.repeat(20); // ~40 tokens... bump up:
    const longerContent = 'word '.repeat(300);
    const expanded = longerContent + ' ' + longerContent + ' ' + longerContent;
    const fetchImpl = makeFakeFetch({
      body: { choices: [{ message: { content: expanded } }] },
    });
    const result = await stage2Summarize([{ id: 'f', content: longerContent }], {
      fetchImpl,
      minTokensToCompress: 100,
    });
    expect(result.blobs[0].compressed).toBe(false);
    expect(result.blobs[0].error).toBe('router-expansion-ignored');
    // Touch the var so linters don't complain about unused.
    expect(longContent.length).toBeGreaterThan(0);
  });

  it('treats empty router response as failure', async () => {
    const longContent = 'word '.repeat(300);
    const fetchImpl = makeFakeFetch({
      body: { choices: [{ message: { content: '' } }] },
    });
    const result = await stage2Summarize([{ id: 'g', content: longContent }], {
      fetchImpl,
      minTokensToCompress: 100,
    });
    expect(result.blobs[0].compressed).toBe(false);
    expect(result.blobs[0].error).toContain('router-empty-response');
  });
});

describe('stage2 — multi-blob batch', () => {
  it('handles a mix of compressible and pass-through blobs', async () => {
    const fetchImpl = makeFakeFetch({
      body: { choices: [{ message: { content: 'tiny' } }] },
    });
    const result = await stage2Summarize(
      [
        { id: 'short', content: 'hi' },
        { id: 'long', content: 'verbose '.repeat(300) },
      ],
      { fetchImpl, minTokensToCompress: 100 },
    );
    expect(result.blobs).toHaveLength(2);
    expect(result.blobs[0].compressed).toBe(false);
    expect(result.blobs[1].compressed).toBe(true);
    expect(result.blobs[1].content).toBe('tiny');
  });
});
