import { describe, it, expect } from 'vitest';
import { verify, countCitations } from '../src/verifier.js';
import type { FetchedPage, RawSynthesis } from '../src/types.js';

function page(i: number, text: string): FetchedPage {
  return {
    url: `https://example${i}.com`,
    title: `t${i}`,
    fetchedAtIso: '2026-05-06T00:00:00Z',
    bytesFetched: text.length,
    text,
    trust: 'primary'
  };
}

function makeIdMap(pages: FetchedPage[]): Map<string, FetchedPage> {
  const m = new Map<string, FetchedPage>();
  pages.forEach((p, i) => m.set(`s${i + 1}`, p));
  return m;
}

const baseRaw: RawSynthesis = {
  executiveSummary:
    'Bun outperforms Node in cold start latency for microservices [^s1]; however, Node has broader ecosystem support [^s2]. Trade-offs follow.',
  recommendation: {
    verdict: 'pilot',
    confidence: 'medium',
    rationale: 'pilot Bun on a single low-stakes service first [^s1]',
    nextSteps: ['pilot service']
  },
  sections: [
    {
      heading: 'Landscape',
      body: 'Bun is a runtime [^s1]. Node is a runtime [^s2]. Together they cover most use cases.'
    },
    {
      heading: 'Alternatives',
      body: 'Deno is another runtime [^s3]. It has different priorities.'
    },
    {
      heading: 'Risks',
      body: 'Production maturity remains a concern for Bun [^s1]. Ecosystem gaps exist.'
    }
  ],
  citedSourceIds: ['s1', 's2', 's3']
};

describe('countCitations', () => {
  it('counts [^x] across body', () => {
    expect(countCitations(baseRaw)).toBe(7);
  });
});

describe('verify', () => {
  const sourceIdMap = makeIdMap([
    page(1, 'Bun is a JavaScript runtime that emphasises speed.'),
    page(2, 'Node.js is a mature server-side JavaScript runtime.'),
    page(3, 'Deno is a TypeScript-first runtime.'),
    page(4, 'extra'),
    page(5, 'extra'),
    page(6, 'extra'),
    page(7, 'extra'),
    page(8, 'extra'),
    page(9, 'extra'),
    page(10, 'extra')
  ]);

  it('passes a clean synthesis', () => {
    const out = verify(
      { raw: baseRaw, sourceIdMap },
      {
        maxQuoteWords: 14,
        minSourceCount: 10,
        hallucinationRatioThreshold: 0.2
      }
    );
    expect(out.ok).toBe(true);
    expect(out.hallucinationsDropped).toBe(0);
    expect(out.retainedSourceIds.has('s1')).toBe(true);
    expect(out.retainedSourceIds.has('s3')).toBe(true);
  });

  it('drops phantom citations', () => {
    const phantom: RawSynthesis = {
      ...baseRaw,
      executiveSummary:
        baseRaw.executiveSummary + ' Also see [^s99] and [^sZZZ].'
    };
    const out = verify(
      { raw: phantom, sourceIdMap },
      {
        maxQuoteWords: 14,
        minSourceCount: 10,
        hallucinationRatioThreshold: 0.5
      }
    );
    expect(out.hallucinationsDropped).toBe(2);
    expect(out.verified.executiveSummary).toContain('[^?]');
    expect(out.verified.executiveSummary).not.toContain('[^s99]');
  });

  it('fails when source count below floor', () => {
    const tinyMap = makeIdMap([page(1, 'x')]);
    const out = verify(
      { raw: baseRaw, sourceIdMap: tinyMap },
      {
        maxQuoteWords: 14,
        minSourceCount: 10,
        hallucinationRatioThreshold: 0.2
      }
    );
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('source count');
  });

  it('scrubs verbatim runs above maxQuoteWords', () => {
    const longSource = page(
      1,
      'the quick brown fox jumps over the lazy dog twenty times during testing every single morning'
    );
    const sourcesWithLong = makeIdMap([
      longSource,
      ...Array.from({ length: 9 }, (_, i) => page(i + 2, 'x'))
    ]);
    const synthesis: RawSynthesis = {
      ...baseRaw,
      executiveSummary:
        'According to one source, the quick brown fox jumps over the lazy dog twenty times during testing every single morning [^s1]. Reports differ.'
    };
    const out = verify(
      { raw: synthesis, sourceIdMap: sourcesWithLong },
      {
        maxQuoteWords: 5,
        minSourceCount: 10,
        hallucinationRatioThreshold: 0.5
      }
    );
    expect(out.quotesScrubbed).toBeGreaterThan(0);
    expect(out.verified.executiveSummary).toContain('[...]');
  });

  it('fails when hallucination ratio above threshold', () => {
    const phantom: RawSynthesis = {
      ...baseRaw,
      executiveSummary:
        '[^s99] [^s98] [^s97] [^s96] [^s95] [^s94] [^s93] [^s92] [^s91] [^s90]',
      sections: [
        { heading: 'A', body: 'a' },
        { heading: 'B', body: 'b' },
        { heading: 'C', body: 'c' }
      ],
      recommendation: { ...baseRaw.recommendation, rationale: '' }
    };
    const out = verify(
      { raw: phantom, sourceIdMap },
      {
        maxQuoteWords: 14,
        minSourceCount: 10,
        hallucinationRatioThreshold: 0.2
      }
    );
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('hallucination');
  });
});
