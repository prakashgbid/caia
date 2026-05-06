import { describe, it, expect } from 'vitest';
import {
  buildSynthesisPrompt,
  parseRawSynthesis,
  runSynthesis,
  assignSourceIds,
  estimateTokens
} from '../src/synthesizer.js';
import type {
  FetchedPage,
  LlmClient,
  ResearchPlan
} from '../src/types.js';

function page(i: number): FetchedPage {
  return {
    url: `https://example${i}.com`,
    title: `t${i}`,
    fetchedAtIso: '2026-05-06T00:00:00Z',
    bytesFetched: 100,
    text: `Page ${i} body content`,
    trust: i % 2 === 0 ? 'primary' : 'secondary'
  };
}

describe('assignSourceIds', () => {
  it('assigns s1, s2, s3 ...', () => {
    const m = assignSourceIds([page(1), page(2), page(3)]);
    expect(m.size).toBe(3);
    expect(m.get('s1')?.url).toBe('https://example1.com');
    expect(m.get('s3')?.url).toBe('https://example3.com');
  });
});

describe('estimateTokens', () => {
  it('rough chars/4', () => {
    expect(estimateTokens('hello world')).toBe(3); // 11/4 = 3
    expect(estimateTokens('')).toBe(0);
  });
});

describe('buildSynthesisPrompt', () => {
  const plan: ResearchPlan = {
    query: 'eval Bun',
    depth: 'medium',
    subQuestions: ['q1', 'q2'],
    rationale: 'because'
  };
  const fetched = [page(1), page(2)];
  const idMap = assignSourceIds(fetched);

  it('lists every source with its trust + URL', () => {
    const { prompt } = buildSynthesisPrompt(
      { plan, fetched, precedent: [] },
      idMap,
      {
        llm: {} as LlmClient,
        model: 'm',
        timeoutMs: 1000,
        maxQuoteWords: 14,
        maxFetchedExcerptBytes: 8000
      }
    );
    expect(prompt).toContain('[^s1]');
    expect(prompt).toContain('[^s2]');
    expect(prompt).toContain('https://example1.com');
    expect(prompt).toContain('Page 1 body content');
  });

  it('caps each excerpt at maxFetchedExcerptBytes', () => {
    const big: FetchedPage = {
      ...page(1),
      text: 'x'.repeat(20_000)
    };
    const map = assignSourceIds([big]);
    const { shownExcerpts } = buildSynthesisPrompt(
      { plan, fetched: [big], precedent: [] },
      map,
      {
        llm: {} as LlmClient,
        model: 'm',
        timeoutMs: 1000,
        maxQuoteWords: 14,
        maxFetchedExcerptBytes: 5000
      }
    );
    expect(shownExcerpts.get('s1')?.length).toBe(5000);
  });
});

describe('parseRawSynthesis', () => {
  const validJson = JSON.stringify({
    executiveSummary: 'es text long enough to pass...',
    recommendation: {
      verdict: 'pilot',
      confidence: 'medium',
      rationale: 'because',
      nextSteps: ['x', 'y']
    },
    sections: [
      { heading: 'A', body: 'a body [^s1]' },
      { heading: 'B', body: 'b body' }
    ],
    citedSourceIds: ['s1']
  });
  it('parses valid synthesis', () => {
    const r = parseRawSynthesis(validJson);
    expect(r.ok).toBe(true);
    expect(r.raw?.recommendation.verdict).toBe('pilot');
    expect(r.raw?.sections).toHaveLength(2);
  });
  it('rejects invalid verdict', () => {
    const bad = validJson.replace('"pilot"', '"yolo"');
    expect(parseRawSynthesis(bad).ok).toBe(false);
  });
  it('rejects empty sections', () => {
    const bad = validJson.replace(/"sections":\[.*?\]/, '"sections":[]');
    expect(parseRawSynthesis(bad).ok).toBe(false);
  });
  it('handles prose-wrapped JSON', () => {
    const wrapped = `Here you go: ${validJson} done.`;
    expect(parseRawSynthesis(wrapped).ok).toBe(true);
  });
});

describe('runSynthesis', () => {
  it('returns structured raw synthesis on LLM ok', async () => {
    const llm: LlmClient = {
      async complete() {
        return {
          ok: true,
          text: JSON.stringify({
            executiveSummary: 'long enough exec summary text content',
            recommendation: {
              verdict: 'adopt',
              confidence: 'high',
              rationale: 'r',
              nextSteps: []
            },
            sections: [
              { heading: 'A', body: 'a' },
              { heading: 'B', body: 'b' },
              { heading: 'C', body: 'c' }
            ],
            citedSourceIds: ['s1']
          })
        };
      }
    };
    const out = await runSynthesis(
      {
        plan: {
          query: 'q',
          depth: 'medium',
          subQuestions: ['x'],
          rationale: ''
        },
        fetched: [page(1), page(2)],
        precedent: []
      },
      {
        llm,
        model: 'm',
        timeoutMs: 1000,
        maxQuoteWords: 14,
        maxFetchedExcerptBytes: 1000
      }
    );
    expect(out.ok).toBe(true);
    expect(out.raw?.recommendation.verdict).toBe('adopt');
    expect(out.sourceIdMap.size).toBe(2);
    expect(out.shownExcerpts.size).toBe(2);
  });

  it('returns ok=false on LLM failure', async () => {
    const llm: LlmClient = {
      async complete() {
        return { ok: false, text: '', diagnostic: 'boom' };
      }
    };
    const out = await runSynthesis(
      {
        plan: { query: 'q', depth: 'shallow', subQuestions: [], rationale: '' },
        fetched: [page(1)],
        precedent: []
      },
      {
        llm,
        model: 'm',
        timeoutMs: 1000,
        maxQuoteWords: 14,
        maxFetchedExcerptBytes: 1000
      }
    );
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toBe('boom');
  });
});
