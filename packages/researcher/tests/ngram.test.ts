import { describe, it, expect } from 'vitest';
import { tokenize, buildNgramSet, scrubVerbatimRuns } from '../src/ngram.js';

describe('tokenize', () => {
  it('lowercases and splits on non-word', () => {
    expect(tokenize('Hello, World!')).toEqual(['hello', 'world']);
  });
  it('preserves contractions', () => {
    expect(tokenize("won't can't")).toEqual(["won't", "can't"]);
  });
  it('keeps hyphenated identifiers', () => {
    expect(tokenize('multi-agent system')).toEqual(['multi-agent', 'system']);
  });
});

describe('buildNgramSet', () => {
  it('builds 3-grams', () => {
    const set = buildNgramSet('the quick brown fox jumps', 3);
    expect(set.has('the quick brown')).toBe(true);
    expect(set.has('quick brown fox')).toBe(true);
    expect(set.has('brown fox jumps')).toBe(true);
    expect(set.size).toBe(3);
  });
  it('returns empty when text shorter than n', () => {
    expect(buildNgramSet('two words', 5).size).toBe(0);
  });
});

describe('scrubVerbatimRuns', () => {
  it('scrubs verbatim runs above threshold', () => {
    const source = 'the quick brown fox jumps over the lazy dog twenty times';
    const body = `Reports note that the quick brown fox jumps over the lazy dog twenty times during testing.`;
    const result = scrubVerbatimRuns(body, [source], 5);
    expect(result.hits).toBe(1);
    expect(result.scrubbed).toContain('[...]');
    expect(result.scrubbed).not.toContain('the quick brown fox jumps over');
  });
  it('does not scrub short overlaps', () => {
    const source = 'hello world this is a sentence about TypeScript';
    const body = 'They write hello world in their docs.';
    const result = scrubVerbatimRuns(body, [source], 5);
    expect(result.hits).toBe(0);
  });
  it('handles empty inputs', () => {
    expect(scrubVerbatimRuns('', ['x'], 3).hits).toBe(0);
    expect(scrubVerbatimRuns('x y z', [], 3).hits).toBe(0);
  });
});
