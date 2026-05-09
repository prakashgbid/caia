import { describe, it, expect } from 'vitest';
import { assembleMarkdown } from '../src/markdown.js';
import type {
  PrecedentInjection,
  RawSynthesis,
  ReportDiagnostics,
  ResearchSource
} from '../src/types.js';

const raw: RawSynthesis = {
  executiveSummary: 'es body content',
  recommendation: {
    verdict: 'pilot',
    confidence: 'medium',
    rationale: 'because',
    nextSteps: ['ns1', 'ns2']
  },
  sections: [
    { heading: 'Landscape', body: 'L body' },
    { heading: 'Alternatives', body: 'A body' }
  ],
  citedSourceIds: ['s1']
};

const sources: ResearchSource[] = [
  {
    id: 's1',
    title: 'src1',
    url: 'https://example.com/1',
    fetchedAtIso: '2026-05-06T00:00:00Z',
    bytesFetched: 100,
    trust: 'primary'
  }
];

const precedent: PrecedentInjection[] = [
  { path: '/x', slug: 'feedback-x', similarity: 0.7, excerpt: 'xx' }
];

const diagnostics: ReportDiagnostics = {
  subQuestionsPlanned: 5,
  sourcesAttempted: 10,
  sourcesFetched: 8,
  sourcesFailed: 2,
  quotesScrubbed: 0,
  hallucinationsDropped: 0,
  synthesisTokenEstimate: 4000
};

describe('assembleMarkdown', () => {
  it('emits canonical CAIA report shape', () => {
    const md = assembleMarkdown({
      query: 'should we adopt X',
      depth: 'medium',
      generatedAtIso: '2026-05-06T12:00:00Z',
      durationMs: 1234,
      raw,
      sources,
      precedent,
      subQuestions: ['q1', 'q2'],
      diagnostics
    });
    expect(md).toContain('# Research report — should we adopt X');
    expect(md).toContain('**Verdict**: PILOT');
    expect(md).toContain('## 1. Executive summary');
    expect(md).toContain('## 2. Bottom-line recommendation');
    expect(md).toContain('## 3. Sub-questions covered');
    expect(md).toContain('1. q1');
    expect(md).toContain('## 4. Landscape');
    expect(md).toContain('## 5. Alternatives');
    expect(md).toContain('Prior CAIA precedent');
    expect(md).toContain('Sources');
    expect(md).toContain('[^s1]: [src1](https://example.com/1)');
    expect(md).toContain('Diagnostics');
    expect(md).toContain('"sourcesFetched": 8');
  });

  it('omits precedent section when none', () => {
    const md = assembleMarkdown({
      query: 'q',
      depth: 'shallow',
      generatedAtIso: '2026-05-06T12:00:00Z',
      durationMs: 1,
      raw,
      sources,
      precedent: [],
      subQuestions: ['q1'],
      diagnostics
    });
    expect(md).not.toContain('Prior CAIA precedent');
  });
});
