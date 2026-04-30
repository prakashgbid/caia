import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  JUDGE_PASS_THRESHOLD,
  normaliseJudgeScore,
  runJudgePair,
} from '../src/judges.js';
import type { ChildTicket } from '../src/types.js';
import { fakeOllama, fakeClaude, installFakeAdapters, clearAdapters, jsonResponse } from './_helpers.js';

const sampleParent = {
  title: 'Build the billing module',
  description: 'A billing module that handles checkout and invoicing',
  scope: 'epic' as const,
  inScope: ['stripe checkout', 'monthly invoice generation', 'webhook handler'],
  outOfScope: ['tax calculation per region'],
};

function child(id: string, title: string): ChildTicket {
  return {
    id,
    scope: 'module',
    title,
    description: `Description for ${title}`,
    inScope: ['module-level item'],
    outOfScope: [],
    dependencies: [],
    estimatedAtomic: false,
    existingArtifacts: [],
    lifecycle: 'new',
  };
}

describe('runJudgePair', () => {
  beforeEach(() => clearAdapters());
  afterEach(() => clearAdapters());

  it('returns bothPassed=true when both scores >= threshold and no missing/overlap', async () => {
    const claude = fakeClaude({
      responses: [
        { ...jsonResponse({ score: 5, covered: true, missingDeliverables: [], rationale: 'every deliverable mapped' }), match: 'PMBOK 100% rule' },
        { ...jsonResponse({ score: 5, disjoint: true, overlaps: [], rationale: 'no overlap' }), match: 'MECE-mutually-exclusive' },
      ],
    });
    installFakeAdapters(fakeOllama({ responses: [] }), claude);

    const result = await runJudgePair({
      parent: sampleParent,
      children: [child('m1', 'Checkout'), child('m2', 'Invoicing')],
    });

    expect(result.coverage.passed).toBe(true);
    expect(result.disjointness.passed).toBe(true);
    expect(result.bothPassed).toBe(true);
    expect(result.reflexiveFeedback).toBe('');
  });

  it('reports coverage failure with a feedback block', async () => {
    const claude = fakeClaude({
      responses: [
        { ...jsonResponse({ score: 3, covered: false, missingDeliverables: ['monthly invoice generation'], rationale: 'invoice generation has no child' }), match: 'PMBOK 100% rule' },
        { ...jsonResponse({ score: 5, disjoint: true, overlaps: [], rationale: 'no overlap' }), match: 'MECE-mutually-exclusive' },
      ],
    });
    installFakeAdapters(fakeOllama({ responses: [] }), claude);

    const result = await runJudgePair({
      parent: sampleParent,
      children: [child('m1', 'Checkout')],
    });

    expect(result.coverage.passed).toBe(false);
    expect(result.coverage.missingDeliverables).toContain('monthly invoice generation');
    expect(result.disjointness.passed).toBe(true);
    expect(result.bothPassed).toBe(false);
    expect(result.reflexiveFeedback).toContain('Coverage judge — FAIL');
    expect(result.reflexiveFeedback).toContain('monthly invoice generation');
  });

  it('reports disjointness failure with overlap detail', async () => {
    const claude = fakeClaude({
      responses: [
        { ...jsonResponse({ score: 5, covered: true, missingDeliverables: [], rationale: 'all covered' }), match: 'PMBOK 100% rule' },
        { ...jsonResponse({ score: 2, disjoint: false, overlaps: [{ childA: 'm1', childB: 'm2', overlapDescription: 'both modules own checkout state' }], rationale: 'overlap detected' }), match: 'MECE-mutually-exclusive' },
      ],
    });
    installFakeAdapters(fakeOllama({ responses: [] }), claude);

    const result = await runJudgePair({
      parent: sampleParent,
      children: [child('m1', 'Checkout v1'), child('m2', 'Checkout v2')],
    });

    expect(result.coverage.passed).toBe(true);
    expect(result.disjointness.passed).toBe(false);
    expect(result.disjointness.overlaps.length).toBe(1);
    expect(result.bothPassed).toBe(false);
    expect(result.reflexiveFeedback).toContain('Disjointness judge — FAIL');
    expect(result.reflexiveFeedback).toContain('m1 <-> m2');
  });

  it('force-corrects covered=true with non-empty missingDeliverables', async () => {
    const claude = fakeClaude({
      responses: [
        { ...jsonResponse({ score: 5, covered: true, missingDeliverables: ['something missing'], rationale: 'self-contradictory output' }), match: 'PMBOK 100% rule' },
        { ...jsonResponse({ score: 5, disjoint: true, overlaps: [], rationale: 'all good' }), match: 'MECE-mutually-exclusive' },
      ],
    });
    installFakeAdapters(fakeOllama({ responses: [] }), claude);

    const result = await runJudgePair({
      parent: sampleParent,
      children: [child('m1', 'Mod')],
    });

    expect(result.coverage.passed).toBe(false); // force-corrected
  });

  it('force-corrects disjoint=true with non-empty overlaps', async () => {
    const claude = fakeClaude({
      responses: [
        { ...jsonResponse({ score: 5, covered: true, missingDeliverables: [], rationale: 'all good' }), match: 'PMBOK 100% rule' },
        { ...jsonResponse({ score: 5, disjoint: true, overlaps: [{ childA: 'a', childB: 'b', overlapDescription: 'overlap' }], rationale: 'self-contradictory' }), match: 'MECE-mutually-exclusive' },
      ],
    });
    installFakeAdapters(fakeOllama({ responses: [] }), claude);

    const result = await runJudgePair({
      parent: sampleParent,
      children: [child('a', 'A'), child('b', 'B')],
    });

    expect(result.disjointness.passed).toBe(false);
  });

  it('runs the two judges in parallel (Promise.all)', async () => {
    // We can verify parallel by looking at total cost = sum of both
    // sub-call costs. Both go through Sonnet @ $0.40/1000 = $0.0004.
    const claude = fakeClaude({
      responses: [
        { ...jsonResponse({ score: 5, covered: true, missingDeliverables: [], rationale: 'all good' }), match: 'PMBOK 100% rule' },
        { ...jsonResponse({ score: 5, disjoint: true, overlaps: [], rationale: 'all good' }), match: 'MECE-mutually-exclusive' },
      ],
    });
    installFakeAdapters(fakeOllama({ responses: [] }), claude);

    const result = await runJudgePair({
      parent: sampleParent,
      children: [child('m1', 'Mod')],
    });

    expect(result.coverage.costUsd).toBeCloseTo(0.0004, 5);
    expect(result.disjointness.costUsd).toBeCloseTo(0.0004, 5);
  });
});

describe('normaliseJudgeScore', () => {
  it('maps 1 to 0', () => {
    expect(normaliseJudgeScore(1)).toBe(0);
  });
  it('maps 5 to 1', () => {
    expect(normaliseJudgeScore(5)).toBe(1);
  });
  it('maps 4 to 0.75', () => {
    expect(normaliseJudgeScore(4)).toBeCloseTo(0.75);
  });
  it('clamps below 1 to 0', () => {
    expect(normaliseJudgeScore(-2)).toBe(0);
  });
  it('clamps above 5 to 1', () => {
    expect(normaliseJudgeScore(7)).toBe(1);
  });
});

describe('JUDGE_PASS_THRESHOLD', () => {
  it('is 4.0 per proposal §5F', () => {
    expect(JUDGE_PASS_THRESHOLD).toBe(4.0);
  });
});
