/**
 * Git operations needed by the deploy pipeline.
 *
 * Encapsulated behind an interface so unit tests can stub git without setting
 * up a real fixture repo (integration tests still use a real fixture).
 *
 * Trust boundary: branch names + repo paths come from the compile-time SITES
 * registry; SHAs come from `git rev-parse` output. No user input is ever
 * passed to a git command in this module.
 */

import type { ShellRunner, ShellRunOptions } from './shell-runner.js';
import { runOrThrow } from './shell-runner.js';

export interface GitOps {
  fetch(repoPath: string, branch: string): Promise<void>;
  resolveBranchSha(repoPath: string, branch: string): Promise<string>;
  worktreeAdd(repoPath: string, targetPath: string, ref: string): Promise<void>;
  worktreeRemove(repoPath: string, targetPath: string): Promise<void>;
  /**
   * Reconcile the worktree registry with the on-disk state. Run after a
   * manual rmSync to drop dangling entries.
   */
  pruneWorktrees(repoPath: string): Promise<void>;
}

/**
 * `git worktree remove --force` timeout.
 *
 * Bumped to 120s in PR-G. Stage-6 verify on Mac saw the previous 30s
 * timeout fire on a 1.7 GB worktree (Next.js build artifacts + node_modules)
 * — fs walk over that volume on a busy disk regularly takes 45-60s; 120s
 * leaves headroom and still keeps the deploy pipeline responsive.
 */
const WORKTREE_REMOVE_TIMEOUT_MS = 120_000;

/**
 * `git worktree prune` timeout. Cheap operation — touches just the registry.
 */
const WORKTREE_PRUNE_TIMEOUT_MS = 30_000;

/**
 * Default GitOps — backed by a ShellRunner.
 */
export function makeGitOps(shell: ShellRunner): GitOps {
  return {
    async fetch(repoPath, branch) {
      // Fast-path: --no-tags, only the tracked branch.
      // 60s timeout is generous for 3 small Mac-local repos.
      await runOrThrow(shell, `git fetch origin ${shellEscape(branch)} --no-tags --prune`, {
        cwd: repoPath,
        timeoutMs: 60_000
      });
    },
    async resolveBranchSha(repoPath, branch) {
      const result = await runOrThrow(shell, `git rev-parse origin/${shellEscape(branch)}`, {
        cwd: repoPath,
        timeoutMs: 10_000
      });
      const sha = result.stdout.trim();
      if (!/^[0-9a-f]{7,40}$/.test(sha)) {
        throw new Error(`Invalid SHA returned by git rev-parse: "${sha}"`);
      }
      return sha;
    },
    async worktreeAdd(repoPath, targetPath, ref) {
      await runOrThrow(
        shell,
        // --detach to avoid creating a new branch; --force in case the path was reused
        `git worktree add --detach --force ${shellEscape(targetPath)} ${shellEscape(ref)}`,
        { cwd: repoPath, timeoutMs: 60_000 }
      );
    },
    async worktreeRemove(repoPath, targetPath) {
      // --force in case the worktree has uncommitted changes from the build.
      // 120s tolerates large worktrees on busy disks (PR-G).
      await runOrThrow(shell, `git worktree remove --force ${shellEscape(targetPath)}`, {
        cwd: repoPath,
        timeoutMs: WORKTREE_REMOVE_TIMEOUT_MS
      });
    },
    async pruneWorktrees(repoPath) {
      await runOrThrow(shell, 'git worktree prune', {
        cwd: repoPath,
        timeoutMs: WORKTREE_PRUNE_TIMEOUT_MS
      });
    }
  };
}

/**
 * Quote a string for safe inclusion in a bash command.
 * Strict allowlist: branches/SHAs are alphanumeric + a few separators; paths are
 * absolute filesystem paths from compile-time config. Anything outside the
 * allowlist gets single-quoted with embedded-quote escaping.
 */
export function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_./@\-+]+$/.test(s)) {
    return s;
  }
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Run a `ShellRunOptions`-shaped command and return the raw result.
 * Re-exported for convenience.
 */
export type { ShellRunOptions };

/**
 * Exposed for tests + observers.
 */
export const TIMEOUTS = {
  worktreeRemoveMs: WORKTREE_REMOVE_TIMEOUT_MS,
  worktreePruneMs: WORKTREE_PRUNE_TIMEOUT_MS
} as const;
