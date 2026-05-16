import { runCommand } from './runner.js';
import type { CheckOptions, CheckResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * V3 — build.
 *
 * Per §7, V3 is "build all" — but `all` in a 71-package monorepo would blow
 * the per-PR 15-minute wall-clock cap. We narrow to `pnpm --filter <pkg>...`
 * with the trailing `...` (downstream dependents) so transitive consumers of
 * the target package are exercised without rebuilding every leaf in the repo.
 *
 * If `targetPackages` is empty we fall back to the repo-wide `pnpm build` so
 * the gauntlet never trivially passes on a misconfigured invocation.
 */
export async function runBuild(options: CheckOptions): Promise<CheckResult> {
  const args = buildArgs(options);
  const command = `pnpm ${args.join(' ')}`;

  const result = await runCommand('pnpm', args, {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(options.env !== undefined ? { env: options.env } : {}),
  });

  return {
    id: 'V3',
    label: 'build',
    command,
    status: classify(result.exitCode, result.timedOut),
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutTail: result.stdoutTail,
    stderrTail: result.stderrTail,
  };
}

function buildArgs(options: CheckOptions): string[] {
  if (options.targetPackages.length === 0) {
    return ['-w', 'build'];
  }
  const filters = options.targetPackages.flatMap((pkg) => ['--filter', `${pkg}...`]);
  return [...filters, 'build'];
}

function classify(exitCode: number | null, timedOut: boolean): CheckResult['status'] {
  if (timedOut) return 'timeout';
  if (exitCode === 0) return 'pass';
  return 'fail';
}
