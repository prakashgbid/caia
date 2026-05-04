/**
 * Microbenchmark — FIX-004.
 *
 * Diagnoser overhead is on the hot path of every failure; budget is
 * < 1 ms / report.
 */

import { StructuredFailureDiagnoser } from '../src/failure-diagnoser';
import type { RunResult } from '../src/stubs';
import type { TestCase } from '@chiefaia/ticket-template';

const ITER = 500;
const PER_REPORT_BUDGET_MS = 1;

const tc: TestCase = {
  id: 'tc1',
  title: 't',
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
};

const run: RunResult = {
  testCaseId: 'tc1',
  status: 'failed',
  durationMs: 12,
  errorMessage: 'Expected: /dashboard\nReceived: /login',
  errorStack: 'AssertionError: at f.ts:1',
  artifacts: {
    stdoutTail: Array.from({ length: 200 }, (_, i) => `out${i}`).join('\n'),
    stderrTail: 'err',
    consoleLog: ['log: render'],
    networkLog: [{ method: 'GET', url: '/x', status: 200 }],
  },
};

describe('StructuredFailureDiagnoser overhead', () => {
  it(`stays under ${PER_REPORT_BUDGET_MS}ms / report`, async () => {
    const diag = new StructuredFailureDiagnoser();
    const start = Date.now();
    for (let i = 0; i < ITER; i++) {
      // eslint-disable-next-line no-await-in-loop
      await diag.diagnose(run, tc, 1);
    }
    const totalMs = Date.now() - start;
    const perMs = totalMs / ITER;
    // eslint-disable-next-line no-console
    console.log(`[bench] FIX-004 diagnoser: ${perMs.toFixed(3)}ms/report over ${ITER} reports`);
    expect(perMs).toBeLessThan(PER_REPORT_BUDGET_MS);
  });
});
