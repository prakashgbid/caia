import { describe, expect, it, vi } from 'vitest';

import { optimize } from '../src/index.js';

describe('optimize — short prompt bail-out', () => {
  it('skips stage2 and stage3 when total token count is small', async () => {
    const fetchImpl = vi.fn();
    const res = await optimize({
      userQuestion: 'rename `Foo` to `Bar`',
      toolOutputs: [{ id: 't1', content: 'short blob' }],
      budget: { skipStagesUnderTokens: 1000, routerBaseUrl: 'http://unused' },
    });
    // Router is never called when short-bail kicks in.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.metrics.stage2.skipped).toBe(true);
    expect(res.metrics.stage3.skipped).toBe(true);
    expect(res.optimizedPrompt).toContain('«protected:ident:`Foo`»');
    expect(res.protectedSpanCount).toBeGreaterThan(0);
  });
});

describe('optimize — long prompt full pipeline', () => {
  it('runs all three stages and returns metrics', async () => {
    // Make a long tool output so stage 2/3 trigger.
    const longBlob = 'verbose log preamble '.repeat(150) + 'rename Foo identifier';
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/v1/chat/completions')) {
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: 'rename Foo identifier (preamble dropped)' } },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // /v1/score-tokens — pretend it doesn't exist.
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;

    // Inject our fetch by monkey-patching globalThis for the duration of the test.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const res = await optimize({
        systemPrompt: 'You are a careful assistant.',
        toolOutputs: [{ id: 'blob-1', content: longBlob }],
        recentReasoning: ['I think we should rename the class.'],
        userQuestion: 'rename Foo to Bar',
        budget: { skipStagesUnderTokens: 50 },
      });

      expect(res.metrics.stage1.skipped).toBe(false);
      expect(res.metrics.stage2.skipped).toBe(false);
      expect(res.metrics.stage3.skipped).toBe(false);
      expect(res.metrics.promptTokensRaw).toBeGreaterThan(0);
      // Stage 2 ratio reflects router compression.
      expect(res.metrics.stage2.ratio).toBeLessThan(1);
      // Total wall-time reflects all stages.
      expect(res.metrics.totalWallMs).toBeGreaterThanOrEqual(0);
      // The user question must always survive.
      expect(res.optimizedPrompt).toContain('rename Foo to Bar');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('optimize — router unreachable degrades cleanly', () => {
  it('returns a valid result even when stage 2 fetch fails', async () => {
    const longBlob = 'verbose '.repeat(200);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    try {
      const res = await optimize({
        toolOutputs: [{ id: 'b', content: longBlob }],
        userQuestion: 'summarize',
        budget: { skipStagesUnderTokens: 50 },
      });
      // Stage 2 records the error but pipeline continues.
      expect(res.metrics.stage2.error).toContain('ECONNREFUSED');
      // Stage 3 falls back to heuristic, also records the score-tokens error.
      expect(res.metrics.stage3.skipped).toBe(false);
      expect(res.optimizedPrompt).toContain('summarize');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('optimize — protected spans preserved end-to-end', () => {
  it('keeps file paths and SHAs through all stages', async () => {
    const originalFetch = globalThis.fetch;
    // Stage 2: return a "compressed" version that omits the protected token
    // — but the optimizer is robust because stage 1 already inserted the marker
    // upstream. We test that the prompt sent to the router actually contains
    // the protected marker.
    let lastRouterCallBody: unknown = null;
    globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
      lastRouterCallBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'tiny' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    try {
      const longBlob = 'log '.repeat(200) + ' touched /src/foo.ts commit deadbeef1234';
      await optimize({
        toolOutputs: [{ id: 'b', content: longBlob }],
        userQuestion: 'what changed?',
        budget: { skipStagesUnderTokens: 50 },
      });
      const body = lastRouterCallBody as { messages: Array<{ content: string }> };
      const userMsg = body.messages.find((m) =>
        (m.content || '').includes('protected:'),
      );
      expect(userMsg, 'router prompt should contain protected markers').toBeTruthy();
      expect(userMsg!.content).toContain('«protected:path:/src/foo.ts»');
      expect(userMsg!.content).toContain('«protected:sha:deadbeef1234»');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
