/**
 * Microbenchmark — FIX-005.
 *
 * In-memory invoker overhead on the hot path. The real socket version
 * is dominated by I/O so it's not the bottleneck — the in-memory
 * variant is what the orchestrator dispatch profile is built around
 * for now.
 */

import { MemoryCodingIpcInvoker } from '../src/coding-ipc-client';
import type { FixRequest } from '../src/types';

const ITER = 1000;
const PER_CALL_BUDGET_MS = 0.5;

const req: FixRequest = {
  storyId: 'story_1',
  testCaseId: 'tc1',
  attempt: 1,
  whatFailed: 'x',
  hypothesisFromDiagnoser: 'y',
  testCaseSpecPath: '/tmp/spec.ts',
  hintFiles: [],
  preserveScopeOf: 'fix-only',
};

describe('MemoryCodingIpcInvoker overhead', () => {
  it(`stays under ${PER_CALL_BUDGET_MS}ms / call`, async () => {
    const inv = new MemoryCodingIpcInvoker();
    const start = Date.now();
    for (let i = 0; i < ITER; i++) {
      // eslint-disable-next-line no-await-in-loop
      await inv.applyFix(req);
    }
    const totalMs = Date.now() - start;
    const perMs = totalMs / ITER;
    // eslint-disable-next-line no-console
    console.log(`[bench] FIX-005 memory invoker: ${perMs.toFixed(3)}ms/call over ${ITER} calls`);
    expect(perMs).toBeLessThan(PER_CALL_BUDGET_MS);
  });
});
