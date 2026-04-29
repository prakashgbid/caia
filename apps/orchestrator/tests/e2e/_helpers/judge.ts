/**
 * Deterministic JudgeAdapter stubs for the regression suite.
 *
 * The Story Validator's content-relevance / cross-section /
 * completeness steps delegate to a pluggable JudgeAdapter (defaults
 * to localLlmRouterJudge in production). For an in-process
 * regression test we inject a deterministic stub so the test runs
 * without an Ollama or Claude API dependency.
 *
 * Three flavors:
 *   - alwaysPass — every judge call returns score=5, no concerns.
 *     Use for the happy-path tests where validator signal isn't
 *     under test.
 *   - alwaysFail — every judge call returns score=1, with concerns.
 *     Forces the validator to escalate after maxAttempts retries —
 *     used by the validator-rejection-recovery test.
 *   - alternating — first N calls return failure, then success. Used
 *     by the BA-collab-recovery test to model the validator failing
 *     on attempt 1 and passing on attempt 2.
 */

import type { JudgeAdapter, JudgeResponse } from '../../../src/agents/story-validator-agent';

function passResponse(): JudgeResponse {
  return {
    json: { score: 5, concerns: [], strengths: ['stub: passes by design'] },
    raw: '{"score":5,"concerns":[]}',
    provider: 'local',
    model: 'stub-pass',
    durationMs: 0,
  };
}

function failResponse(reason: string): JudgeResponse {
  return {
    json: {
      score: 1,
      concerns: [reason],
      strengths: [],
    },
    raw: `{"score":1,"concerns":["${reason}"]}`,
    provider: 'local',
    model: 'stub-fail',
    durationMs: 0,
  };
}

export function makeAlwaysPassJudge(): JudgeAdapter {
  return {
    async judge() {
      return passResponse();
    },
  };
}

export function makeAlwaysFailJudge(reason = 'stub: fails by design'): JudgeAdapter {
  return {
    async judge() {
      return failResponse(reason);
    },
  };
}

/**
 * Returns a judge that fails the first `failsBeforeRecovery` calls,
 * then passes every subsequent call. Models the validator-recovery
 * scenario where BA/EA enrichment improves between attempts.
 */
export function makeRecoveringJudge(failsBeforeRecovery: number): JudgeAdapter {
  let calls = 0;
  return {
    async judge() {
      calls++;
      if (calls <= failsBeforeRecovery) return failResponse('stub: pre-recovery failure');
      return passResponse();
    },
  };
}
