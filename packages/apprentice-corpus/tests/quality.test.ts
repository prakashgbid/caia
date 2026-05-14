import { describe, expect, it } from 'vitest';

import { DISTILLED_MAX_LEN, DISTILLED_MIN_LEN, scoreOne } from '../src/quality.js';
import type { InstructionPair } from '../src/types.js';

const opts = { minSampleLengthChars: 80, maxSampleLengthChars: 1000 };
// Production-shape opts: matches `defaultCorpusConfig` in `config.ts`.
const prodOpts = { minSampleLengthChars: 80, maxSampleLengthChars: 16000 };

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

describe('scoreOne — distilled-row per-source length band (APP.1)', () => {
  // Per the 2026-05-14 smoke-verification report: distilled output is
  // typical ~200-700 chars. Under the global 80-16000 band, mean
  // lengthScore was 0.015. Under the 150-1500 distilled band, a 500-char
  // sample should score near 0.3 (the full length-band ceiling).
  it('rewards distilled Q/A inside the 150-1500 band', () => {
    const distilledQA =
      'Sample Q/A response body — single paragraph, typical distilled output. '.repeat(8);
    expect(distilledQA.length).toBeGreaterThanOrEqual(DISTILLED_MIN_LEN);
    expect(distilledQA.length).toBeLessThanOrEqual(DISTILLED_MAX_LEN);
    const distilled = makePair(
      { source: 'memory', kind: 'directive', distilled: true },
      distilledQA
    );
    const score = scoreOne(distilled, prodOpts);
    // Distilled + structured (single paragraph, no bullets, so structure=0)
    // + operator voice (0.2) + length-band hit (~0.2-0.3) = ≥0.4.
    expect(score).toBeGreaterThanOrEqual(0.4);
  });

  it('does NOT punish a 500-char distilled sample against the global band', () => {
    const text = 'A focused distilled answer body. '.repeat(15); // ~495 chars
    const distilled = makePair(
      { source: 'memory', kind: 'directive', distilled: true },
      text
    );
    const undistilled = makePair(
      { source: 'memory', kind: 'directive', distilled: false },
      text
    );
    // Distilled gets the narrow 150-1500 band; undistilled gets the
    // global 80-16000 band where 500 chars is barely above min.
    expect(scoreOne(distilled, prodOpts)).toBeGreaterThan(scoreOne(undistilled, prodOpts));
  });

  it('rescues a ≥500-char distilled directive from the 0.4 quality gate', () => {
    // The exact failure mode the smoke-verification documented: 500-720-char
    // distilled samples, kind=directive, scored ~0.02-0.03 and were dropped
    // at the 0.4 gate. The new band puts them at the upper edge of the
    // length-band sweet spot (sweet = 690).
    const text = 'Distilled Q/A response body that summarises the source faithfully. '.repeat(8);
    expect(text.length).toBeGreaterThanOrEqual(500);
    const distilled = makePair(
      { source: 'memory', kind: 'directive', distilled: true },
      text
    );
    expect(scoreOne(distilled, prodOpts)).toBeGreaterThanOrEqual(0.4);
  });

  it('lifts the smoke-verification sample at 305 chars off the floor', () => {
    // Smoke-verification sample #1: 305 chars, kind=directive, scored
    // 0.0106 under the global band. Under the distilled band it scores
    // (305-150)/(690-150) * 0.3 = 0.086 length + 0.2 operator-voice ≈ 0.286
    // — still below the 0.4 gate, but a 27x lift off the floor.
    const text = 'A'.repeat(305);
    const distilled = makePair(
      { source: 'memory', kind: 'directive', distilled: true },
      text
    );
    const score = scoreOne(distilled, prodOpts);
    expect(score).toBeGreaterThan(0.25);
    expect(score).toBeLessThan(0.4); // not unconditionally rescued — long enough still wins
  });

  it('still zeroes distilled samples below the distilled-floor (150 chars)', () => {
    const tinyDistilled = makePair(
      { source: 'memory', kind: 'directive', distilled: true },
      'too short'
    );
    expect(scoreOne(tinyDistilled, prodOpts)).toBe(0);
  });

  it('leaves non-distilled scoring unchanged on the global band', () => {
    // Regression guard: a long-form memory artifact (~6 KB, multi-paragraph,
    // bulleted) should continue to score on the global band, not the
    // narrow distilled band.
    const longBody =
      '# Header\n\n- bullet one\n- bullet two\n\n'
      + 'A long-form memory artifact paragraph that captures substantive content.\n\n'.repeat(80);
    expect(longBody.length).toBeGreaterThan(4000);
    const pair = makePair(
      { source: 'memory', kind: 'directive', distilled: false },
      longBody
    );
    const score = scoreOne(pair, prodOpts);
    // Inside global sweet spot → length ≈ 0.3 + structure 0.2 + op-voice 0.2 ≈ 0.7.
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  it('distilled band does not affect 16-KB memory documents', () => {
    // A 16-KB memory doc with `distilled: false` continues to use the
    // global band — overflow lengthScore = 0.1, not the distilled band's
    // 0.1 — and the absolute score should match the pre-APP.1 baseline.
    const long = 'X'.repeat(20_000);
    const distFalse = makePair(
      { source: 'memory', kind: 'directive', distilled: false },
      long
    );
    const distTrue = makePair(
      { source: 'memory', kind: 'directive', distilled: true },
      long
    );
    // Both overflow their respective bands → lengthScore = 0.1 each.
    // The difference is only the band lo/hi; total score identical for overflow.
    expect(scoreOne(distFalse, prodOpts)).toBeCloseTo(scoreOne(distTrue, prodOpts), 5);
  });
});
