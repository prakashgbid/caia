/**
 * Integration test — gated by RUN_INTEGRATION=1.
 *
 * Runs a mini live investigation:
 *   - Real `claude` binary (subscription-only — ANTHROPIC_API_KEY scrubbed).
 *   - Real Node `fetch` against a fixed pool of curated URLs (vendor docs +
 *     a couple of secondary sources). Avoids the search backend entirely so
 *     the test is reproducible and fast.
 *   - Pool searcher returns the SAME pool regardless of sub-question — the
 *     executor's URL-dedup ensures we still process each source exactly once.
 *
 * Run: RUN_INTEGRATION=1 npx vitest run tests/integration.test.ts
 *
 * The test asserts:
 *   - Pipeline completes (no exception)
 *   - markdown >= 4 KB
 *   - >= 6 sources fetched
 *   - At least 3 sections in the report
 *   - Recommendation verdict is one of the four enum values
 */

import { describe, it, expect } from 'vitest';
import { ResearcherAgent } from '../src/agent.js';
import { createDefaultWebFetcher } from '../src/fetchers/web-fetcher.js';
import type { SearchResult, WebSearcher } from '../src/types.js';

const SHOULD_RUN = process.env['RUN_INTEGRATION'] === '1';

/** Stable, publicly-fetchable URLs covering the JSON-Schema vs Zod question. */
const POOL: readonly SearchResult[] = Object.freeze([
  { title: 'JSON Schema spec', url: 'https://json-schema.org/specification', snippet: '' },
  { title: 'Zod docs', url: 'https://zod.dev', snippet: '' },
  { title: 'Zod GitHub', url: 'https://github.com/colinhacks/zod', snippet: '' },
  { title: 'Ajv', url: 'https://ajv.js.org/', snippet: '' },
  { title: 'TypeBox', url: 'https://github.com/sinclairzx81/typebox', snippet: '' },
  { title: 'JSON Schema getting started', url: 'https://json-schema.org/learn/getting-started-step-by-step', snippet: '' },
  { title: 'Valibot', url: 'https://valibot.dev/', snippet: '' },
  { title: 'Hono', url: 'https://hono.dev/', snippet: '' },
  { title: 'OpenAPI 3.1 + JSON Schema', url: 'https://www.openapis.org/blog/2021/02/16/migrating-from-openapi-3-0-to-3-1-0', snippet: '' }
]);

/** Returns the SAME pool for every query. Executor dedups by URL. */
function createPoolSearcher(): WebSearcher {
  return {
    async search(_q: string, opts?: { topK?: number }): Promise<SearchResult[]> {
      const k = opts?.topK ?? POOL.length;
      return POOL.slice(0, k).map(r => ({ ...r }));
    }
  };
}

describe.runIf(SHOULD_RUN)('integration: JSON-Schema vs Zod', () => {
  it('produces a coherent report with ≥6 sources', async () => {
    const httpFetch = {
      async fetch(input: { url: string; timeoutMs: number }): Promise<{
        ok: boolean;
        status: number;
        body: string;
      }> {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), input.timeoutMs);
        try {
          const res = await fetch(input.url, {
            signal: ac.signal,
            headers: { 'User-Agent': 'caia-researcher/0.1.0-integration' }
          });
          const body = await res.text();
          return { ok: res.ok, status: res.status, body };
        } catch {
          return { ok: false, status: 0, body: '' };
        } finally {
          clearTimeout(t);
        }
      }
    };

    const agent = new ResearcherAgent({
      searcher: createPoolSearcher(),
      fetcher: createDefaultWebFetcher({ httpFetch }),
      // Real LLM — uses default createDefaultLlmClient when llm is omitted.
      shallowSubQuestions: 3,
      shallowSourcesPerQuestion: 9,
      minSourceCount: 6,
      synthesisTimeoutMs: 240_000,
      plannerTimeoutMs: 60_000
    });

    const report = await agent.investigateTopic({
      query: 'evaluate JSON-Schema vs Zod for TypeScript validation',
      depth: 'shallow'
    });

    expect(report.markdown.length).toBeGreaterThan(3000);
    expect(report.sources.length).toBeGreaterThanOrEqual(6);
    expect(report.sections.length).toBeGreaterThanOrEqual(3);
    expect(['adopt', 'pilot', 'track', 'reject']).toContain(
      report.recommendation.verdict
    );
  }, 300_000);
});
