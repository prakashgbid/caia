import { describe, expect, it } from 'vitest';
import {
  businessPlanV2Schema,
  citationSchema,
  emptyBusinessPlan,
  getSection,
  openUnknownSchema,
  rubricScoresSchema,
  sectionSchema,
  setSection,
} from '../src/business-plan.js';
import { BUSINESS_PLAN_SECTIONS, PILLAR_IDS, RUBRIC_DIMENSIONS } from '../src/types.js';

describe('emptyBusinessPlan', () => {
  it('initializes all sections empty', () => {
    const p = emptyBusinessPlan({ interviewId: '00000000-0000-0000-0000-000000000001', operatorEmail: 'op@example.com' });
    for (const k of BUSINESS_PLAN_SECTIONS) {
      expect(getSection(p, k).content).toBe('');
      expect(getSection(p, k).confidence).toBe(0);
    }
  });
  it('initializes rubric to 1s and 0', () => {
    const p = emptyBusinessPlan({ interviewId: '00000000-0000-0000-0000-000000000002', operatorEmail: 'op@example.com' });
    expect(p.rubricScores.aggregateScore).toBe(0);
    for (const d of RUBRIC_DIMENSIONS) expect(p.rubricScores.dimensions[d]).toBe(1);
    for (const pid of PILLAR_IDS) expect(p.rubricScores.perPillarCoverage[pid]).toBe(0);
  });
});

describe('zod schemas', () => {
  it('empty plan parses', () => {
    const p = emptyBusinessPlan({ interviewId: '00000000-0000-0000-0000-000000000003', operatorEmail: 'op@example.com' });
    expect(businessPlanV2Schema.safeParse(p).success).toBe(true);
  });
  it('section requires fields', () => {
    expect(sectionSchema.safeParse({ content: 'x', confidence: 50, decisionedAtTurn: 3 }).success).toBe(true);
    expect(sectionSchema.safeParse({ confidence: 50 }).success).toBe(false);
  });
  it('citation needs URL', () => {
    expect(citationSchema.safeParse({ url: 'https://x.com', title: 't' }).success).toBe(true);
    expect(citationSchema.safeParse({ url: 'not-a-url', title: '' }).success).toBe(false);
  });
  it('openUnknown reasons', () => {
    for (const reason of ['founder_doesnt_know', 'deferred_3x', 'rubric_clamp', 'operator_force_close']) {
      expect(openUnknownSchema.safeParse({ pillar: 'B5', question_id: 'B5-Q01', question: 'q', blocking: false, reason }).success).toBe(true);
    }
  });
  it('rubric clamps dimensions', () => {
    const ok = rubricScoresSchema.safeParse({ perPillarCoverage: { B1: 80 }, dimensions: Object.fromEntries(RUBRIC_DIMENSIONS.map((d) => [d, 4])), aggregateScore: 80 });
    expect(ok.success).toBe(true);
    const bad = rubricScoresSchema.safeParse({ perPillarCoverage: {}, dimensions: { specificity: 99 }, aggregateScore: 80 });
    expect(bad.success).toBe(false);
  });
});

describe('getSection / setSection', () => {
  it('round-trips immutably', () => {
    const p = emptyBusinessPlan({ interviewId: '00000000-0000-0000-0000-000000000004', operatorEmail: 'op@example.com' });
    const u = setSection(p, 'problemStatement', { content: 'new', confidence: 75, decisionedAtTurn: 5 });
    expect(getSection(u, 'problemStatement').content).toBe('new');
    expect(getSection(p, 'problemStatement').content).toBe('');
  });
});
