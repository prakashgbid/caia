import { describe, it, expect } from 'vitest';
import {
  AuditEntrySchema,
  ChildTicketArraySchema,
  ChildTicketSchema,
  DependencyEdgeSchema,
  DecompositionSchema,
  ExistingArtifactRefSchema,
  ScopeDetectionLlmOutputSchema,
  AtomicityLlmOutputSchema,
  StoryScopeSchema,
} from '../src/schemas.js';
import { STORY_SCOPES } from '../src/types.js';

const validChild = {
  id: 'c1',
  scope: 'story' as const,
  title: 'A perfectly fine title',
  description: 'A description that is long enough to pass min-length',
  inScope: ['inside scope item'],
  outOfScope: [],
  dependencies: [],
  estimatedAtomic: true,
  existingArtifacts: [],
  lifecycle: 'new' as const,
};

describe('StoryScopeSchema', () => {
  it('accepts every canonical scope', () => {
    for (const s of STORY_SCOPES) {
      expect(StoryScopeSchema.safeParse(s).success).toBe(true);
    }
  });
  it('rejects non-canonical scopes', () => {
    expect(StoryScopeSchema.safeParse('feature').success).toBe(false);
    expect(StoryScopeSchema.safeParse('').success).toBe(false);
    expect(StoryScopeSchema.safeParse(null).success).toBe(false);
  });
});

describe('ExistingArtifactRefSchema', () => {
  it('accepts a feature ref', () => {
    const r = ExistingArtifactRefSchema.safeParse({
      source: 'feature',
      id: 'feat_x',
      name: 'Feature X',
      score: 0.91,
    });
    expect(r.success).toBe(true);
  });
  it('rejects scores outside 0..1', () => {
    expect(
      ExistingArtifactRefSchema.safeParse({
        source: 'feature',
        id: 'feat_x',
        name: 'Feature X',
        score: 1.5,
      }).success,
    ).toBe(false);
  });
});

describe('ChildTicketSchema', () => {
  it('accepts a valid child', () => {
    expect(ChildTicketSchema.safeParse(validChild).success).toBe(true);
  });
  it('rejects a self-dependency', () => {
    const bad = { ...validChild, dependencies: [validChild.id] };
    expect(ChildTicketSchema.safeParse(bad).success).toBe(false);
  });
  it('rejects too-short titles', () => {
    expect(ChildTicketSchema.safeParse({ ...validChild, title: 'hi' }).success).toBe(false);
  });
  it('accepts story with acceptanceCriteria', () => {
    const r = ChildTicketSchema.safeParse({
      ...validChild,
      acceptanceCriteria: ['When the user clicks the button, the page navigates'],
    });
    expect(r.success).toBe(true);
  });
});

describe('ChildTicketArraySchema', () => {
  it('rejects siblings with duplicate ids', () => {
    const dup = ChildTicketArraySchema.safeParse([validChild, validChild]);
    expect(dup.success).toBe(false);
  });
  it('accepts unique siblings', () => {
    const ok = ChildTicketArraySchema.safeParse([
      validChild,
      { ...validChild, id: 'c2' },
    ]);
    expect(ok.success).toBe(true);
  });
});

describe('DependencyEdgeSchema', () => {
  it('rejects self-loops', () => {
    const r = DependencyEdgeSchema.safeParse({
      fromChildId: 'a',
      toChildId: 'a',
      kind: 'blocks',
      rationale: 'noop',
    });
    expect(r.success).toBe(false);
  });
  it('accepts a normal edge', () => {
    const r = DependencyEdgeSchema.safeParse({
      fromChildId: 'a',
      toChildId: 'b',
      kind: 'blocks',
      rationale: 'because-data-model-first',
    });
    expect(r.success).toBe(true);
  });
});

describe('AuditEntrySchema', () => {
  it('accepts a complete audit row', () => {
    const r = AuditEntrySchema.safeParse({
      parentNodeId: 'p1',
      parentScope: 'epic',
      childScope: 'module',
      attempt: 1,
      promptTextHash: 'abc123',
      model: 'claude-sonnet-4-6',
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      durationMs: 250,
      alternativesConsidered: 1,
      coverageScore: null,
      disjointnessScore: null,
      ambiguityDetected: false,
      questionsEmittedCount: 0,
      decisionRationale: 'first attempt OK',
      childrenCount: 3,
      outcome: 'committed',
    });
    expect(r.success).toBe(true);
  });
});

describe('DecompositionSchema', () => {
  it('accepts a minimal decomposition', () => {
    const r = DecompositionSchema.safeParse({
      childTickets: [validChild],
      clarifyingQuestions: [],
      dependencies: [],
      confidence: 0.9,
      judgeScores: { coverage: null, disjointness: null },
      audit: {
        parentNodeId: 'p',
        parentScope: 'module',
        childScope: 'story',
        attempt: 1,
        promptTextHash: 'h',
        model: 'm',
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        durationMs: 0,
        alternativesConsidered: 0,
        coverageScore: null,
        disjointnessScore: null,
        ambiguityDetected: false,
        questionsEmittedCount: 0,
        decisionRationale: '',
        childrenCount: 1,
        outcome: 'committed',
      },
    });
    expect(r.success).toBe(true);
  });
});

describe('LLM-output schemas', () => {
  it('ScopeDetectionLlmOutputSchema accepts a valid output', () => {
    const r = ScopeDetectionLlmOutputSchema.safeParse({
      targetScope: 'story',
      confidence: 0.9,
      rationale: 'one-verb-one-object',
    });
    expect(r.success).toBe(true);
  });
  it('AtomicityLlmOutputSchema accepts a valid output', () => {
    const r = AtomicityLlmOutputSchema.safeParse({
      atomic: true,
      confidence: 0.8,
      rationale: 'INVEST passes',
      failedCriteria: [],
    });
    expect(r.success).toBe(true);
  });
  it('AtomicityLlmOutputSchema rejects out-of-range confidence', () => {
    const r = AtomicityLlmOutputSchema.safeParse({
      atomic: true,
      confidence: 1.5,
      rationale: 'oops',
      failedCriteria: [],
    });
    expect(r.success).toBe(false);
  });
});
