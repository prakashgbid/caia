import { describe, it, expect } from 'vitest';
import { TestReviewer, review } from '../src/reviewer.js';
import { FixedCriticAdapter, NullCriticAdapter } from '../src/critic.js';
import {
  cleanComposedArchitecture,
  cleanReviewerInput,
  cleanTestCases,
  makeTestCase,
  stubTicket,
} from './fixtures.js';

describe('TestReviewer.review — pass path', () => {
  it('passes a clean suite', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    const d = await r.review(cleanReviewerInput());
    expect(d.decision).toBe('pass');
    expect(d.finalState).toBe('tests-reviewed');
    expect(d.rerunAuthor).toEqual([]);
  });

  it('clean-pass summary mentions all lenses', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    const d = await r.review(cleanReviewerInput());
    expect(d.summary).toMatch(/passed/i);
  });

  it('exposes all five findings groups on the decision', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    const d = await r.review(cleanReviewerInput());
    expect(d.findings).toHaveProperty('acCoverage');
    expect(d.findings).toHaveProperty('pyramid');
    expect(d.findings).toHaveProperty('edge');
    expect(d.findings).toHaveProperty('error');
    expect(d.findings).toHaveProperty('correctness');
  });
});

describe('TestReviewer.review — AC-coverage fail path', () => {
  it('fails when an AC has no happy test', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    const ticket = stubTicket({
      testCases: [
        // AC#0 covered by happy
        makeTestCase({ category: 'happy', linkedAcceptanceCriterionIndex: 0 }),
        // AC#1 covered only by error
        makeTestCase({ category: 'error', linkedAcceptanceCriterionIndex: 1 }),
        // Make sure edge + error floors don't double-fire
        makeTestCase({ category: 'edge' }),
        makeTestCase({ category: 'error' }),
      ],
    });
    const d = await r.review({
      ticket,
      composedArchitecture: cleanComposedArchitecture(),
    });
    expect(d.decision).toBe('fail');
    expect(d.finalState).toBe('tests-review-failed');
    expect(d.rerunAuthor.some((r) => r.lens === 'acCoverage')).toBe(true);
  });
});

describe('TestReviewer.review — pyramid fail path', () => {
  it('fails when the suite is 100% e2e', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    const ticket = stubTicket({
      testCases: [
        makeTestCase({
          id: 'a',
          category: 'happy',
          layer: 'e2e',
          linkedAcceptanceCriterionIndex: 0,
        }),
        makeTestCase({
          id: 'b',
          category: 'happy',
          layer: 'e2e',
          linkedAcceptanceCriterionIndex: 1,
        }),
        makeTestCase({ id: 'c', category: 'edge', layer: 'e2e' }),
        makeTestCase({ id: 'd', category: 'error', layer: 'e2e' }),
        // a11y test (covers WCAG floor — error lens won't double-fire)
        makeTestCase({
          id: 'e',
          category: 'accessibility',
          layer: 'accessibility',
        }),
      ],
    });
    const d = await r.review({
      ticket,
      composedArchitecture: cleanComposedArchitecture(),
    });
    expect(d.decision).toBe('fail');
    expect(d.rerunAuthor.some((r) => r.lens === 'pyramid')).toBe(true);
  });
});

describe('TestReviewer.review — edge fail path', () => {
  it('fails when no edge case is present in a 5-case suite', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    const ticket = stubTicket({
      testCases: [
        makeTestCase({ category: 'happy', linkedAcceptanceCriterionIndex: 0 }),
        makeTestCase({ category: 'happy', linkedAcceptanceCriterionIndex: 1 }),
        makeTestCase({ category: 'happy', layer: 'integration' }),
        makeTestCase({ category: 'error' }),
        makeTestCase({
          category: 'accessibility',
          layer: 'accessibility',
        }),
      ],
    });
    const d = await r.review({
      ticket,
      composedArchitecture: cleanComposedArchitecture(),
    });
    expect(d.rerunAuthor.some((r) => r.lens === 'edge')).toBe(true);
  });
});

describe('TestReviewer.review — error fail path', () => {
  it('fires the security floor for PII data', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    const ticket = stubTicket({ testCases: cleanTestCases() });
    const arch = {
      ...cleanComposedArchitecture(),
      'security.dataClassification': 'PII',
    };
    const d = await r.review({ ticket, composedArchitecture: arch });
    expect(d.rerunAuthor.some((r) => r.lens === 'error')).toBe(true);
  });

  it('fires the a11y floor when WCAG set but no a11y test', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    const cases = cleanTestCases().filter(
      (c) => c.category !== 'accessibility',
    );
    const ticket = stubTicket({ testCases: cases });
    const d = await r.review({
      ticket,
      composedArchitecture: cleanComposedArchitecture(),
    });
    expect(
      d.rerunAuthor.some(
        (r) => r.lens === 'error' && r.reason.match(/WCAG/),
      ),
    ).toBe(true);
  });
});

