import { runTypecheck } from './typecheck.js';
import { runTests } from './tests.js';
import { runBuild } from './build.js';
import type { CheckOptions, CheckResult, VerificationResult } from './types.js';

export interface GauntletOptions extends CheckOptions {
  /**
   * Wall-clock cap for the entire V1+V2+V3 gauntlet. Once exceeded, the
   * currently-running check is allowed to finish but no further checks start.
   */
  readonly wallClockMs?: number;
  /** Skip V2 if V1 fails (default true). */
  readonly shortCircuit?: boolean;
}

const DEFAULT_WALL_CLOCK_MS = 15 * 60 * 1000;

/**
 * Run V1 → V2 → V3. Short-circuits on failure unless explicitly disabled.
 * Returns a structured VerificationResult ready for comment rendering.
 */
export async function runGauntlet(options: GauntletOptions): Promise<VerificationResult> {
  const wallClockMs = options.wallClockMs ?? DEFAULT_WALL_CLOCK_MS;
  const shortCircuit = options.shortCircuit ?? true;
  const started = Date.now();
  const results: CheckResult[] = [];

  const steps: ReadonlyArray<{
    id: 'V1' | 'V2' | 'V3';
    run: () => Promise<CheckResult>;
  }> = [
    { id: 'V1', run: () => runTypecheck(remainingOptions(options, wallClockMs, started)) },
    { id: 'V2', run: () => runTests(remainingOptions(options, wallClockMs, started)) },
    { id: 'V3', run: () => runBuild(remainingOptions(options, wallClockMs, started)) },
  ];

  for (const step of steps) {
    if (Date.now() - started >= wallClockMs) {
      results.push({
        id: step.id,
        label: labelFor(step.id),
        command: '(skipped — gauntlet wall-clock budget exhausted)',
        status: 'timeout',
        exitCode: null,
        durationMs: 0,
        stdoutTail: '',
        stderrTail: '',
      });
      continue;
    }

    const result = await step.run();
    results.push(result);

    if (shortCircuit && result.status !== 'pass' && result.status !== 'skipped') {
      for (const remaining of steps.slice(steps.indexOf(step) + 1)) {
        results.push({
          id: remaining.id,
          label: labelFor(remaining.id),
          command: `(skipped — ${step.id} ${result.status})`,
          status: 'skipped',
          exitCode: null,
          durationMs: 0,
          stdoutTail: '',
          stderrTail: '',
        });
      }
      break;
    }
  }

  const pass = results.every((r) => r.status === 'pass' || r.status === 'skipped') &&
    results.some((r) => r.status === 'pass');

  return {
    pass,
    checks: results,
    durationMs: Date.now() - started,
  };
}

function remainingOptions(
  options: GauntletOptions,
  wallClockMs: number,
  started: number,
): CheckOptions {
  const remaining = Math.max(1, wallClockMs - (Date.now() - started));
  const perCheckTimeout = Math.min(
    options.timeoutMs ?? Number.POSITIVE_INFINITY,
    remaining,
  );
  return {
    cwd: options.cwd,
    targetPackages: options.targetPackages,
    ...(options.consumerPackages !== undefined
      ? { consumerPackages: options.consumerPackages }
      : {}),
    timeoutMs: perCheckTimeout,
    ...(options.env !== undefined ? { env: options.env } : {}),
  };
}

function labelFor(id: 'V1' | 'V2' | 'V3'): string {
  switch (id) {
    case 'V1':
      return 'typecheck';
    case 'V2':
      return 'tests';
    case 'V3':
      return 'build';
  }
}
