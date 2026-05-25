import { describe, it, expect } from 'vitest';

import {
  AUTHOR_AGENT_ID,
  AUTHOR_CONTRACT_ID,
  AUTHOR_FAIL_INTERMEDIATE_STATE,
  AUTHOR_FAIL_STATE,
  AUTHOR_HARD_BOUNDS,
  AUTHOR_OWNED_FIELD_PATHS,
  AUTHOR_OWNED_SECTIONS,
  AUTHOR_PASS_STATE,
  AUTHOR_PRE_STATE,
  DEFAULT_MIX_PERCENTAGES,
  MIX_AXIS_TO_CATEGORY,
  MIX_AXIS_TO_LAYER,
  TestAuthorSectionContract
} from '../src/contract.js';

describe('contract — agent identity', () => {
  it('AUTHOR_AGENT_ID is the canonical "test-author" string', () => {
    expect(AUTHOR_AGENT_ID).toBe('test-author');
  });

  it('AUTHOR_CONTRACT_ID is versioned (vN-style)', () => {
    expect(AUTHOR_CONTRACT_ID).toMatch(/^test-author\.v\d+$/);
  });

  it('TestAuthorSectionContract aggregates the agent constants', () => {
    expect(TestAuthorSectionContract.agentId).toBe(AUTHOR_AGENT_ID);
    expect(TestAuthorSectionContract.contractId).toBe(AUTHOR_CONTRACT_ID);
    expect(TestAuthorSectionContract.preState).toBe(AUTHOR_PRE_STATE);
    expect(TestAuthorSectionContract.passState).toBe(AUTHOR_PASS_STATE);
    expect(TestAuthorSectionContract.failState).toBe(AUTHOR_FAIL_STATE);
  });
});

describe('contract — state-machine wiring', () => {
  it('AUTHOR_PRE_STATE is ea-complete (canonical FSM)', () => {
    expect(AUTHOR_PRE_STATE).toBe('ea-complete');
  });

  it('AUTHOR_PASS_STATE is tests-authored (canonical FSM)', () => {
    expect(AUTHOR_PASS_STATE).toBe('tests-authored');
  });

  it('AUTHOR_FAIL_STATE is tests-authoring-failed (canonical FSM)', () => {
    expect(AUTHOR_FAIL_STATE).toBe('tests-authoring-failed');
  });

  it('AUTHOR_FAIL_INTERMEDIATE_STATE chains via tests-authored', () => {
    expect(AUTHOR_FAIL_INTERMEDIATE_STATE).toBe('tests-authored');
  });
});

describe('contract — owned ticket columns', () => {
  it('declares ticket.testCases and ticket.testDesign', () => {
    expect(AUTHOR_OWNED_FIELD_PATHS).toContain('ticket.testCases');
    expect(AUTHOR_OWNED_FIELD_PATHS).toContain('ticket.testDesign');
  });

  it('does NOT claim any tickets.architecture.* paths (Test Author writes outside the architecture)', () => {
    for (const p of AUTHOR_OWNED_FIELD_PATHS) {
      expect(p.startsWith('tickets.architecture')).toBe(false);
      expect(p.startsWith('architecture.')).toBe(false);
    }
  });

  it('every owned section is required', () => {
    for (const s of AUTHOR_OWNED_SECTIONS) {
      expect(s.required).toBe(true);
    }
  });
});

describe('contract — pyramid defaults', () => {
  it('DEFAULT_MIX_PERCENTAGES sums to 100 for every declared ticket type', () => {
    for (const [type, mix] of Object.entries(DEFAULT_MIX_PERCENTAGES)) {
      const sum = mix.unit + mix.integration + mix.e2e + mix.visual + mix.a11y + mix.perf;
      expect(sum, `mix for ${type}`).toBe(100);
    }
  });

  it('MIX_AXIS_TO_LAYER maps every axis to a canonical TestCaseLayer', () => {
    const validLayers = new Set(['unit', 'integration', 'e2e', 'visual', 'accessibility']);
    for (const axis of ['unit', 'integration', 'e2e', 'visual', 'a11y', 'perf'] as const) {
      expect(validLayers.has(MIX_AXIS_TO_LAYER[axis])).toBe(true);
    }
  });

  it('MIX_AXIS_TO_CATEGORY maps every axis to a canonical TestCaseCategory', () => {
    const validCats = new Set([
      'happy',
      'edge',
      'error',
      'accessibility',
      'security',
      'performance',
      'visual'
    ]);
    for (const axis of ['unit', 'integration', 'e2e', 'visual', 'a11y', 'perf'] as const) {
      expect(validCats.has(MIX_AXIS_TO_CATEGORY[axis])).toBe(true);
    }
  });
});

describe('contract — hard bounds', () => {
  it('hard cap matches @chiefaia/ticket-template MAX_TEST_CASES (50)', () => {
    expect(AUTHOR_HARD_BOUNDS.maxCases).toBe(50);
  });

  it('soft floor is 3', () => {
    expect(AUTHOR_HARD_BOUNDS.defaultSoftFloor).toBe(3);
  });

  it('notes capped at 800 chars', () => {
    expect(AUTHOR_HARD_BOUNDS.maxNotesChars).toBe(800);
  });

  it('risks capped at 5', () => {
    expect(AUTHOR_HARD_BOUNDS.maxRisks).toBe(5);
  });
});
