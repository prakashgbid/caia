import { runCommand } from './runner.js';
import type { CheckOptions, CheckResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * V2 — unit tests.
 *
 * Runs `pnpm --filter <pkg> test` for every consumer package whose source was
 * touched by the adoption PR, plus target packages (which usually have their
 * own integration tests of the adopted surface).
 */
export async function runTests(options: CheckOptions): Promise<CheckResult> {
  const packages = uniq([...(options.consumerPackages ?? []), ...options.targetPackages]);

  if (packages.length === 0) {
    return {
      id: 'V2',
      label: 'tests',
      command: 'pnpm test (no packages selected)',
      status: 'skipped',
      exitCode: 0,
      durationMs: 0,
      stdoutTail: '',
      stderrTail: '',
    };
  }

  const filterArgs = packages.flatMap((pkg) => ['--filter', pkg]);
  const args = [...filterArgs, 'test'];
  const command = `pnpm ${args.join(' ')}`;

  const result = await runCommand('pnpm', args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.env !== undefined ? { env: options.env } : {}),
  });

  return {
    id: 'V2',
    label: 'tests',
    command,
    status: classify(result.exitCode, result.timedOut),
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
  };
}

function uniq<T>(items: readonly T[]): T[] {
  return Array.from(new Set(items));
}

function classify(exitCode: number | null, timedOut: boolean): CheckResult['status'] {
  if (timedOut) return 'timeout';
  if (exitCode === 0) return 'pass';
  return 'fail';
}
