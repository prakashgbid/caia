import { describe, it, expect } from 'vitest';
import {
  FixedCriticAdapter,
  HeuristicCriticAdapter,
  NullCriticAdapter,
} from '../src/critic.js';
import { makeTestCase } from './fixtures.js';

describe('NullCriticAdapter', () => {
  it('returns no findings regardless of input', async () => {
    const a = new NullCriticAdapter();
    expect(
      await a.judge({
        testCases: [],
        acceptanceCriteria: ['a'],
        composedArchitecture: {},
      }),
    ).toEqual([]);
  });
});

describe('FixedCriticAdapter', () => {
  it('returns its canned findings', async () => {
    const canned = [
      { testCaseId: 'tc-1', reason: 'forced', severity: 'P1' as const },
    ];
    const a = new FixedCriticAdapter(canned);
    expect(
      await a.judge({
        testCases: [],
        acceptanceCriteria: [],
        composedArchitecture: {},
      }),
    ).toEqual(canned);
  });
});

describe('HeuristicCriticAdapter', () => {
  it('returns no findings when test gwt overlaps the AC tokens', async () => {
    const a = new HeuristicCriticAdapter();
    const findings = await a.judge({
      testCases: [
        makeTestCase({
          id: 'tc-good',
          linkedAcceptanceCriterionIndex: 0,
          given: 'a registered customer',
          when: 'attempts to register again',
          then: 'a duplicate-registration error appears',
        }),
      ],
      acceptanceCriteria: ['customer registration cannot duplicate'],
      composedArchitecture: {},
    });
    expect(findings).toEqual([]);
  });

  it('flags a linked test whose gwt does not overlap the AC tokens', async () => {
    const a = new HeuristicCriticAdapter();
    const findings = await a.judge({
      testCases: [
        makeTestCase({
          id: 'tc-bad',
          linkedAcceptanceCriterionIndex: 0,
          given: 'unrelated stuff',
          when: 'nothing relevant',
          then: 'asserts something else',
        }),
      ],
      acceptanceCriteria: ['admin can revoke api credentials'],
      composedArchitecture: {},
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.testCaseId).toBe('tc-bad');
  });

  it('skips ACs with no linked tests (delegated to AC-coverage lens)', async () => {
    const a = new HeuristicCriticAdapter();
    expect(
      await a.judge({
        testCases: [],
        acceptanceCriteria: ['anything'],
        composedArchitecture: {},
      }),
    ).toEqual([]);
  });

  it('ignores ACs that tokenize to nothing (all stopwords)', async () => {
    const a = new HeuristicCriticAdapter();
    expect(
      await a.judge({
        testCases: [
          makeTestCase({ linkedAcceptanceCriterionIndex: 0 }),
        ],
        acceptanceCriteria: ['this that with from'],
        composedArchitecture: {},
      }),
    ).toEqual([]);
  });
});
