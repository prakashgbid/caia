/**
 * Microbenchmark — FIX-003.
 *
 * The runner's overhead dominates for fast tests; with a mock executor
 * (i.e. no real subprocess) the runner itself should be near-free —
 * sub-millisecond per spec. This bench guards against accidentally
 * regressing into per-spec heavy work.
 */

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  SubprocessTestRunner,
  type CommandExecutor,
  type ExecResult,
} from '../src/test-runner';

const ITER = 200;
const PER_SPEC_BUDGET_MS = 2;

class FastExecutor implements CommandExecutor {
  async exec(): Promise<ExecResult> {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        numFailedTests: 0,
        numPassedTests: 1,
        numPendingTests: 0,
      }),
      stderr: '',
      timedOut: false,
      durationMs: 1,
    };
  }
}

function writeSpec(): string {
  const dir = mkdtempSync(join(tmpdir(), 'caia-fix-003-bench-'));
  const path = join(dir, 'tc.spec.ts');
  writeFileSync(path, "import { it } from 'vitest';\n", 'utf8');
  return path;
}

describe('SubprocessTestRunner overhead', () => {
  it(`stays under ${PER_SPEC_BUDGET_MS}ms / spec with mock executor`, async () => {
    const path = writeSpec();
    const runner = new SubprocessTestRunner({ executor: new FastExecutor() });
    const start = Date.now();
    for (let i = 0; i < ITER; i++) {
      // eslint-disable-next-line no-await-in-loop
      await runner.runSpec({
        testCaseId: `tc${i}`,
        specPath: path,
        contentHash: 'h',
      });
    }
    const totalMs = Date.now() - start;
    const perMs = totalMs / ITER;
    // eslint-disable-next-line no-console
    console.log(`[bench] FIX-003 runner+parser: ${perMs.toFixed(3)}ms/spec over ${ITER} specs`);
    expect(perMs).toBeLessThan(PER_SPEC_BUDGET_MS);
  });
});
