import { beforeAll, describe, expect, it } from 'vitest';
import { loadPlaybook, type PlaybookIndex } from '../src/playbook-loader.js';
import { QuestionGenerator, clusterSizeForTurn, lintQuestion } from '../src/question-generator.js';
import { PILLAR_IDS } from '../src/types.js';

let playbook: PlaybookIndex;
beforeAll(async () => { playbook = await loadPlaybook(); });

function zeroCoverage(): Record<(typeof PILLAR_IDS)[number], number> {
  return Object.fromEntries(PILLAR_IDS.map((p) => [p, 0])) as Record<(typeof PILLAR_IDS)[number], number>;
}

describe('clusterSizeForTurn', () => {
  it('returns the playbook-defined cluster sizes', () => {
    const rules = playbook.bank.cluster_sizes_by_turn;
    expect(clusterSizeForTurn(1, rules).count).toBe(5);
    expect(clusterSizeForTurn(4, rules).count).toBe(4);
    expect(clusterSizeForTurn(9, rules).count).toBe(2);
    expect(clusterSizeForTurn(16, rules).count).toBe(1);
  });
});

describe('lintQuestion — Mom-Test compliance', () => {
  it('rejects would-you-buy patterns', () => {
    const fake = { ...playbook.byId.get('B5-Q01')!, question: 'Tell me would you buy this product?' };
    const r = lintQuestion(fake, playbook.bank.mom_test_rejection_patterns);
    expect(r.ok).toBe(false);
  });

  it('rejects pure single-clause yes/no with no open-ended follow-up', () => {
    const fake = { ...playbook.byId.get('B5-Q01')!, question: 'Is this product useful?' };
    const r = lintQuestion(fake, playbook.bank.mom_test_rejection_patterns);
    expect(r.ok).toBe(false);
  });

  it('accepts yes/no openers that contain an open-ended follow-up', () => {
    const fake = { ...playbook.byId.get('B5-Q01')!, question: 'Will MVP support discounts? If yes, name your discount cap.' };
    const r = lintQuestion(fake, playbook.bank.mom_test_rejection_patterns);
    expect(r.ok).toBe(true);
  });

  it('accepts the bank questions with low violation count', () => {
    let rejected = 0;
    for (const q of playbook.byId.values()) {
      const r = lintQuestion(q, playbook.bank.mom_test_rejection_patterns);
      if (!r.ok) rejected++;
    }
    expect(rejected).toBeLessThan(15);
  });
});

describe('QuestionGenerator.pick', () => {
  it('emits the cold-start fixture verbatim at turn 1', () => {
    const gen = new QuestionGenerator(playbook);
    const r = gen.pick({ turnNumber: 1, perPillarCoverage: zeroCoverage(), askedIds: new Set(), deferralCounts: {} });
    expect(r.strategy).toBe('cold_start');
    expect(r.questions.map((q) => q.question.id)).toEqual(playbook.bank.cold_start_fixture.question_ids);
  });

  it('picks foundational pillars not yet asked (turn 2)', () => {
    const gen = new QuestionGenerator(playbook);
    const r = gen.pick({
      turnNumber: 2,
      perPillarCoverage: zeroCoverage(),
      askedIds: new Set([...playbook.bank.cold_start_fixture.question_ids]),
      deferralCounts: {},
    });
    expect(r.questions.length).toBeGreaterThan(0);
  });

  it('prefers lowest-coverage pillar at depth (turn 5)', () => {
    const gen = new QuestionGenerator(playbook);
    const cov = zeroCoverage();
    cov['B2'] = 95; cov['B6'] = 95; cov['B7'] = 95; cov['B12'] = 95; cov['B4'] = 95;
    cov['B5'] = 0;
    const r = gen.pick({ turnNumber: 5, perPillarCoverage: cov, askedIds: new Set(), deferralCounts: {} });
    expect(r.questions[0]!.question.pillar).toBe('B5');
  });

  it('avoids re-asking question ids over 5 turns', () => {
    const gen = new QuestionGenerator(playbook);
    const asked = new Set<string>();
    for (let turn = 1; turn <= 5; turn++) {
      const r = gen.pick({ turnNumber: turn, perPillarCoverage: zeroCoverage(), askedIds: asked, deferralCounts: {} });
      for (const q of r.questions) {
        expect(asked.has(q.question.id)).toBe(false);
        asked.add(q.question.id);
      }
    }
    expect(asked.size).toBeGreaterThanOrEqual(13);
  });

  it('forces decisions on deferred-3x questions', () => {
    const gen = new QuestionGenerator(playbook);
    const qid = playbook.byId.get('B5-Q02')!.id;
    const r = gen.pick({ turnNumber: 8, perPillarCoverage: zeroCoverage(), askedIds: new Set(), deferralCounts: { [qid]: 3 } });
    expect(r.questions.some((p) => p.forceDecision && p.question.id === qid)).toBe(true);
  });

  it('returns 1 question per turn at narrow gap-fill (turn 20)', () => {
    const gen = new QuestionGenerator(playbook);
    const r = gen.pick({ turnNumber: 20, perPillarCoverage: zeroCoverage(), askedIds: new Set(), deferralCounts: {} });
    expect(r.strategy).toBe('narrow_gap_fill');
    expect(r.questions).toHaveLength(1);
  });

  it('always returns a non-empty transition narration', () => {
    const gen = new QuestionGenerator(playbook);
    for (const turn of [1, 3, 5, 10, 20]) {
      const r = gen.pick({ turnNumber: turn, perPillarCoverage: zeroCoverage(), askedIds: new Set(), deferralCounts: {} });
      expect(r.transitionNarration.length).toBeGreaterThan(0);
    }
  });
});
