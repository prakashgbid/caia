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
}

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
      // --force in case the worktree has uncommitted changes from the build
      await runOrThrow(shell, `git worktree remove --force ${shellEscape(targetPath)}`, {
        cwd: repoPath,
        timeoutMs: 30_000
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
