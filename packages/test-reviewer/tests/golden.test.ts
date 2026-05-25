/**
 * Golden tests — pin the exact structure of the `ReviewerDecision`
 * envelope on representative inputs. If anyone changes the shape of
 * the output, these break and force a deliberate update.
 */

import { describe, it, expect } from 'vitest';
import { review } from '../src/reviewer.js';
import { NullCriticAdapter } from '../src/critic.js';
import {
  cleanComposedArchitecture,
  cleanTestCases,
  makeTestCase,
  stubTicket,
} from './fixtures.js';

describe('golden — clean pass', () => {
  it('matches the canonical clean-pass envelope', async () => {
    const d = await review(
      {
        ticket: stubTicket({ testCases: cleanTestCases() }),
        composedArchitecture: cleanComposedArchitecture(),
      },
      { critic: new NullCriticAdapter() },
    );
    expect({
      decision: d.decision,
      finalState: d.finalState,
      rerunAuthorCount: d.rerunAuthor.length,
      advisoriesCount: d.advisories.length,
      findingsKeys: Object.keys(d.findings).sort(),
    }).toEqual({
      decision: 'pass',
      finalState: 'tests-reviewed',
      rerunAuthorCount: 0,
      advisoriesCount: 0,
      findingsKeys: [
        'acCoverage',
        'correctness',
        'edge',
        'error',
        'pyramid',
      ],
    });
  });
});

describe('golden — empty-testcases fail envelope', () => {
  it('produces exactly one rerunAuthor entry per lens that fired', async () => {
    const d = await review(
      {
        ticket: stubTicket({ testCases: [] }),
        composedArchitecture: cleanComposedArchitecture(),
      },
      { critic: new NullCriticAdapter() },
    );

    // Empty test-cases fires acCoverage. Pyramid/edge/error short-circuit
    // on empty input by design. Exactly one rerun lens: 'acCoverage'.
    const lenses = d.rerunAuthor.map((r) => r.lens).sort();
    expect(lenses).toEqual(['acCoverage']);
    expect(d.decision).toBe('fail');
    expect(d.finalState).toBe('tests-review-failed');
  });
});

describe('golden — pyramid fail envelope', () => {
  it('shape on a 100% e2e suite', async () => {
    const ticket = stubTicket({
      testCases: [
        makeTestCase({
          id: 'e1',
          category: 'happy',
          layer: 'e2e',
          linkedAcceptanceCriterionIndex: 0,
        }),
        makeTestCase({
          id: 'e2',
          category: 'happy',
          layer: 'e2e',
          linkedAcceptanceCriterionIndex: 1,
        }),
        makeTestCase({ id: 'e3', category: 'edge', layer: 'e2e' }),
        makeTestCase({ id: 'e4', category: 'error', layer: 'e2e' }),
        makeTestCase({ id: 'e5', category: 'accessibility', layer: 'e2e' }),
      ],
    });
    const d = await review(
      { ticket, composedArchitecture: cleanComposedArchitecture() },
      { critic: new NullCriticAdapter() },
    );
    expect(d.decision).toBe('fail');
    expect(d.rerunAuthor.some((r) => r.lens === 'pyramid')).toBe(true);
    expect(
      d.rerunAuthor.every((r) => r.severity === 'P0' || r.severity === 'P1'),
    ).toBe(true);
  });
});

describe('golden — every rerun directive targets test-author', () => {
  it('agent field is always "test-author"', async () => {
    const d = await review(
      {
        ticket: stubTicket({ testCases: [] }),
        composedArchitecture: cleanComposedArchitecture(),
      },
      { critic: new NullCriticAdapter() },
    );
    expect(d.rerunAuthor.every((r) => r.agent === 'test-author')).toBe(true);
  });
});

describe('golden — overfill advisory shape', () => {
  it('overfill pyramid finding lands in advisories with testing-architect agent', async () => {
    // 23-case suite tuned so the integration layer overshoots its target.
    //   9 unit (39.1%): 2 happy linked AC#0+#1, 3 happy, 3 edge, 1 error
    //   10 integration happy (43.5%) → over-fill threshold 41% → fires
    //   2 e2e happy (8.7%) — within range
    //   1 visual (4.3%) — meets ~5% target
    //   1 accessibility (4.3%) — covers WCAG floor (a11y target 3% expected
    //     0.7 < 1 → skipped from over-fill check)
    // unit-floor (30%) cleared; edge ratio (ceil(23/10)=3) met; one error;
    // one accessibility.
    const cases = [
      makeTestCase({ id: 'u1', category: 'happy', layer: 'unit', linkedAcceptanceCriterionIndex: 0 }),
      makeTestCase({ id: 'u2', category: 'happy', layer: 'unit', linkedAcceptanceCriterionIndex: 1 }),
      makeTestCase({ id: 'u3', category: 'happy', layer: 'unit' }),
      makeTestCase({ id: 'u4', category: 'happy', layer: 'unit' }),
      makeTestCase({ id: 'u5', category: 'happy', layer: 'unit' }),
      makeTestCase({ id: 'u6', category: 'edge', layer: 'unit' }),
      makeTestCase({ id: 'u7', category: 'edge', layer: 'unit' }),
      makeTestCase({ id: 'u8', category: 'edge', layer: 'unit' }),
      makeTestCase({ id: 'u9', category: 'error', layer: 'unit' }),
      makeTestCase({ id: 'i1', category: 'happy', layer: 'integration' }),
      makeTestCase({ id: 'i2', category: 'happy', layer: 'integration' }),
      makeTestCase({ id: 'i3', category: 'happy', layer: 'integration' }),
      makeTestCase({ id: 'i4', category: 'happy', layer: 'integration' }),
      makeTestCase({ id: 'i5', category: 'happy', layer: 'integration' }),
      makeTestCase({ id: 'i6', category: 'happy', layer: 'integration' }),
      makeTestCase({ id: 'i7', category: 'happy', layer: 'integration' }),
      makeTestCase({ id: 'i8', category: 'happy', layer: 'integration' }),
      makeTestCase({ id: 'i9', category: 'happy', layer: 'integration' }),
      makeTestCase({ id: 'i10', category: 'happy', layer: 'integration' }),
      makeTestCase({ id: 'e1', category: 'happy', layer: 'e2e' }),
      makeTestCase({ id: 'e2', category: 'happy', layer: 'e2e' }),
      makeTestCase({ id: 'v1', category: 'visual', layer: 'visual' }),
      makeTestCase({ id: 'a1', category: 'accessibility', layer: 'accessibility' }),
    ];
    const ticket = stubTicket({ testCases: cases });
    const d = await review(
      { ticket, composedArchitecture: cleanComposedArchitecture() },
      { critic: new NullCriticAdapter() },
    );
    const overfill = d.advisories.find(
      (a) => a.lens === 'pyramid' && a.agent === 'testing-architect',
    );
    expect(overfill).toBeDefined();
    expect(d.decision).toBe('pass');
  });
});
