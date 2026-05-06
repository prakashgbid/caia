import { describe, it, expect } from 'vitest';
import { executePlan, canonicalizeUrl } from '../src/executor.js';
import { createFixtureSearcher } from '../src/fetchers/web-searcher.js';
import { createFixtureWebFetcher } from '../src/fetchers/web-fetcher.js';
import type { FetchedPage, ResearchPlan, SearchResult } from '../src/types.js';

describe('canonicalizeUrl', () => {
  it('strips utm_*, gclid, fbclid', () => {
    expect(
      canonicalizeUrl('https://x.com/y?utm_source=foo&utm_medium=bar&id=1')
    ).toBe('https://x.com/y?id=1');
    expect(canonicalizeUrl('https://x.com/y?gclid=abc')).toBe('https://x.com/y');
  });
  it('strips fragment', () => {
    expect(canonicalizeUrl('https://x.com/y#section')).toBe('https://x.com/y');
  });
  it('strips trailing slash on non-root', () => {
    expect(canonicalizeUrl('https://x.com/y/')).toBe('https://x.com/y');
  });
  it('preserves invalid url', () => {
    expect(canonicalizeUrl('not a url')).toBe('not a url');
  });
});

function fakePage(url: string): FetchedPage {
  return {
    url,
    title: `t-${url}`,
    fetchedAtIso: '2026-05-06T00:00:00Z',
    bytesFetched: 100,
    text: `body for ${url}`,
    trust: 'tertiary'
  };
}

describe('executePlan', () => {
  it('searches per sub-question, fetches, dedups', async () => {
    const searchMap = new Map<string, readonly SearchResult[]>([
      ['q1', [
        { title: 't1', url: 'https://a.com/1', snippet: 's1' },
        { title: 't2', url: 'https://b.com/1', snippet: 's2' }
      ]],
      ['q2', [
        { title: 't3', url: 'https://b.com/1', snippet: 's3' }, // dup
        { title: 't4', url: 'https://c.com/1', snippet: 's4' }
      ]]
    ]);
    const fetchMap = new Map<string, FetchedPage>([
      ['https://a.com/1', fakePage('https://a.com/1')],
      ['https://b.com/1', fakePage('https://b.com/1')],
      ['https://c.com/1', fakePage('https://c.com/1')]
    ]);
    const searcher = createFixtureSearcher(searchMap);
    const fetcher = createFixtureWebFetcher(fetchMap);
    const plan: ResearchPlan = {
      query: 'orig',
      depth: 'medium',
      subQuestions: ['q1', 'q2'],
      rationale: 'r'
    };
    const out = await executePlan(plan, {
      searcher,
      fetcher,
      sourcesPerQuestion: 5,
      perFetchTimeoutMs: 1000
    });
    expect(out.evidence).toHaveLength(2);
    // Dedup: a.com + b.com from q1, c.com from q2 (b.com de-duped).
    expect(out.allFetched.map(p => p.url).sort()).toEqual([
      'https://a.com/1',
      'https://b.com/1',
      'https://c.com/1'
    ]);
    expect(out.diagnostics.sourcesFetched).toBe(3);
    expect(out.diagnostics.sourcesAttempted).toBe(3);
    expect(out.diagnostics.sourcesFailed).toBe(0);
  });

  it('records fetch failures without crashing', async () => {
    const searchMap = new Map<string, readonly SearchResult[]>([
      ['q', [{ title: 't', url: 'https://broken/1', snippet: 's' }]]
    ]);
    const searcher = createFixtureSearcher(searchMap);
    const fetcher = createFixtureWebFetcher(new Map());
    const plan: ResearchPlan = {
      query: 'q',
      depth: 'shallow',
      subQuestions: ['q'],
      rationale: ''
    };
    const out = await executePlan(plan, {
      searcher,
      fetcher,
      sourcesPerQuestion: 5,
      perFetchTimeoutMs: 1000
    });
    expect(out.diagnostics.sourcesFailed).toBe(1);
    expect(out.evidence[0]?.failures.length).toBe(1);
  });
});
