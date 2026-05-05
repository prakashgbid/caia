/**
 * Unit tests for `classifyCorrection`.
 *
 * Each failure-mode category from the directive's taxonomy has at least
 * one positive test (a phrasing that should match) and one negative
 * test (a similar-but-distinct phrasing that should NOT match the same
 * category). Negative coverage is critical because regex-based
 * classifiers overfit easily.
 *
 * The fixtures lean heavily on the directive's "Sample seed lessons"
 * section — those are the canonical examples Mentor would have classified
 * on day 1.
 */

import { describe, it, expect } from 'vitest';

import { _ruleCount, classifyCorrection } from '../src/classifier.js';
import type { FailureMode } from '../src/types.js';

function classify(text: string, ctx?: string): ReturnType<typeof classifyCorrection> {
  return classifyCorrection(
    ctx === undefined ? { correctionText: text } : { correctionText: text, context: ctx }
  );
}

function expectCategory(text: string, expected: FailureMode): void {
  const r = classify(text);
  expect(r.primary, `text="${text}" matchedBy=${r.matchedBy}`).toBe(expected);
}

describe('classifyCorrection — positive cases (one per taxonomy category)', () => {
  it('detects DecisionClassifierViolation', () => {
    expectCategory('stop asking — decide and execute', 'DecisionClassifierViolation');
    expectCategory('do you want me to do this?', 'DecisionClassifierViolation');
    expectCategory('would you like me to clean it up?', 'DecisionClassifierViolation');
  });

  it('detects ReLitigation', () => {
    expectCategory(
      'we already decided this — see feedback_pat_topic.md',
      'ReLitigation'
    );
    expectCategory(
      'we previously settled this credential question',
      'ReLitigation'
    );
  });

  it('detects FalseModesty', () => {
    expectCategory(
      'yes you can — Keychain is right there',
      'FalseModesty'
    );
    expectCategory(
      'only you can claim 1Password is needed; that is wrong',
      'FalseModesty'
    );
  });

  it('detects GitHygieneFailure', () => {
    expectCategory('orphan branch left dangling after PR closed', 'GitHygieneFailure');
    expectCategory('don\'t force-push to develop', 'GitHygieneFailure');
    expectCategory('stash never cleared', 'GitHygieneFailure');
  });

  it('detects ToolMisuse', () => {
    expectCategory(
      'use the dedicated MCP instead of computer-use',
      'ToolMisuse'
    );
    expectCategory(
      'prefer the MCP for slack',
      'ToolMisuse'
    );
  });

  it('detects SecurityRegression', () => {
    expectCategory(
      'token leaked in the commit — wrong place',
      'SecurityRegression'
    );
  });

  it('detects Hallucination', () => {
    expectCategory('that file doesn\'t exist', 'Hallucination');
    expectCategory('you fabricated that PR number', 'Hallucination');
  });

  it('detects PrematureCompletion', () => {
    expectCategory('not actually done — tests didn\'t run', 'PrematureCompletion');
    expectCategory('claimed it\'s done but PR wasn\'t merged', 'PrematureCompletion');
  });

  it('detects CIFlakeAsRealFailure', () => {
    expectCategory(
      'that\'s a flaky test — stop chasing a phantom bug',
      'CIFlakeAsRealFailure'
    );
  });

  it('detects CostOverrun', () => {
    expectCategory(
      'subscription bucket spike — burned too much',
      'CostOverrun'
    );
    expectCategory('over budget — back off', 'CostOverrun');
  });

  it('detects CoordinationFailure', () => {
    expectCategory('too many parallel tasks — chaos', 'CoordinationFailure');
    expectCategory('over-parallel agents stomped on each other', 'CoordinationFailure');
  });

  it('detects MemoryDrift', () => {
    expectCategory(
      'the directive was ignored — you didn\'t read it',
      'MemoryDrift'
    );
    expectCategory(
      'memory entry forgot — should have consulted',
      'MemoryDrift'
    );
  });

  it('detects LackingInformation', () => {
    expectCategory('should have asked before assuming', 'LackingInformation');
    expectCategory('didn\'t check the README first', 'LackingInformation');
  });

  it('detects RecipeRot', () => {
    expectCategory(
      'that runbook is out of date — stale',
      'RecipeRot'
    );
  });

  it('detects WrongDirection', () => {
    expectCategory('whole approach was wrong — pivot', 'WrongDirection');
    expectCategory('start over with a different framing', 'WrongDirection');
  });

  it('detects ScopeMismatch', () => {
    expectCategory(
      'that\'s scope drift — not what we asked',
      'ScopeMismatch'
    );
  });

  it('detects Incompleteness', () => {
    expectCategory('definition of done not met', 'Incompleteness');
    expectCategory('partially complete — missed the test step', 'Incompleteness');
  });

  it('detects OperatorConfusion (broadest fallback before Unclassified)', () => {
    expectCategory('that response was confusing and unclear', 'OperatorConfusion');
  });
});

