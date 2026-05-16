import { runCommand } from './runner.js';
import type { CheckOptions, CheckResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * V1 — typecheck.
 *
 * Runs `pnpm --filter <pkg> typecheck` for each target + consumer package.
 * Aggregates into a single pass/fail CheckResult; first non-zero exit short-circuits.
 *
 * Per §7 of the adoption-enforcement design, V1 is the cheapest gate and must
 * pass before V2/V3 are even attempted by the orchestrator (though this module
 * does not enforce that ordering — the orchestrator does).
 */
export async function runTypecheck(options: CheckOptions): Promise<CheckResult> {
  const packages = uniq([...options.targetPackages, ...(options.consumerPackages ?? [])]);

  if (packages.length === 0) {
    return {
      id: 'V1',
      label: 'typecheck',
      command: 'pnpm typecheck (no packages selected)',
      status: 'skipped',
      exitCode: 0,
      durationMs: 0,
      stdoutTail: '',
      stderrTail: '',
    };
  }

  const filterArgs = packages.flatMap((pkg) => ['--filter', pkg]);
  const args = [...filterArgs, 'typecheck'];
  const command = `pnpm ${args.join(' ')}`;

  const result = await runCommand('pnpm', args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.env !== undefined ? { env: options.env } : {}),
  });

  return {
    id: 'V1',
    label: 'typecheck',
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
