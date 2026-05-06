import { describe, it, expect } from 'vitest';

import {
  decideDspyCompile,
  detectSignals
} from '../src/knowledge/dspy-heuristics.js';

describe('detectSignals', () => {
  it('detects high-frequency tasks', () => {
    expect(detectSignals('domain-classification').highFrequency).toBe(true);
  });

  it('detects reliability-sensitive tasks', () => {
    expect(detectSignals('po-decomposer-coverage-judge').reliabilitySensitive).toBe(true);
  });

  it('detects cross-model-portable tasks', () => {
    expect(detectSignals('code-implementation-simple').crossModelPortable).toBe(true);
  });

  it('returns no signals for unknown task', () => {
    const s = detectSignals('totally-unknown-task');
    expect(s.highFrequency).toBe(false);
    expect(s.reliabilitySensitive).toBe(false);
    expect(s.crossModelPortable).toBe(false);
  });
});

describe('decideDspyCompile', () => {
  it('does not recommend for 1-of-3 signal', () => {
    const v1 = decideDspyCompile('domain-classification');
    expect(v1.recommend).toBe(false);
    expect(v1.signalsPresent).toEqual(['highFrequency']);
  });

  it('does not recommend for unknown task', () => {
    const v = decideDspyCompile('totally-unknown-task');
    expect(v.recommend).toBe(false);
  });
});