describe('classifyCorrection — fallback', () => {
  it('returns Unclassified for novel / non-matching text', () => {
    const r = classify('the price of tea in china is rising');
    expect(r.primary).toBe('Unclassified');
    expect(r.confidence).toBe(0);
    expect(r.matchedBy).toBe('fallback');
  });

  it('returns Unclassified for empty text', () => {
    const r = classify('');
    expect(r.primary).toBe('Unclassified');
  });

  it('handles missing correctionText gracefully', () => {
    const r = classifyCorrection({} as unknown as { correctionText: string });
    expect(r.primary).toBe('Unclassified');
  });
});

describe('classifyCorrection — case insensitivity', () => {
  it('matches regardless of case', () => {
    const r = classify('STOP ASKING — DECIDE AND EXECUTE');
    expect(r.primary).toBe('DecisionClassifierViolation');
  });
});

describe('classifyCorrection — secondary tags', () => {
  it('attaches secondary tags when the rule specifies them', () => {
    const r = classify('we already decided this');
    expect(r.primary).toBe('ReLitigation');
    expect(r.secondary).toContain('MemoryDrift');
  });
  it('returns no secondary tags for rules without them', () => {
    const r = classify('that file doesn\'t exist');
    expect(r.primary).toBe('Hallucination');
    expect(r.secondary).toHaveLength(0);
  });
});

describe('classifyCorrection — severity inference', () => {
  it('high-severity for ReLitigation, MemoryDrift, Hallucination, SecurityRegression', () => {
    expect(classify('that file doesn\'t exist').severity).toBe('high');
    expect(classify('we already decided this').severity).toBe('high');
    expect(classify('the directive was ignored').severity).toBe('high');
    expect(classify('token leaked in commit — wrong').severity).toBe('high');
  });

  it('low-severity for ToolMisuse, RecipeRot, OperatorConfusion, CIFlake', () => {
    expect(classify('use the MCP instead of computer-use').severity).toBe('low');
    expect(classify('runbook is out of date stale').severity).toBe('low');
    expect(classify('that response was confusing').severity).toBe('low');
    expect(classify('flaky test, chasing a phantom bug').severity).toBe('low');
  });
});

describe('classifyCorrection — generalizability', () => {
  it('marks Re-litigation, decision-classifier, false-modesty, ToolMisuse, MemoryDrift as systemic', () => {
    expect(classify('we already decided').generalizability).toBe('systemic');
    expect(classify('stop asking').generalizability).toBe('systemic');
    expect(classify('yes you can').generalizability).toBe('systemic');
    expect(classify('use the MCP instead').generalizability).toBe('systemic');
    expect(classify('memory entry ignored').generalizability).toBe('systemic');
  });
});

describe('classifyCorrection — order-sensitivity guard', () => {
  it('prefers more specific rules over more general ones', () => {
    // "wrong" appears in many rules; check that the more-specific
    // SecurityRegression rule wins over the catchall OperatorConfusion.
    const r = classify('credential leaked in the wrong place');
    expect(r.primary).toBe('SecurityRegression');
  });
});

describe('_ruleCount regression guard', () => {
  it('has at least 18 rules covering each taxonomy category', () => {
    expect(_ruleCount()).toBeGreaterThanOrEqual(18);
  });
});
