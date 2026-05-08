import { describe, it, expect } from 'vitest';

import {
  ASSERTION_TYPES,
  getAssertionRouting
} from '../src/knowledge/eval-methodology.js';

describe('ASSERTION_TYPES', () => {
  it('routes contains/regex/equals/javascript to promptfoo', () => {
    expect(getAssertionRouting('contains')).toBe('promptfoo');
    expect(getAssertionRouting('regex')).toBe('promptfoo');
    expect(getAssertionRouting('equals')).toBe('promptfoo');
    expect(getAssertionRouting('javascript')).toBe('promptfoo');
  });

  it('routes hallucination/faithfulness/g-eval to deepeval', () => {
    expect(getAssertionRouting('hallucination')).toBe('deepeval');
    expect(getAssertionRouting('faithfulness')).toBe('deepeval');
    expect(getAssertionRouting('g-eval')).toBe('deepeval');
  });

  it('routes llm-rubric to either', () => {
    expect(getAssertionRouting('llm-rubric')).toBe('either');
  });

  it('returns null for unknown assertion type', () => {
    expect(getAssertionRouting('totally-unknown')).toBeNull();
  });

  it('exports a non-trivial set', () => {
    expect(ASSERTION_TYPES.length).toBeGreaterThan(5);
  });
});
