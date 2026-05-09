import { describe, it, expect } from 'vitest';
import { ResearcherAgent } from '../src/agent.js';
import { createFixtureSearcher } from '../src/fetchers/web-searcher.js';
import { createFixtureWebFetcher } from '../src/fetchers/web-fetcher.js';
import { createFixturePrecedentSource } from '../src/fetchers/precedent-source.js';
import type {
  FetchedPage,
  LlmClient,
  PrecedentInjection,
  SearchResult
} from '../src/types.js';

function buildPage(i: number): FetchedPage {
  return {
    url: `https://src${i}.com/article`,
    title: `Source ${i} Title`,
    fetchedAtIso: '2026-05-06T00:00:00Z',
    bytesFetched: 500,
    text: `This is body content for source ${i}. It discusses runtime performance trade-offs and ecosystem maturity.`,
    trust: i % 2 === 0 ? 'primary' : 'secondary'
  };
}

function buildFixtures(): {
  searchResults: Map<string, readonly SearchResult[]>;
  pages: Map<string, FetchedPage>;
  precedent: Map<string, readonly PrecedentInjection[]>;
} {
  const pages = new Map<string, FetchedPage>();
  const allResults: SearchResult[] = [];
  for (let i = 1; i <= 12; i++) {
    const p = buildPage(i);
    pages.set(p.url, p);
    allResults.push({ title: p.title, url: p.url, snippet: 's' });
  }
  const searchResults = new Map<string, readonly SearchResult[]>();
  searchResults.set('q1', allResults.slice(0, 4));
  searchResults.set('q2', allResults.slice(4, 8));
  searchResults.set('q3', allResults.slice(8, 12));
  const precedent = new Map<string, readonly PrecedentInjection[]>([
    [
      '*',
      [
        {
          path: '/x',
          slug: 'feedback-runtime',
          similarity: 0.65,
          excerpt: 'we previously evaluated similar runtime trade-offs'
        }
      ]
    ]
  ]);
  return { searchResults, pages, precedent };
}

describe('ResearcherAgent', () => {
  it('produces a complete ResearchReport when pipeline succeeds', async () => {
    const { searchResults, pages, precedent } = buildFixtures();

    const llm: LlmClient = {
      async complete(input) {
        // Planner is asked first — we detect by prompt content.
        if (input.prompt.includes('research-planner agent')) {
          return {
            ok: true,
            text: JSON.stringify({
              subQuestions: ['q1', 'q2', 'q3'],
              rationale: 'three orthogonal axes'
            })
          };
        }
        // Synthesizer.
        return {
          ok: true,
          text: JSON.stringify({
            executiveSummary:
              'Source-grounded executive summary spanning multiple sources [^s1], [^s2], [^s3]. The verdict aligns with available evidence.',
            recommendation: {
              verdict: 'pilot',
              confidence: 'medium',
              rationale:
                'pilot in a low-stakes service first based on [^s4] and [^s5]',
              nextSteps: ['pilot one service', 'measure latency']
            },
            sections: [
              {
                heading: 'Landscape',
                body: 'Both runtimes are mature [^s1][^s6]. Differences focus on cold-start.'
              },
              {
                heading: 'Alternatives',
                body: 'Deno exists [^s2]. Trade-offs apply.'
              },
              {
                heading: 'Fit assessment',
                body: 'Fit is moderate [^s7][^s8]. Prior precedent applies.'
              },
              {
                heading: 'Risks',
                body: 'Production maturity is a known risk [^s9][^s10][^s11].'
              }
            ],
            citedSourceIds: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11']
          })
        };
      }
    };

    const agent = new ResearcherAgent({
      searcher: createFixtureSearcher(searchResults),
      fetcher: createFixtureWebFetcher(pages),
      precedentSource: createFixturePrecedentSource(precedent),
      llm,
      shallowSubQuestions: 3,
      shallowSourcesPerQuestion: 4,
      mediumSubQuestions: 3,
      mediumSourcesPerQuestion: 4,
      minSourceCount: 10,
      clock: () => new Date('2026-05-06T12:00:00Z')
    });

    const report = await agent.investigateTopic({
      query: 'should we adopt Bun?',
      depth: 'medium'
    });

    expect(report.query).toBe('should we adopt Bun?');
    expect(report.depth).toBe('medium');
    expect(report.recommendation.verdict).toBe('pilot');
    expect(report.sections.length).toBeGreaterThanOrEqual(3);
    expect(report.sources.length).toBeGreaterThanOrEqual(10);
    expect(report.markdown).toContain('# Research report — should we adopt Bun?');
    expect(report.markdown).toContain('Sources');
    expect(report.precedent).toHaveLength(1);
    expect(report.precedent[0]?.slug).toBe('feedback-runtime');
    expect(report.diagnostics.sourcesFetched).toBe(12);
    expect(report.diagnostics.subQuestionsPlanned).toBe(3);
  });

  it('throws when synthesis fails', async () => {
    const { searchResults, pages } = buildFixtures();
    const llm: LlmClient = {
      async complete() {
        return { ok: false, text: '', diagnostic: 'forced failure' };
      }
    };
    const agent = new ResearcherAgent({
      searcher: createFixtureSearcher(searchResults),
      fetcher: createFixtureWebFetcher(pages),
      llm,
      shallowSubQuestions: 1,
      shallowSourcesPerQuestion: 1,
      minSourceCount: 1
    });
    await expect(
      agent.investigateTopic({ query: 'X', depth: 'shallow' })
    ).rejects.toThrow(/synthesis failed/);
  });

  it('throws when constructed without searcher or fetcher', () => {
    expect(() => new ResearcherAgent({})).toThrow(/searcher is required/);
    expect(
      () =>
        new ResearcherAgent({
          searcher: createFixtureSearcher(new Map())
        })
    ).toThrow(/fetcher is required/);
  });
});
