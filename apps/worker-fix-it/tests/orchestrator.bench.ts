/**
 * Microbenchmark — FIX-001.
 *
 * Asserts the orchestrator's overhead per (test case × attempt) stays
 * well under the per-case wall-clock budget defined in the directive
 * (rough budget: 10s avg per browser case → 10ms is the orchestrator
 * dispatch budget, ie. < 0.1% of per-case wall time).
 *
 * Uses the stub ports so this benchmarks pure orchestrator overhead.
 *
 * Run: `pnpm --filter @caia-app/worker-fix-it bench`
 */

import { FixItOrchestrator } from '../src/orchestrator';
import type { TestCase } from '@chiefaia/ticket-template';
import type { CodingCompletePayload } from '../src/types';

const ITERATIONS = 200;
const ORCHESTRATOR_OVERHEAD_PER_ATTEMPT_MS = 5;

const payload: CodingCompletePayload = {
  storyId: 's',
  workerId: 'w',
  prUrl: 'https://github.com/x/y/pull/1',
  prNumber: 1,
  sha: 'abcdefg',
  localTestsPassed: true,
  worktreePath: '/tmp/wt',
  codingSessionId: 'sess',
  completedAt: 1,
  correlationId: 'c',
};

const cases: TestCase[] = Array.from({ length: 10 }, (_v, i) => ({
  id: `tc${i}`,
  title: `case ${i}`,
  category: 'happy',
  layer: 'unit',
  given: 'g',
  when: 'w',
  then: 't',
  selectorHints: [],
  mocks: [],
  required: true,
  status: 'pending',
  designedBy: 'testing-agent',
  designedAt: 0,
}));

describe('FixItOrchestrator overhead', () => {
  it(`stays under ${ORCHESTRATOR_OVERHEAD_PER_ATTEMPT_MS}ms per (case × attempt)`, async () => {
    const orchestrator = new FixItOrchestrator();
    const start = Date.now();
    for (let i = 0; i < ITERATIONS; i++) {
      // eslint-disable-next-line no-await-in-loop
      await orchestrator.run(payload, cases);
    }
    const totalMs = Date.now() - start;
    // total (case × attempt) units: ITERATIONS × cases.length × 1 attempt (passes on first try)
    const units = ITERATIONS * cases.length;
    const perUnitMs = totalMs / units;
    // eslint-disable-next-line no-console
    console.log(
      `[bench] FixItOrchestrator stub-path: ${perUnitMs.toFixed(3)}ms per (case × attempt) over ${units} units`,
    );
    expect(perUnitMs).toBeLessThan(ORCHESTRATOR_OVERHEAD_PER_ATTEMPT_MS);
  });
});
