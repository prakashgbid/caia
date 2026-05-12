import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STAGE2_TIMEOUT_MS, stage2Summarize } from '../src/stage2.js';

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

describe('stage2 — STAGE2_TIMEOUT_MS env override', () => {
  const originalEnv = process.env.STAGE2_TIMEOUT_MS;
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.STAGE2_TIMEOUT_MS;
    else process.env.STAGE2_TIMEOUT_MS = originalEnv;
    vi.resetModules();
  });

  it('defaults to 60000 ms when env var is unset', async () => {
    delete process.env.STAGE2_TIMEOUT_MS;
    const mod = await import('../src/stage2.js?default-timeout');
    expect(mod.STAGE2_TIMEOUT_MS).toBe(60000);
  });

  it('reads STAGE2_TIMEOUT_MS from process.env', async () => {
    process.env.STAGE2_TIMEOUT_MS = '17500';
    const mod = await import('../src/stage2.js?override-timeout');
    expect(mod.STAGE2_TIMEOUT_MS).toBe(17500);
  });

  it('exports the module-level default at the configured value', () => {
    // Sanity: the constant imported at top-of-file (60_000 default) is exported.
    expect(typeof STAGE2_TIMEOUT_MS).toBe('number');
    expect(STAGE2_TIMEOUT_MS).toBeGreaterThanOrEqual(60000);
  });

  it('uses the env-derived timeout as the default for stage2Summarize', async () => {
    // Set a small env timeout, re-import, and verify a slow fetch aborts in <100ms.
    process.env.STAGE2_TIMEOUT_MS = '50';
    const mod = await import('../src/stage2.js?short-timeout');
    expect(mod.STAGE2_TIMEOUT_MS).toBe(50);

    const longContent = 'verbose '.repeat(300);
    let abortedAt = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        const start = Date.now();
        signal.addEventListener('abort', () => {
          abortedAt = Date.now() - start;
          reject(new Error('aborted'));
        });
      });
    }) as unknown as typeof fetch;

    const result = await mod.stage2Summarize(
      [{ id: 'env-timeout', content: longContent }],
      { fetchImpl, minTokensToCompress: 100 },
    );
    expect(result.blobs[0].compressed).toBe(false);
    expect(abortedAt).toBeGreaterThan(0);
    expect(abortedAt).toBeLessThan(500);
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
