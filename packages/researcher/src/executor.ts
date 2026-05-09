/**
 * Executor stage — DESIGN.md §5 step 3.
 *
 * For each sub-question:
 *   a. WebSearcher.search(subQuestion) → SearchResult[]
 *   b. for top-K results: WebFetcher.fetch(url) → FetchedPage
 *   c. dedup by canonical URL across the whole investigation
 *   d. accumulate failures (timeouts, 404s) for the diagnostics field
 *
 * Sequential by default — Anthropic's multi-agent research system reports +90%
 * on parallel-divisible tasks at 15× token cost. CAIA's subscription-only
 * model on a 16 GB Mac cannot afford 15× cost amplification, so we serialise
 * the WebSearch / WebFetch calls. Search and fetch are network-IO bound, not
 * LLM-bound — the actual claude calls happen ONLY in planner + synthesizer.
 */

import type {
  ResearchPlan,
  SubQuestionEvidence,
  WebFetcher,
  WebSearcher
} from './types.js';

export interface ExecutorOptions {
  searcher: WebSearcher;
  fetcher: WebFetcher;
  sourcesPerQuestion: number;
  perFetchTimeoutMs: number;
}

export interface ExecutorOutput {
  evidence: SubQuestionEvidence[];
  /** All fetched pages flattened, deduped by canonical URL. */
  allFetched: SubQuestionEvidence['fetchedPages'];
  diagnostics: {
    sourcesAttempted: number;
    sourcesFetched: number;
    sourcesFailed: number;
  };
}

/** Strip URL fragment + common tracking params for dedup. */
export function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    const drop = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'mc_cid', 'mc_eid'];
    for (const p of drop) u.searchParams.delete(p);
    // Trim trailing slash on path (but keep `/` root).
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return url;
  }
}

export async function executePlan(
  plan: ResearchPlan,
  opts: ExecutorOptions
): Promise<ExecutorOutput> {
  const evidence: SubQuestionEvidence[] = [];
  const seenUrls = new Set<string>();
  const allFetched: SubQuestionEvidence['fetchedPages'] = [];
  let sourcesAttempted = 0;
  let sourcesFetched = 0;
  let sourcesFailed = 0;

  for (const subQuestion of plan.subQuestions) {
    const failures: string[] = [];
    const fetchedPages: SubQuestionEvidence['fetchedPages'] = [];
    let searchResults: SubQuestionEvidence['searchResults'] = [];
    try {
      searchResults = await opts.searcher.search(subQuestion, {
        topK: opts.sourcesPerQuestion
      });
    } catch (e) {
      failures.push(`search: ${(e as Error).message}`);
    }

    for (const r of searchResults.slice(0, opts.sourcesPerQuestion)) {
      const canon = canonicalizeUrl(r.url);
      if (seenUrls.has(canon)) continue;
      seenUrls.add(canon);
      sourcesAttempted++;
      try {
        const page = await opts.fetcher.fetch(r.url, {
          timeoutMs: opts.perFetchTimeoutMs
        });
        fetchedPages.push(page);
        allFetched.push(page);
        sourcesFetched++;
      } catch (e) {
        failures.push(`fetch ${r.url}: ${(e as Error).message}`);
        sourcesFailed++;
      }
    }

    evidence.push({
      subQuestion,
      searchResults,
      fetchedPages,
      failures
    });
  }

  return {
    evidence,
    allFetched,
    diagnostics: {
      sourcesAttempted,
      sourcesFetched,
      sourcesFailed
    }
  };
}
