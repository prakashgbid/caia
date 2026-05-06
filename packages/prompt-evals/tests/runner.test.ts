import { describe, it, expect } from 'vitest';
import { _runOneAgentForTest, _stageRawResultForTest } from '../src/runner.js';

describe('runner', () => {
  it('parses a 100% green promptfoo JSON output', () => {
    const stage = _stageRawResultForTest({
      results: {
        results: [
          { success: true, description: 'test 1' },
          { success: true, description: 'test 2' },
          { success: true, description: 'test 3' }
        ],
        stats: { successes: 3, failures: 0 }
      }
    });
    const result = _runOneAgentForTest('caia-po', '/tmp/dummy', stage.path);
    expect(result.totalTests).toBe(3);
    expect(result.passedTests).toBe(3);
    expect(result.failedTests).toBe(0);
    expect(result.passRate).toBe(1);
    expect(result.results.every((r) => r.success)).toBe(true);
  });

  it('parses a partial-failure promptfoo JSON output', () => {
    const stage = _stageRawResultForTest({
      results: {
        results: [
          { success: true, description: 'a' },
          { success: false, description: 'b', gradingResult: { reason: 'expected X got Y' } },
          { success: true, description: 'c' },
          { success: false, description: 'd', response: { error: 'boom' } }
        ],
        stats: { successes: 2, failures: 2 }
      }
    });
    const result = _runOneAgentForTest('caia-ba', '/tmp/dummy', stage.path);
    expect(result.totalTests).toBe(4);
    expect(result.passedTests).toBe(2);
    expect(result.failedTests).toBe(2);
    expect(result.passRate).toBe(0.5);
    const failed = result.results.filter((r) => !r.success);
    expect(failed[0]?.failureReason).toBe('expected X got Y');
    expect(failed[1]?.failureReason).toBe('boom');
  });

  it('uses default failure reason when both reason + error are absent', () => {
    const stage = _stageRawResultForTest({
      results: {
        results: [{ success: false, description: 'no reason' }],
        stats: { successes: 0, failures: 1 }
      }
    });
    const result = _runOneAgentForTest('caia-coding', '/tmp/dummy', stage.path);
    expect(result.results[0]?.failureReason).toBe('assertion failed');
  });

  it('handles an empty result list as 100% (vacuous)', () => {
    const stage = _stageRawResultForTest({
      results: { results: [], stats: { successes: 0, failures: 0 } }
    });
    const result = _runOneAgentForTest('caia-curator', '/tmp/dummy', stage.path);
    expect(result.totalTests).toBe(0);
    expect(result.passRate).toBe(1);
  });

  it('synthesises description when promptfoo omits it', () => {
    const stage = _stageRawResultForTest({
      results: {
        results: [{ success: true }, { success: true }],
        stats: { successes: 2, failures: 0 }
      }
    });
    const result = _runOneAgentForTest('caia-validator', '/tmp/dummy', stage.path);
    expect(result.results[0]?.description).toBe('test #0');
    expect(result.results[1]?.description).toBe('test #1');
  });

  it('omits failureReason key for successful tests (exactOptionalPropertyTypes contract)', () => {
    const stage = _stageRawResultForTest({
      results: {
        results: [{ success: true, description: 'ok' }],
        stats: { successes: 1, failures: 0 }
      }
    });
    const result = _runOneAgentForTest('caia-fix-it', '/tmp/dummy', stage.path);
    expect(Object.prototype.hasOwnProperty.call(result.results[0], 'failureReason')).toBe(false);
  });
});