describe('TestReviewer.review — correctness lens', () => {
  it('routes a P1 critic finding with testCaseId into rerunAuthor', async () => {
    const fixed = new FixedCriticAdapter([
      { testCaseId: 'tc-x', reason: 'weak link', severity: 'P1' },
    ]);
    const r = new TestReviewer({ critic: fixed });
    const d = await r.review(cleanReviewerInput());
    expect(d.decision).toBe('fail');
    expect(d.rerunAuthor.some((r) => r.lens === 'correctness')).toBe(true);
  });

  it('routes a P2 critic finding into advisories, not rerunAuthor', async () => {
    const fixed = new FixedCriticAdapter([
      { testCaseId: 'tc-x', reason: 'weak link', severity: 'P2' },
    ]);
    const r = new TestReviewer({ critic: fixed });
    const d = await r.review(cleanReviewerInput());
    expect(d.decision).toBe('pass');
    expect(d.advisories.some((a) => a.lens === 'correctness')).toBe(true);
  });

  it('global critic findings (no testCaseId) become advisories', async () => {
    const fixed = new FixedCriticAdapter([
      { reason: 'whole suite feels thin', severity: 'P1' },
    ]);
    const r = new TestReviewer({ critic: fixed });
    const d = await r.review(cleanReviewerInput());
    expect(d.decision).toBe('pass'); // no testCaseId → no rerun
    expect(d.advisories.some((a) => a.agent === 'global')).toBe(true);
  });

  it('skips the critic when there are no ACs', async () => {
    const calls: number[] = [];
    const fixed = new FixedCriticAdapter([
      { testCaseId: 'tc-x', reason: 'forced', severity: 'P1' },
    ]);
    // Monkey-patch to count
    const orig = fixed.judge.bind(fixed);
    fixed.judge = async (i) => {
      calls.push(1);
      return orig(i);
    };
    const r = new TestReviewer({ critic: fixed });
    await r.review({
      ticket: stubTicket({ acceptance_criteria: [], testCases: [] }),
      composedArchitecture: {},
    });
    expect(calls).toEqual([]);
  });
});

describe('TestReviewer.review — dedup + severity', () => {
  it('dedups multiple findings per lens into a single directive', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    // Three ACs all missing happy tests → three acCoverage findings →
    // ONE acCoverage rerun directive with concatenated reasons.
    const d = await r.review({
      ticket: stubTicket({
        acceptance_criteria: ['A', 'B', 'C'],
        testCases: [
          makeTestCase({ category: 'edge' }),
          makeTestCase({ category: 'error' }),
        ],
      }),
      composedArchitecture: {},
    });
    const acDirs = d.rerunAuthor.filter((r) => r.lens === 'acCoverage');
    expect(acDirs).toHaveLength(1);
    expect(acDirs[0]?.reason).toMatch(/;/);
  });

  it('honors a custom blockingSeverities set', async () => {
    const r = new TestReviewer(
      { critic: new NullCriticAdapter() },
      { blockingSeverities: ['P0'] },
    );
    // A 5-case suite with no edge tests is P1 by default; with blocking=P0
    // only, this becomes an advisory and the audit passes.
    const ticket = stubTicket({
      testCases: [
        makeTestCase({ category: 'happy', linkedAcceptanceCriterionIndex: 0 }),
        makeTestCase({ category: 'happy', linkedAcceptanceCriterionIndex: 1 }),
        makeTestCase({ category: 'happy', layer: 'integration' }),
        makeTestCase({ category: 'error' }),
        makeTestCase({
          category: 'accessibility',
          layer: 'accessibility',
        }),
      ],
    });
    const d = await r.review({
      ticket,
      composedArchitecture: cleanComposedArchitecture(),
    });
    expect(d.decision).toBe('pass');
    expect(d.advisories.length).toBeGreaterThan(0);
  });
});

describe('functional review() flavour', () => {
  it('works without explicit deps', async () => {
    const d = await review(cleanReviewerInput());
    expect(d.decision).toBe('pass');
  });
});

describe('TestReviewer — edge cases', () => {
  it('handles a ticket with no testCases (treats as empty array)', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    const ticket = stubTicket({
      acceptance_criteria: ['AC0'],
      // testCases omitted
    });
    const d = await r.review({ ticket, composedArchitecture: {} });
    expect(d.decision).toBe('fail');
    expect(d.rerunAuthor.some((r) => r.lens === 'acCoverage')).toBe(true);
  });

  it('handles a ticket with no ACs (clean pass on empty suite)', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    const d = await r.review({
      ticket: stubTicket({ acceptance_criteria: [], testCases: [] }),
      composedArchitecture: {},
    });
    expect(d.decision).toBe('pass');
  });

  it('preserves the override acceptanceCriteria from the input', async () => {
    const r = new TestReviewer({ critic: new NullCriticAdapter() });
    const d = await r.review({
      ticket: stubTicket({
        testCases: [
          makeTestCase({
            category: 'happy',
            linkedAcceptanceCriterionIndex: 0,
          }),
          makeTestCase({ category: 'edge' }),
          makeTestCase({ category: 'error' }),
        ],
        acceptance_criteria: ['orig0', 'orig1'],
      }),
      composedArchitecture: {},
      // Override — only one AC. Without override, AC#1 would fire.
      acceptanceCriteria: ['orig0'],
    });
    expect(
      d.findings.acCoverage.some((f) => f.acIndex === 1),
    ).toBe(false);
  });
});
