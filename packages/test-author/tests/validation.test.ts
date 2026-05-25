import { describe, it, expect } from 'vitest';

import { stripFences, validateAuthorOutput } from '../src/validation.js';
import { goldenAssistantText } from './helpers/fakes.js';

describe('stripFences', () => {
  it('removes ```json fences', () => {
    const text = '```json\n{"a":1}\n```';
    expect(stripFences(text)).toBe('{"a":1}');
  });

  it('removes plain ``` fences', () => {
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('returns plain text unchanged', () => {
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe('validateAuthorOutput — happy path', () => {
  it('validates the golden assistant text cleanly', () => {
    const result = validateAuthorOutput(goldenAssistantText(), 4);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.parsed).toBeDefined();
    expect(result.parsed?.testCases.length).toBe(15);
  });

  it('promotes designedBy to "test-author" when LLM omits it', () => {
    const result = validateAuthorOutput(goldenAssistantText(), 4);
    expect(result.parsed?.testDesign.designedBy).toBe('test-author');
  });
});

describe('validateAuthorOutput — invalid JSON', () => {
  it('rejects non-JSON text', () => {
    const result = validateAuthorOutput('not json', 0);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('invalid-json');
  });

  it('rejects a JSON array as the root', () => {
    const result = validateAuthorOutput('[]', 0);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe('wrong-top-level-type');
  });
});

describe('validateAuthorOutput — schema violations', () => {
  it('flags missing top-level keys', () => {
    const text = JSON.stringify({ agentName: 'test-author', testCases: [] });
    const result = validateAuthorOutput(text, 0);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'missing-top-level-key')).toBe(true);
  });

  it('flags confidence out of range', () => {
    const text = JSON.stringify({
      agentName: 'test-author',
      testCases: [],
      confidence: 1.5,
      notes: '',
      dependencies: [],
      risks: [],
      toolCalls: [],
      spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
      status: 'ok'
    });
    const result = validateAuthorOutput(text, 0);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'confidence-out-of-range')).toBe(true);
  });

  it('flags an invalid TestCase category', () => {
    const text = JSON.stringify({
      agentName: 'test-author',
      testCases: [
        {
          id: 'tc-1',
          title: 'x',
          category: 'wat',
          layer: 'unit',
          given: 'g',
          when: 'w',
          then: 't',
          designedBy: 'test-author',
          designedAt: 0
        }
      ],
      confidence: 0.5,
      notes: '',
      dependencies: [],
      risks: [],
      toolCalls: [],
      spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
      status: 'ok'
    });
    const result = validateAuthorOutput(text, 0);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'invalid-test-case-category')).toBe(true);
  });

  it('flags an invalid TestCase layer', () => {
    const text = JSON.stringify({
      agentName: 'test-author',
      testCases: [
        {
          id: 'tc-1',
          title: 'x',
          category: 'happy',
          layer: 'wat',
          given: 'g',
          when: 'w',
          then: 't',
          designedBy: 'test-author',
          designedAt: 0
        }
      ],
      confidence: 0.5,
      notes: '',
      dependencies: [],
      risks: [],
      toolCalls: [],
      spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
      status: 'ok'
    });
    const result = validateAuthorOutput(text, 0);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'invalid-test-case-layer')).toBe(true);
  });

  it('flags a missing required TestCase field', () => {
    const text = JSON.stringify({
      agentName: 'test-author',
      testCases: [{ id: 'tc-1', title: 'x', category: 'happy', layer: 'unit', given: 'g', when: 'w', then: '' }],
      confidence: 0.5,
      notes: '',
      dependencies: [],
      risks: [],
      toolCalls: [],
      spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
      status: 'ok'
    });
    const result = validateAuthorOutput(text, 0);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'missing-test-case-field')).toBe(true);
  });

  it('flags linkedAcceptanceCriterionIndex out of range', () => {
    const text = JSON.stringify({
      agentName: 'test-author',
      testCases: [
        {
          id: 'tc-1',
          title: 'x',
          category: 'happy',
          layer: 'unit',
          given: 'g',
          when: 'w',
          then: 't',
          linkedAcceptanceCriterionIndex: 5
        }
      ],
      confidence: 0.5,
      notes: '',
      dependencies: [],
      risks: [],
      toolCalls: [],
      spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
      status: 'ok'
    });
    const result = validateAuthorOutput(text, 3);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'invalid-linked-ac-index')).toBe(true);
  });

  it('flags too-many-test-cases when array exceeds 50', () => {
    const cases = Array.from({ length: 51 }, (_, i) => ({
      id: `tc-${i}`,
      title: 't',
      category: 'happy',
      layer: 'unit',
      given: 'g',
      when: 'w',
      then: 't'
    }));
    const text = JSON.stringify({
      agentName: 'test-author',
      testCases: cases,
      confidence: 0.5,
      notes: '',
      dependencies: [],
      risks: [],
      toolCalls: [],
      spend: { inputTokens: 0, outputTokens: 0, usdCost: 0, wallClockMs: 0, model: 'sonnet' },
      status: 'ok'
    });
    const result = validateAuthorOutput(text, 0);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.code === 'too-many-test-cases')).toBe(true);
  });
});
