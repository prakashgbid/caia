import { describe, expect, it } from 'vitest';

import { ProposalGeneratorError } from '../src/errors.js';
import {
  EXEC_SUMMARY_BOUNDS,
  FULL_PROPOSAL_BOUNDS,
  ONE_PAGER_BOUNDS,
  assertWithinBounds,
  countHeadings,
  countWords,
} from '../src/proposal/word-count.js';

describe('countWords', () => {
  it('counts words in plain text', () => {
    expect(countWords('one two three four')).toBe(4);
  });
  it('ignores fenced code', () => {
    const md = 'one two\n```\nlots of code goes here ignored\n```\nthree';
    expect(countWords(md)).toBe(3);
  });
  it('ignores inline code + heading markers', () => {
    expect(countWords('# Heading one\n`code`\nbody text')).toBeGreaterThanOrEqual(3);
  });
});

describe('countHeadings', () => {
  it('counts H1 vs H2 separately', () => {
    const md = '# a\n## b\n## c\n### d\n';
    expect(countHeadings(md, 1)).toBe(1);
    expect(countHeadings(md, 2)).toBe(2);
    expect(countHeadings(md, 3)).toBe(1);
  });
});

describe('assertWithinBounds (exec summary)', () => {
  it('accepts a doc inside the 50-400 word window', () => {
    const md = '# T\n' + Array(120).fill('word').join(' ');
    expect(() => assertWithinBounds('exec', md, EXEC_SUMMARY_BOUNDS)).not.toThrow();
  });
  it('rejects a doc that is too short', () => {
    expect(() => assertWithinBounds('exec', '# T\nshort', EXEC_SUMMARY_BOUNDS)).toThrow(
      ProposalGeneratorError,
    );
  });
  it('rejects a doc that is too long', () => {
    const md = '# T\n' + Array(500).fill('word').join(' ');
    expect(() => assertWithinBounds('exec', md, EXEC_SUMMARY_BOUNDS)).toThrow();
  });
});

describe('assertWithinBounds (one-pager)', () => {
  it('rejects a doc above the 320-word ceiling', () => {
    const md = '## A\n' + Array(400).fill('word').join(' ');
    expect(() => assertWithinBounds('one', md, ONE_PAGER_BOUNDS)).toThrow();
  });
});

describe('assertWithinBounds (full proposal)', () => {
  it('rejects when below the 2500-word floor', () => {
    const md = '# T\n## A\n## B\n## C\n## D\n' + Array(500).fill('word').join(' ');
    expect(() => assertWithinBounds('full', md, FULL_PROPOSAL_BOUNDS)).toThrow();
  });
  it('accepts a doc with required headings and adequate length', () => {
    const md =
      '# T\n## A\n## B\n## C\n## D\n' + Array(3000).fill('word').join(' ');
    expect(() => assertWithinBounds('full', md, FULL_PROPOSAL_BOUNDS)).not.toThrow();
  });
});
