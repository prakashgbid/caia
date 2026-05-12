import { describe, expect, it, vi } from 'vitest';

import { tagProtectedSpans } from '../src/stage1.js';
import {
  DEFAULT_SEGMENT_WEIGHTS,
  pruneSegment,
  scoreHeuristic,
  stage3Prune,
  type PromptSegment,
} from '../src/stage3.js';

describe('stage3 — scoreHeuristic', () => {
  it('scores query-term hits higher than unrelated words', () => {
    const seg: PromptSegment = {
      kind: 'tool-output',
      text: 'rename Foo class then commit and refactor',
      weight: 1,
    };
    const scored = scoreHeuristic([seg], 'rename Foo class');
    const words = seg.text.split(/(\s+)/);
    const scoreOf = (word: string) => {
      const idx = words.indexOf(word);
      return scored[0].scores[idx];
    };
    expect(scoreOf('rename')).toBeGreaterThan(scoreOf('commit'));
    expect(scoreOf('Foo')).toBeGreaterThan(scoreOf('and'));
  });

  it('gives a code-shape bonus to identifiers and paths', () => {
    const seg: PromptSegment = {
      kind: 'tool-output',
      text: 'file path/to/foo.ts has 42 lines',
      weight: 1,
    };
    const scored = scoreHeuristic([seg], 'count the lines');
    const words = seg.text.split(/(\s+)/);
    const pathIdx = words.indexOf('path/to/foo.ts');
    const fileIdx = words.indexOf('file');
    expect(pathIdx).toBeGreaterThan(-1);
    expect(scored[0].scores[pathIdx]).toBeGreaterThan(scored[0].scores[fileIdx]);
  });
});

describe('stage3 — pruneSegment', () => {
  it('drops lowest-scoring words to hit the keep-ratio', () => {
    const text = 'alpha beta gamma delta epsilon';
    const scores = ['alpha', ' ', 'beta', ' ', 'gamma', ' ', 'delta', ' ', 'epsilon'].map(
      (w) => (w.trim() === '' ? 0 : { alpha: 5, beta: 1, gamma: 4, delta: 2, epsilon: 3 }[w] ?? 0),
    );
    const pruned = pruneSegment(text, scores, 0.6);
    // Keep top ceil(5 * 0.6) = 3 words. Top three by score: alpha(5), gamma(4), epsilon(3)
    expect(pruned).toContain('alpha');
    expect(pruned).toContain('gamma');
    expect(pruned).toContain('epsilon');
    expect(pruned).not.toContain('beta');
    expect(pruned).not.toContain('delta');
  });

  it('always preserves protected spans regardless of score', () => {
    const tagged = tagProtectedSpans('keep /path/file.ts now please');
    const words = tagged.text.split(/(\s+)/);
    // Force all non-whitespace scores to 0 — protected span must still survive.
    const scores = words.map((w) => (w.trim() === '' ? 0 : 0));
    const pruned = pruneSegment(tagged.text, scores, 0.1);
    expect(pruned).toContain('«protected:path:/path/file.ts»');
  });

  it('returns the original text on score-array mismatch', () => {
    const text = 'one two three';
    const badScores = [1, 2]; // wrong length
    expect(pruneSegment(text, badScores, 0.5)).toBe(text);
  });
});

describe('stage3 — stage3Prune skipping behaviour', () => {
  it('skips when total token count is below minTokensToPrune', async () => {
    const segments: PromptSegment[] = [
      { kind: 'tool-output', text: 'short', weight: 1 },
      { kind: 'user-question', text: 'what?', weight: 0 },
    ];
    const out = await stage3Prune(segments, 'what?', {
      minTokensToPrune: 500,
      forceHeuristic: true,
    });
    expect(out.backend).toBe('skipped');
    expect(out.tokensIn).toBe(out.tokensOut);
  });
});

describe('stage3 — heuristic backend produces compression', () => {
  it('reduces token count when given a verbose old-tool-output segment', async () => {
    const filler = 'extraneous boilerplate logging preamble noise '.repeat(50);
    const segments: PromptSegment[] = [
      {
        kind: 'old-tool-output',
        text: filler + ' relevant rename Foo identifier here',
        weight: DEFAULT_SEGMENT_WEIGHTS['old-tool-output'],
      },
      { kind: 'user-question', text: 'rename Foo identifier', weight: 0 },
    ];
    const out = await stage3Prune(segments, 'rename Foo identifier', {
      targetRatio: 0.3,
      forceHeuristic: true,
      minTokensToPrune: 50,
    });
    expect(out.backend).toBe('heuristic');
    expect(out.tokensOut).toBeLessThan(out.tokensIn);
    expect(out.text).toContain('rename');
    expect(out.text).toContain('Foo');
  });

  it('does not prune system or user-question segments', async () => {
    const segments: PromptSegment[] = [
      { kind: 'system', text: 'SYSTEM INSTRUCTIONS THAT MUST REMAIN INTACT', weight: 0 },
      {
        kind: 'old-tool-output',
        text: 'filler '.repeat(200),
        weight: DEFAULT_SEGMENT_WEIGHTS['old-tool-output'],
      },
      { kind: 'user-question', text: 'do the thing', weight: 0 },
    ];
    const out = await stage3Prune(segments, 'do the thing', {
      targetRatio: 0.3,
      forceHeuristic: true,
      minTokensToPrune: 50,
    });
    expect(out.text).toContain('SYSTEM INSTRUCTIONS THAT MUST REMAIN INTACT');
    expect(out.text).toContain('do the thing');
  });
});

describe('stage3 — router backend with fallback', () => {
  it('uses router scores when /v1/score-tokens is reachable', async () => {
    const segments: PromptSegment[] = [
      {
        kind: 'tool-output',
        text: 'a b c d e f g h i j k l m n o p q r s t',
        weight: 1,
      },
      { kind: 'user-question', text: 'pick letters', weight: 0 },
    ];
    // Score the first 10 high, rest low — the algorithm should keep the first 10.
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          segments: [
            {
              token_logprobs: segments[0].text
                .split(/(\s+)/)
                .map((w, i) => (w.trim() === '' ? 0 : i < 20 ? 10 : 1)),
            },
            { token_logprobs: segments[1].text.split(/(\s+)/).map(() => 1) },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const out = await stage3Prune(segments, 'pick letters', {
      targetRatio: 0.5,
      minTokensToPrune: 10,
      fetchImpl,
    });
    expect(out.backend).toBe('router');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('falls back to heuristic on router error', async () => {
    const segments: PromptSegment[] = [
      {
        kind: 'tool-output',
        text: 'verbose '.repeat(100) + 'keyword',
        weight: 1,
      },
      { kind: 'user-question', text: 'keyword', weight: 0 },
    ];
    const fetchImpl = vi.fn(async () => {
      return new Response('', { status: 500 });
    }) as unknown as typeof fetch;

    const out = await stage3Prune(segments, 'keyword', {
      targetRatio: 0.5,
      minTokensToPrune: 10,
      fetchImpl,
    });
    expect(out.backend).toBe('heuristic');
    expect(out.error).toContain('router-status-500');
  });
});
