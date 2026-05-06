import { describe, expect, it } from 'vitest';

import { scoreOne } from '../src/quality.js';
import type { InstructionPair } from '../src/types.js';

const opts = { minSampleLengthChars: 80, maxSampleLengthChars: 1000 };

function makePair(meta: Partial<InstructionPair['meta']>, response: string): InstructionPair {
  return {
    id: 'x',
    messages: [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: response }
    ],
    meta: {
      source: 'memory',
      sourceId: 'x',
      qualityScore: 0,
      distilled: false,
      redactedSpans: [],
      createdAt: '2026-05-06T00:00:00Z',
      contentSha256: 'x',
      ...meta
    }
  };
}

describe('scoreOne', () => {
  it('rewards a structured directive of moderate length', () => {
    const response =
      '# Header\n\n- bullet one\n- bullet two\n- bullet three\n\nA paragraph that is reasonably long to clear the floor and contribute to length-band scoring without overshooting the sweet spot.\n\nAnother paragraph here for additional structure signal.';
    const p = makePair({ source: 'memory', kind: 'directive' }, response);
    const score = scoreOne(p, opts);
    // Structured (0.2) + operator voice (0.2) + some length contribution > 0.45
    expect(score).toBeGreaterThan(0.45);
  });

  it('penalises filler tokens', () => {
    const filler = 'um you know like sort of kind of um you know like sort of '.repeat(10);
    const p = makePair({ source: 'memory', kind: 'directive' }, filler);
    const clean = makePair(
      { source: 'memory', kind: 'directive' },
      'A clear, structured directive with no filler at all in the response.'.repeat(5)
    );
    expect(scoreOne(p, opts)).toBeLessThan(scoreOne(clean, opts));
  });

  it('zero score for too-short response', () => {
    const p = makePair({ source: 'memory', kind: 'directive' }, 'tiny');
    expect(scoreOne(p, opts)).toBe(0);
  });

  it('rewards code-heavy responses', () => {
    const codeResp = '```ts\n' + 'const x = 1;\n'.repeat(20) + '```';
    const p = makePair({ source: 'memory', kind: 'directive' }, codeResp);
    expect(scoreOne(p, opts)).toBeGreaterThan(0.4);
  });

  it('non-memory sources do not get the operator-voice bonus', () => {
    const text =
      '# Header\n\n- bullet a\n- bullet b\n\nA reasonably-long body paragraph that comfortably clears the minimum-length floor for quality scoring.\n\nAnother paragraph for additional structure.';
    const memDir = makePair({ source: 'memory', kind: 'directive' }, text);
    const evt = makePair({ source: 'events', kind: 'TaskCompleted' }, text);
    expect(scoreOne(memDir, opts)).toBeGreaterThan(scoreOne(evt, opts));
  });
});
