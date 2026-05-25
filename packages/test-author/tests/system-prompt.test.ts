import { describe, it, expect } from 'vitest';

import { buildTestAuthorSystemPrompt } from '../src/system-prompt.js';

const PROMPT = buildTestAuthorSystemPrompt();

describe('system prompt — role', () => {
  it('declares the Test Author identity', () => {
    expect(PROMPT).toContain('Test Author Agent');
  });

  it('declares Stage 10', () => {
    expect(PROMPT).toContain('Stage 10');
  });

  it('cites the canonical FSM pre-state ea-complete', () => {
    expect(PROMPT).toContain('ea-complete');
  });

  it('mentions distinctness from Testing Architect (PR #565)', () => {
    expect(PROMPT).toMatch(/Testing Architect/);
    expect(PROMPT).toContain('#565');
  });

  it('mentions distinctness from Test Reviewer (PR #573, Stage 11)', () => {
    expect(PROMPT).toMatch(/Test Reviewer/);
    expect(PROMPT).toContain('#573');
  });
});

describe('system prompt — consumed architecture slices', () => {
  it.each([
    'testing.testingStrategy',
    'testing.testTypeMixPercentages',
    'testing.fixturesStrategy',
    'testing.mutationTestingThresholds',
    'testing.perfRegressionBudgets',
    'testing.e2ePatterns',
    'testing.coverageThresholds',
    'testing.flakeTolerance'
  ])('references testing slice %s', slice => {
    expect(PROMPT).toContain(slice);
  });

  it.each([
    'frontend.componentTree',
    'frontend.interactionStates',
    'frontend.routeConfig',
    'backend.apiEndpoints',
    'backend.errorEnvelope',
    'database.schemaDDL',
    'a11y.wcagLevel'
  ])('references cross-architect slice %s', slice => {
    expect(PROMPT).toContain(slice);
  });
});

describe('system prompt — output schema', () => {
  it.each([
    'happy',
    'edge',
    'error',
    'accessibility',
    'security',
    'performance',
    'visual'
  ])('enumerates TestCaseCategory %s', cat => {
    expect(PROMPT).toContain(cat);
  });

  it.each(['unit', 'integration', 'e2e', 'visual', 'accessibility'])(
    'enumerates TestCaseLayer %s',
    layer => {
      expect(PROMPT).toContain(layer);
    }
  );

  it('lists the Lighthouse threshold metrics', () => {
    expect(PROMPT).toContain('Lighthouse');
    expect(PROMPT).toContain('LCP');
    expect(PROMPT).toContain('CLS');
    expect(PROMPT).toContain('TBT');
  });

  it('lists axe wcag tags', () => {
    expect(PROMPT).toContain('wcag2a');
    expect(PROMPT).toContain('wcag2aa');
  });
});

describe('system prompt — heuristics', () => {
  it('mentions pyramid balance + 100% unit anti-pattern', () => {
    expect(PROMPT).toContain('Pyramid balance');
    expect(PROMPT).toMatch(/100% unit/);
  });

  it('mentions the AC coverage floor + linkedAcceptanceCriterionIndex', () => {
    expect(PROMPT).toContain('AC coverage floor');
    expect(PROMPT).toContain('linkedAcceptanceCriterionIndex');
  });

  it('mentions the edge + error + a11y + perf floors', () => {
    expect(PROMPT).toContain('Edge floor');
    expect(PROMPT).toContain('Error floor');
    expect(PROMPT).toContain('Accessibility gate');
    expect(PROMPT).toContain('Performance gate');
  });

  it('caps total cases at 50 and floors at 3', () => {
    expect(PROMPT).toContain('50');
    expect(PROMPT).toContain('3');
  });
});
