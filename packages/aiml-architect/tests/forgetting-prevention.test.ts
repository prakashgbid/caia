import { describe, it, expect } from 'vitest';

import { checkForgetting } from '../src/knowledge/forgetting-prevention.js';

describe('checkForgetting', () => {
  it('returns no violations when input is clean', () => {
    const out = checkForgetting({
      regressedPrompts: [],
      retiredPassingPrompts: [],
      replayBufferFraction: 0.1,
      forgettingThreshold: 0.1
    });
    expect(out).toEqual([]);
  });

  it('flags retired passing prompts as error', () => {
    const out = checkForgetting({
      regressedPrompts: [],
      retiredPassingPrompts: ['p1', 'p2'],
      replayBufferFraction: 0.1,
      forgettingThreshold: 0.1
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('retired-passing-prompt');
    expect(out[0]!.severity).toBe('error');
  });

  it('flags undersize replay buffer as warn', () => {
    const out = checkForgetting({
      regressedPrompts: [],
      retiredPassingPrompts: [],
      replayBufferFraction: 0.02,
      forgettingThreshold: 0.1
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('replay-undersize');
    expect(out[0]!.severity).toBe('warn');
  });

  it('flags many regressions as error', () => {
    const out = checkForgetting({
      regressedPrompts: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
      retiredPassingPrompts: [],
      replayBufferFraction: 0.1,
      forgettingThreshold: 0.1
    });
    expect(out.length).toBeGreaterThan(0);
    const reg = out.find((v) => v.kind === 'baseline-regression');
    expect(reg).toBeDefined();
    expect(reg!.severity).toBe('error');
  });
});
