/**
 * Zod-payload contract tests — FIX-001.
 *
 * The Phase 2 inter-agent contract is small but strict; we want
 * round-trip parses to fail on extra keys or wrong types so any
 * drift between the orchestrator's emitted payload and the worker's
 * expected payload surfaces in CI rather than at runtime.
 */

import {
  CodingCompletePayloadSchema,
  FixLoopEscalatedPayloadSchema,
  FixRequestSchema,
  TestCaseResultPayloadSchema,
  TestFailureReportSchema,
  TestedAndDonePayloadSchema,
} from '../src/types';

describe('CodingCompletePayloadSchema', () => {
  const valid = {
    storyId: 'story_1',
    workerId: 'worker_1',
    prUrl: 'https://github.com/x/y/pull/1',
    prNumber: 1,
    sha: 'abc1234',
    localTestsPassed: true,
    worktreePath: '/tmp/wt',
    codingSessionId: 'sess_1',
    completedAt: 1,
    correlationId: 'corr_1',
  };

  it('parses a well-formed payload', () => {
    expect(CodingCompletePayloadSchema.parse(valid)).toEqual(valid);
  });

  it('rejects extra fields', () => {
    expect(() =>
      CodingCompletePayloadSchema.parse({ ...valid, extra: 1 }),
    ).toThrow();
  });

  it('rejects a non-URL prUrl', () => {
    expect(() =>
      CodingCompletePayloadSchema.parse({ ...valid, prUrl: 'not a url' }),
    ).toThrow();
  });

  it('rejects a sha shorter than 7 chars', () => {
    expect(() =>
      CodingCompletePayloadSchema.parse({ ...valid, sha: 'abc' }),
    ).toThrow();
  });
});

describe('TestedAndDonePayloadSchema', () => {
  it('requires totalAttempts >= 1', () => {
    expect(() =>
      TestedAndDonePayloadSchema.parse({
        storyId: 's',
        workerId: 'w',
        allPassedAt: 1,
        totalAttempts: 0,
        finalSha: 'abc1234',
        correlationId: 'c',
      }),
    ).toThrow();
  });
});

describe('FixLoopEscalatedPayloadSchema', () => {
  it('requires at least one exhausted test case', () => {
    expect(() =>
      FixLoopEscalatedPayloadSchema.parse({
        storyId: 's',
        workerId: 'w',
        exhaustedTestCaseIds: [],
        lastFailures: [],
        escalatedAt: 1,
        correlationId: 'c',
      }),
    ).toThrow();
  });

  it('parses a well-formed escalation', () => {
    const p = FixLoopEscalatedPayloadSchema.parse({
      storyId: 's',
      workerId: 'w',
      exhaustedTestCaseIds: ['tc1'],
      lastFailures: [{ testCaseId: 'tc1', attempt: 6, errorMessage: 'boom' }],
      escalatedAt: 1,
      correlationId: 'c',
    });
    expect(p.exhaustedTestCaseIds).toEqual(['tc1']);
  });
});

describe('TestCaseResultPayloadSchema', () => {
  it('rejects an unknown status', () => {
    expect(() =>
      TestCaseResultPayloadSchema.parse({
        storyId: 's',
        testCaseId: 't',
        status: 'maybe',
        attempt: 1,
        durationMs: null,
        correlationId: 'c',
      }),
    ).toThrow();
  });

  it('parses a passed result', () => {
    const p = TestCaseResultPayloadSchema.parse({
      storyId: 's',
      testCaseId: 't',
      status: 'passed',
      attempt: 1,
      durationMs: 12,
      correlationId: 'c',
    });
    expect(p.status).toBe('passed');
  });
});

describe('TestFailureReportSchema', () => {
  it('parses a minimal report', () => {
    const r = TestFailureReportSchema.parse({
      testCaseId: 't',
      attempt: 1,
      category: 'happy',
      errorMessage: 'oops',
      errorStack: null,
      failingAssertion: null,
      artifacts: {},
      inferredCause: 'something broke',
    });
    expect(r.category).toBe('happy');
  });
});

describe('FixRequestSchema', () => {
  it('defaults preserveScopeOf to fix-only', () => {
    const r = FixRequestSchema.parse({
      storyId: 's',
      testCaseId: 't',
      attempt: 1,
      whatFailed: 'x',
      hypothesisFromDiagnoser: 'y',
      testCaseSpecPath: '/tmp/spec.ts',
    });
    expect(r.preserveScopeOf).toBe('fix-only');
    expect(r.hintFiles).toEqual([]);
  });
});
