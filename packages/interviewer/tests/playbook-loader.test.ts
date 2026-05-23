import { describe, expect, it } from 'vitest';

import { loadPlaybook, loadPlaybookFromObject } from '../src/playbook-loader.js';
import { InterviewerError } from '../src/errors.js';

describe('PlaybookLoader — bundled fixture', () => {
  it('loads the bundled question-templates.json from skills/playbook/', async () => {
    const idx = await loadPlaybook();
    expect(idx.bank.total_pillars).toBe(16);
    expect(idx.bank.total_questions).toBe(364);
    expect(idx.bank.pillars).toHaveLength(16);
  });

  it('indexes every question by id with no collisions', async () => {
    const idx = await loadPlaybook();
    expect(idx.byId.size).toBe(364);
    expect(idx.byId.get('B5-Q01')).toBeDefined();
    expect(idx.byId.get('B5-Q01')!.decision_mode).toBe('DECIDE');
  });

  it('indexes by pillar with question counts matching the manifest', async () => {
    const idx = await loadPlaybook();
    for (const pillar of idx.bank.pillars) {
      expect(idx.byPillar.get(pillar.id)).toHaveLength(pillar.question_count);
    }
  });

  it('indexes by decision_mode matching the published mix', async () => {
    const idx = await loadPlaybook();
    expect(idx.byDecisionMode.get('DECIDE')).toHaveLength(idx.bank.decision_mode_mix.DECIDE);
    expect(idx.byDecisionMode.get('DEFER')).toHaveLength(idx.bank.decision_mode_mix.DEFER);
  });

  it('cold-start fixture references real question ids', async () => {
    const idx = await loadPlaybook();
    for (const qid of idx.bank.cold_start_fixture.question_ids) {
      expect(idx.byId.get(qid)).toBeDefined();
    }
  });
});

describe('PlaybookLoader — error handling', () => {
  it('throws on duplicate question ids', () => {
    const bank = {
      version: 'test', schema: 'test', total_pillars: 1, total_questions: 2, operator_locked: '2026-05-23',
      pillars: [{
        id: 'B1', number: 1, name: 'X', weight: 1, subcategories: ['a'], question_count: 2,
        questions: [
          { id: 'X-Q01', pillar: 'B1', pillar_name: 'X', subcategory: 'a', question: 'q?', rationale: 'r', horizon: 'MVP', decision_mode: 'DECIDE', weight: 1, triggers_followups: [], rejects_answers: [] },
          { id: 'X-Q01', pillar: 'B1', pillar_name: 'X', subcategory: 'a', question: 'q?', rationale: 'r', horizon: 'MVP', decision_mode: 'DECIDE', weight: 1, triggers_followups: [], rejects_answers: [] },
        ],
      }],
      cluster_sizes_by_turn: [{ turn_range: [1, 999], questions_per_turn: 1, strategy: 'depth' }],
      cold_start_fixture: { turn_number: 1, question_ids: ['X-Q01'], rationale: 'r' },
      mom_test_rejection_patterns: [],
      horizon_mix: { MVP: 2, '1yr': 0, '5yr': 0 },
      decision_mode_mix: { DECIDE: 2, DEFER: 0 },
    };
    expect(() => loadPlaybookFromObject(bank)).toThrowError(InterviewerError);
  });

  it('throws on unknown pillar id', () => {
    const bank = {
      version: 'test', schema: 'test', total_pillars: 1, total_questions: 0, operator_locked: 'x',
      pillars: [{ id: 'B99', number: 99, name: 'X', weight: 1, subcategories: [], question_count: 0, questions: [] }],
      cluster_sizes_by_turn: [],
      cold_start_fixture: { turn_number: 1, question_ids: [], rationale: '' },
      mom_test_rejection_patterns: [],
      horizon_mix: { MVP: 0, '1yr': 0, '5yr': 0 },
      decision_mode_mix: { DECIDE: 0, DEFER: 0 },
    };
    expect(() => loadPlaybookFromObject(bank)).toThrowError(InterviewerError);
  });
});
