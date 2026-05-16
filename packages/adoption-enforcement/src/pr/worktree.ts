import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { runCommand } from '../verify/runner.js';

const GIT_TIMEOUT_MS = 5 * 60 * 1000;

export interface WorktreePrep {
  readonly dir: string;
  readonly cleanup: () => Promise<void>;
}

/**
 * Materialise a git worktree at /tmp/adopt-verify-<sha> pinned to the PR head.
 * Caller is responsible for invoking `cleanup()` (idempotent — silently
 * tolerates already-removed worktrees).
 */
export async function prepareWorktree(opts: {
  readonly repoCwd: string;
  readonly headSha: string;
  readonly headRef: string;
}): Promise<WorktreePrep> {
  const dir = path.join(os.tmpdir(), `adopt-verify-${opts.headSha}`);

  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  const fetchResult = await runCommand(
    'git',
    ['fetch', 'origin', opts.headRef, '--quiet'],
    { cwd: opts.repoCwd, timeoutMs: GIT_TIMEOUT_MS },
  );
  if (fetchResult.exitCode !== 0) {
    throw new Error(
      `git fetch ${opts.headRef} failed: ${fetchResult.stderrTail.slice(-500)}`,
    );
  }

  const addResult = await runCommand(
    'git',
    ['worktree', 'add', '--detach', dir, opts.headSha],
    { cwd: opts.repoCwd, timeoutMs: GIT_TIMEOUT_MS },
  );
  if (addResult.exitCode !== 0) {
    throw new Error(
      `git worktree add failed: ${addResult.stderrTail.slice(-500)}`,
    );
  }

  const cleanup = async (): Promise<void> => {
    await runCommand('git', ['worktree', 'remove', '--force', dir], {
      cwd: opts.repoCwd,
      timeoutMs: GIT_TIMEOUT_MS,
    });
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  return { dir, cleanup };
}

/**
 * Best-effort pnpm install in the worktree. Long-timeout (10 min) because
 * a cold store can take a while on the first hit.
 */
export async function pnpmInstall(cwd: string): Promise<{
  exitCode: number | null;
  stderrTail: string;
}> {
  const result = await runCommand(
    'pnpm',
    ['install', '--frozen-lockfile', '--prefer-offline'],
    { cwd, timeoutMs: 10 * 60 * 1000 },
  );
  return { exitCode: result.exitCode, stderrTail: result.stderrTail };
}
