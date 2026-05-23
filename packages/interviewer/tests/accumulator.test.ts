import { describe, expect, it } from 'vitest';

import {
  BusinessPlanAccumulator,
  aggregateRubric,
  mergeDimensions,
  pillarCoverage,
  pillarFloorReport,
  specificityScore,
} from '../src/accumulator.js';
import { emptyBusinessPlan } from '../src/business-plan.js';
import { loadPlaybook } from '../src/playbook-loader.js';
import { PILLAR_IDS, RUBRIC_DIMENSIONS } from '../src/types.js';

describe('specificityScore', () => {
  it('scores empty strings as 1', () => {
    expect(specificityScore('')).toBe(1);
    expect(specificityScore('   ')).toBe(1);
  });

  it('scores generic prose low', () => {
    const s = specificityScore('We help modern professionals be more productive in their daily work and meetings.');
    expect(s).toBeLessThanOrEqual(2);
  });

  it('scores anchor-rich prose high', () => {
    const s = specificityScore(
      'Mid-market HR leaders at 200-1000 employee companies in the US and EU. Annual budget $50,000. We compare against Vanta (vanta.com) and Drata (drata.com). North-star metric: 100 weekly active users by week 6.',
    );
    expect(s).toBeGreaterThanOrEqual(4);
  });

  it('scales between 1 and 5', () => {
    const scores = [
      'a b c',
      'A short sentence with some content.',
      'In 2026, our SOC2 compliance tool serves 200 customers and runs at 78% gross margin.',
    ].map(specificityScore);
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(5);
    }
  });
});

describe('pillarCoverage formula', () => {
  it('returns 0 for no decided answers and no content', () => {
    const c = pillarCoverage({
      pillarId: 'B1',
      totalRequired: 10,
      decided: [],
      sections: [{ content: '' }],
    });
    expect(c).toBe(0);
  });

  it('weights 40% required, 40% confidence, 20% specificity', () => {
    const full = pillarCoverage({
      pillarId: 'B1',
      totalRequired: 1,
      decided: [{ questionId: 'X', pillarId: 'B1', confidence: 100, turnNumber: 1 }],
      sections: [
        {
          content:
            'Mid-market HR leaders at 200-1000 employee companies in US/EU. Pricing: $29 per user per month with public list pricing on vanta.com/drata.com.',
        },
      ],
    });
    expect(full).toBeGreaterThanOrEqual(75);
  });

  it('returns at most 100', () => {
    const c = pillarCoverage({
      pillarId: 'B1',
      totalRequired: 1,
      decided: [{ questionId: 'X', pillarId: 'B1', confidence: 100, turnNumber: 1 }],
      sections: [{ content: 'long anchored prose with $500K and stripe.com' }],
    });
    expect(c).toBeLessThanOrEqual(100);
  });
});

describe('mergeDimensions / aggregateRubric', () => {
  it('keeps deterministic specificity over LLM-supplied value', () => {
    const merged = mergeDimensions({ specificity: 1 }, 4.5);
    expect(merged.specificity).toBe(4.5);
  });

  it('clamps LLM dimensions to 1-5', () => {
    const merged = mergeDimensions({ buildability: 7, riskAwareness: -3 }, 3);
    expect(merged.buildability).toBe(5);
    expect(merged.riskAwareness).toBe(1);
  });

  it('weighted aggregate is 0 when all 1s and ~100 when all 5s', () => {
    const ones = Object.fromEntries(RUBRIC_DIMENSIONS.map((d) => [d, 1])) as Record<(typeof RUBRIC_DIMENSIONS)[number], number>;
    const fives = Object.fromEntries(RUBRIC_DIMENSIONS.map((d) => [d, 5])) as Record<(typeof RUBRIC_DIMENSIONS)[number], number>;
    expect(aggregateRubric(ones)).toBe(0);
    expect(aggregateRubric(fives)).toBe(100);
  });

  it('aggregate at all-3s is 50', () => {
    const threes = Object.fromEntries(RUBRIC_DIMENSIONS.map((d) => [d, 3])) as Record<(typeof RUBRIC_DIMENSIONS)[number], number>;
    expect(aggregateRubric(threes)).toBe(50);
  });
});

