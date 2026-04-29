/**
 * Microbenchmark — FIX-006.
 *
 * Controller dispatch overhead per (testCase × attempt). With stub
 * collaborators the path is pure orchestration so any regression
 * here points at logic creep — the budget is < 2 ms / attempt.
 */

import {
  RetestLoopController,
  type BlockerWriter,
  type RunHistoryRecorder,
  type RunHistoryRow,
  type BlockerInput,
  type TestRunnerPort,
} from '../src/retest-loop-controller';
import {
  StubCodingIpcInvoker,
  StubFailureDiagnoser,
  StubTestCodeGenerator,
} from '../src/stubs';
import type { CodingCompletePayload } from '../src/types';
import type { TestCase } from '@chiefaia/ticket-template';

const ITER = 200;
const PER_ATTEMPT_BUDGET_MS = 2;

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

const passingRunner: TestRunnerPort = {
  runSpec: async () => ({ testCaseId: 'tc1', status: 'passed', durationMs: 0 }),
};

class CountingHistory implements RunHistoryRecorder {
  rows = 0;
  async record(_r: RunHistoryRow): Promise<void> {
    this.rows += 1;
  }
}

class CountingBlocker implements BlockerWriter {
  count = 0;
  async fileBlocker(_b: BlockerInput): Promise<void> {
    this.count += 1;
  }
}

describe('RetestLoopController dispatch overhead', () => {
  it(`stays under ${PER_ATTEMPT_BUDGET_MS}ms / attempt on the happy path`, async () => {
    const controller = new RetestLoopController({
      generator: new StubTestCodeGenerator(),
      runner: passingRunner,
      diagnoser: new StubFailureDiagnoser(),
      ipc: new StubCodingIpcInvoker(),
      history: new CountingHistory(),
      blockers: new CountingBlocker(),
    });
    const start = Date.now();
    for (let i = 0; i < ITER; i++) {
      // eslint-disable-next-line no-await-in-loop
      await controller.runCase(tc, payload);
    }
    const totalMs = Date.now() - start;
    const perMs = totalMs / ITER;
    // eslint-disable-next-line no-console
    console.log(`[bench] FIX-006 controller: ${perMs.toFixed(3)}ms/attempt over ${ITER} iters`);
    expect(perMs).toBeLessThan(PER_ATTEMPT_BUDGET_MS);
  });
});
