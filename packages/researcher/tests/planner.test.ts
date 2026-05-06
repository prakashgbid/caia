import { describe, it, expect } from 'vitest';
import {
  buildPlannerPrompt,
  parsePlannerOutput,
  planResearch,
  fallbackPlan
} from '../src/planner.js';
import type { LlmClient } from '../src/types.js';

describe('buildPlannerPrompt', () => {
  it('includes query, depth, sub-question target', () => {
    const p = buildPlannerPrompt({
      query: 'should we adopt Bun?',
      depth: 'medium',
      targetSubQuestions: 5,
      precedent: []
    });
    expect(p).toContain('should we adopt Bun?');
    expect(p).toContain('medium — produce 5 sub-questions');
    expect(p).toContain('(no precedent retrieved)');
  });
  it('includes precedent excerpts when present', () => {
    const p = buildPlannerPrompt({
      query: 'X',
      depth: 'shallow',
      targetSubQuestions: 3,
      precedent: [
        { path: '/x', slug: 'feedback-bun', similarity: 0.7, excerpt: 'bun was rejected because reason Y' }
      ]
    });
    expect(p).toContain('feedback-bun');
    expect(p).toContain('similarity 0.70');
    expect(p).toContain('bun was rejected because reason Y');
  });
});

describe('parsePlannerOutput', () => {
  it('parses valid JSON', () => {
    const r = parsePlannerOutput(
      JSON.stringify({
        subQuestions: ['q1', 'q2', 'q3'],
        rationale: 'because'
      }),
      'orig',
      'medium'
    );
    expect(r.ok).toBe(true);
    expect(r.plan?.subQuestions).toEqual(['q1', 'q2', 'q3']);
    expect(r.plan?.rationale).toBe('because');
    expect(r.plan?.query).toBe('orig');
    expect(r.plan?.depth).toBe('medium');
  });
  it('handles prose-wrapped JSON', () => {
    const r = parsePlannerOutput(
      'Here is the plan:\n{"subQuestions":["a","b"]}\nThanks.',
      'orig',
      'shallow'
    );
    expect(r.ok).toBe(true);
    expect(r.plan?.subQuestions).toEqual(['a', 'b']);
  });
  it('rejects empty subQuestions', () => {
    expect(
      parsePlannerOutput(JSON.stringify({ subQuestions: [] }), 'q', 'medium').ok
    ).toBe(false);
  });
  it('rejects non-JSON', () => {
    expect(parsePlannerOutput('garbage', 'q', 'medium').ok).toBe(false);
  });
});

describe('planResearch', () => {
  it('uses LLM output when ok', async () => {
    const llm: LlmClient = {
      async complete() {
        return {
          ok: true,
          text: JSON.stringify({
            subQuestions: ['s1', 's2', 's3', 's4'],
            rationale: 'because'
          })
        };
      }
    };
    const plan = await planResearch(
      {
        query: 'q',
        depth: 'shallow',
        targetSubQuestions: 3,
        precedent: []
      },
      { llm, model: 'm', timeoutMs: 1000 }
    );
    expect(plan.subQuestions).toHaveLength(3);
    expect(plan.subQuestions).toEqual(['s1', 's2', 's3']);
  });
  it('falls back when LLM not ok', async () => {
    const llm: LlmClient = {
      async complete() {
        return { ok: false, text: '', diagnostic: 'boom' };
      }
    };
    const plan = await planResearch(
      {
        query: 'X',
        depth: 'medium',
        targetSubQuestions: 5,
        precedent: []
      },
      { llm, model: 'm', timeoutMs: 1000 }
    );
    expect(plan.subQuestions).toHaveLength(5);
    expect(plan.rationale).toContain('fallback');
  });
});

describe('fallbackPlan', () => {
  it('produces orthogonal axes', () => {
    const p = fallbackPlan({
      query: 'topic',
      depth: 'deep',
      targetSubQuestions: 8,
      precedent: []
    });
    expect(p.subQuestions).toHaveLength(8);
    expect(p.subQuestions[0]).toContain('topic');
  });
});
