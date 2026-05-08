import { describe, expect, it } from 'vitest';

import { scoreOne } from '../src/rubric-scorer.js';
import type { PromptSuite, SuiteTestCase } from '../src/types.js';

function suite(): PromptSuite {
  return {
    id: 'fix',
    description: 'fixture',
    tests: [],
    sourcePath: '/fix.yaml'
  };
}

function tc(assert: SuiteTestCase['assert']): SuiteTestCase {
  return {
    id: 't',
    description: 't',
    vars: { prompt: 'p' },
    assert
  };
}

describe('scoreOne — assertion types', () => {
  it('contains: pass + fail', async () => {
    const r1 = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'contains', value: 'foo' }]),
      adapter: 'a',
      output: 'foo bar'
    });
    expect(r1.passed).toBe(1);
    expect(r1.weightedScore).toBe(1);
    const r2 = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'contains', value: 'baz' }]),
      adapter: 'a',
      output: 'foo bar'
    });
    expect(r2.failed).toBe(1);
    expect(r2.assertions[0]!.reason).toMatch(/missing substring/);
  });

  it('not-contains: pass + fail', async () => {
    const pass = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'not-contains', value: 'force-push' }]),
      adapter: 'a',
      output: 'use squash'
    });
    expect(pass.passed).toBe(1);
    const fail = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'not-contains', value: 'force-push' }]),
      adapter: 'a',
      output: 'use force-push'
    });
    expect(fail.failed).toBe(1);
  });

  it('regex: pass, fail, invalid', async () => {
    const pass = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'regex', value: 'fo+' }]),
      adapter: 'a',
      output: 'foooo'
    });
    expect(pass.passed).toBe(1);
    const fail = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'regex', value: '^xyz$' }]),
      adapter: 'a',
      output: 'foo'
    });
    expect(fail.failed).toBe(1);
    const invalid = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'regex', value: '(' }]),
      adapter: 'a',
      output: 'whatever'
    });
    expect(invalid.failed).toBe(1);
    expect(invalid.assertions[0]!.reason).toMatch(/invalid regex/);
  });

  it('equals: trims both sides', async () => {
    const pass = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'equals', value: '  hello  ' }]),
      adapter: 'a',
      output: 'hello'
    });
    expect(pass.passed).toBe(1);
  });

  it('javascript: passes truthy, fails falsy + thrown', async () => {
    const pass = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'javascript', value: 'output.length > 2' }]),
      adapter: 'a',
      output: 'foo'
    });
    expect(pass.passed).toBe(1);
    const fail = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'javascript', value: 'output.length > 100' }]),
      adapter: 'a',
      output: 'foo'
    });
    expect(fail.failed).toBe(1);
    const thrown = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'javascript', value: 'output.does.not.exist.fail' }]),
      adapter: 'a',
      output: 'foo'
    });
    expect(thrown.failed).toBe(1);
    expect(thrown.assertions[0]!.reason).toMatch(/threw/);
  });

  it('semantic-similarity: requires a scorer', async () => {
    const r = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'semantic-similarity', value: 'x', threshold: 0.5 }]),
      adapter: 'a',
      output: 'x'
    });
    expect(r.failed).toBe(1);
    expect(r.assertions[0]!.reason).toMatch(/no semanticScorer configured/);
  });

  it('semantic-similarity: passes when cosine ≥ threshold', async () => {
    const scorer = { similarity: async () => 0.9 };
    const r = await scoreOne({
      suite: suite(),
      test: tc([{ type: 'semantic-similarity', value: 'x', threshold: 0.5 }]),
      adapter: 'a',
      output: 'y',
      semanticScorer: scorer
    });
    expect(r.passed).toBe(1);
    expect(r.assertions[0]!.score).toBe(0.9);
  });
});

describe('scoreOne — weighted scoring', () => {
  it('weights influence the weightedScore', async () => {
    const r = await scoreOne({
      suite: suite(),
      test: tc([
        { type: 'contains', value: 'a', weight: 3 },
        { type: 'contains', value: 'missing', weight: 1 }
      ]),
      adapter: 'a',
      output: 'a b c'
    });
    // first hits (weight 3), second misses (weight 1) → 3/4
    expect(r.weightedScore).toBeCloseTo(0.75);
    expect(r.passed).toBe(1);
    expect(r.failed).toBe(1);
  });

  it('zero assertions → weightedScore 0', async () => {
    const r = await scoreOne({
      suite: suite(),
      test: tc([]),
      adapter: 'a',
      output: 'whatever'
    });
    expect(r.weightedScore).toBe(0);
  });
});
