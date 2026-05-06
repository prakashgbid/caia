import { describe, expect, it } from 'vitest';

import { parseJudgeReply, __TEST_ONLY } from '../src/judge.js';

describe('parseJudgeReply', () => {
  it('parses A | rationale', () => {
    expect(parseJudgeReply('A | A is more concise')).toEqual({
      preference: 'A',
      rationale: 'A is more concise'
    });
  });
  it('parses B | rationale', () => {
    expect(parseJudgeReply('B | B includes the standing rule')).toEqual({
      preference: 'B',
      rationale: 'B includes the standing rule'
    });
  });
  it('parses TIE | rationale', () => {
    expect(parseJudgeReply('TIE | both equivalent')).toEqual({
      preference: 'tie',
      rationale: 'both equivalent'
    });
  });
  it('falls back to tie on unparseable replies', () => {
    const r = parseJudgeReply('the answer is yes');
    expect(r.preference).toBe('tie');
    expect(r.rationale).toMatch(/unparseable/);
  });
  it('skips blank prefix lines', () => {
    expect(parseJudgeReply('\n\n  A | first non-blank wins')).toEqual({
      preference: 'A',
      rationale: 'first non-blank wins'
    });
  });
});

describe('judge env scrubbing', () => {
  it('removes secret env vars', () => {
    const out = __TEST_ONLY.scrub({ ANTHROPIC_API_KEY: 'x', PATH: '/u' });
    expect(out['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(out['PATH']).toBe('/u');
  });

  it('JUDGE_PROMPT_TEMPLATE references all 3 placeholders', () => {
    expect(__TEST_ONLY.JUDGE_PROMPT_TEMPLATE).toContain('{{PROMPT}}');
    expect(__TEST_ONLY.JUDGE_PROMPT_TEMPLATE).toContain('{{A}}');
    expect(__TEST_ONLY.JUDGE_PROMPT_TEMPLATE).toContain('{{B}}');
  });

  it('SECRETS_TO_SCRUB includes ANTHROPIC_API_KEY', () => {
    expect(__TEST_ONLY.SECRETS_TO_SCRUB).toContain('ANTHROPIC_API_KEY');
  });
});