describe('pillarFloorReport', () => {
  it('passes when every pillar at or above threshold', () => {
    const cov = Object.fromEntries(PILLAR_IDS.map((p) => [p, 80])) as Record<(typeof PILLAR_IDS)[number], number>;
    const r = pillarFloorReport(cov, 75);
    expect(r.pass).toBe(true);
    expect(r.underflow).toEqual([]);
  });

  it('reports underflow pillars when any below threshold', () => {
    const cov = Object.fromEntries(PILLAR_IDS.map((p) => [p, 80])) as Record<(typeof PILLAR_IDS)[number], number>;
    cov['B1'] = 50;
    cov['B5'] = 60;
    const r = pillarFloorReport(cov, 75);
    expect(r.pass).toBe(false);
    expect(r.underflow.map((u) => u.pillar)).toContain('B1');
    expect(r.underflow.map((u) => u.pillar)).toContain('B5');
  });
});

describe('BusinessPlanAccumulator integration', () => {
  it('applies updates and propagates to the right sections', async () => {
    const playbook = await loadPlaybook();
    const plan = emptyBusinessPlan({
      interviewId: '00000000-0000-0000-0000-000000000001',
      operatorEmail: 'test@example.com',
    });
    const acc = new BusinessPlanAccumulator(plan, playbook);

    acc.applyUpdate({
      questionId: 'B5-Q01',
      pillarId: 'B5',
      answerSummary: 'Customers describe the problem as compliance-evidence sprawl across 7 tools costing 40 hours per quarter.',
      confidence: 80,
      turnNumber: 1,
    });

    const updated = acc.getPlan();
    expect((updated as any).problemStatement.content).toContain('compliance-evidence');
    expect((updated as any).problemStatement.confidence).toBeGreaterThan(0);
    expect(acc.isDecided('B5-Q01')).toBe(true);
  });

  it('refreshRubric merges deterministic specificity with LLM dims', async () => {
    const playbook = await loadPlaybook();
    const plan = emptyBusinessPlan({
      interviewId: '00000000-0000-0000-0000-000000000002',
      operatorEmail: 'test@example.com',
    });
    const acc = new BusinessPlanAccumulator(plan, playbook);
    const rubric = acc.refreshRubric({ buildability: 5, investability: 4, audienceFocus: 3 });
    expect(rubric.dimensions.buildability).toBe(5);
    expect(rubric.dimensions.investability).toBe(4);
    expect(rubric.dimensions.audienceFocus).toBe(3);
    expect(rubric.dimensions.specificity).toBeGreaterThanOrEqual(1);
    expect(rubric.aggregateScore).toBeGreaterThanOrEqual(0);
    expect(rubric.aggregateScore).toBeLessThanOrEqual(100);
  });

  it('throws on unknown question id', async () => {
    const playbook = await loadPlaybook();
    const plan = emptyBusinessPlan({
      interviewId: '00000000-0000-0000-0000-000000000003',
      operatorEmail: 'test@example.com',
    });
    const acc = new BusinessPlanAccumulator(plan, playbook);
    expect(() =>
      acc.applyUpdate({ questionId: 'NOPE-Q99', pillarId: 'B5', answerSummary: 'x', confidence: 50, turnNumber: 1 }),
    ).toThrowError();
  });

  it('updates are idempotent on the same question id', async () => {
    const playbook = await loadPlaybook();
    const plan = emptyBusinessPlan({
      interviewId: '00000000-0000-0000-0000-000000000004',
      operatorEmail: 'test@example.com',
    });
    const acc = new BusinessPlanAccumulator(plan, playbook);
    acc.applyUpdate({ questionId: 'B5-Q01', pillarId: 'B5', answerSummary: 'First answer.', confidence: 70, turnNumber: 1 });
    acc.applyUpdate({ questionId: 'B5-Q01', pillarId: 'B5', answerSummary: 'First answer.', confidence: 80, turnNumber: 2 });
    const decided = acc.getDecided('B5');
    expect(decided.filter((d) => d.questionId === 'B5-Q01')).toHaveLength(1);
  });
});
