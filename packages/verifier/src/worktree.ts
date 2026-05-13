/**
 * Verifier worktree lifecycle.
 *
 * Creates a FRESH git worktree at /tmp/verifier_<job_id> checked out at
 * the implementor's PR head SHA, then cleans up via a try/finally pattern
 * so cleanup runs on BOTH the success and the failure path. Idempotent:
 * `git worktree remove --force` is safe on a never-created path; the
 * filesystem `rm -rf` fallback also tolerates missing dirs.
 *
 * Defence-in-depth — the spawn prompt also asks the verifier to set
 * verdict.verifier_worktree_cleaned_up=true on its own, so we get both an
 * orchestrator-side cleanup AND a verifier-side self-attestation.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface WorktreeOptions {
  /** Repo root (cwd to run git from). */
  repoPath: string;
  /** Stable id used in the worktree path. Falls back to a tmp suffix when omitted. */
  jobId?: string;
  /** SHA to check out into the worktree. REQUIRED. */
  commitSha: string;
  /** Optional override for the spawn function (test seam). */
  spawn?: (cmd: string, args: string[], cwd: string) => SpawnSyncReturns<Buffer>;
}

export interface WorktreeHandle {
  path: string;
  jobId: string;
  cleanup: (reason: 'success' | 'exception' | 'timeout' | 'sigterm') => Promise<void>;
  cleanupReason: () => 'success' | 'exception' | 'timeout' | 'sigterm' | null;
  cleanedUp: () => boolean;
}

function defaultSpawn(cmd: string, args: string[], cwd: string): SpawnSyncReturns<Buffer> {
  return spawnSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Create a fresh worktree. Throws on failure (no partial state). The handle
 * carries an idempotent `cleanup()` callable the orchestrator must invoke in
 * a try/finally — call patterns:
 *   const wt = createWorktree({...});
 *   try { ...do work... ; await wt.cleanup('success'); }
 *   catch (e) { await wt.cleanup('exception'); throw e; }
 */
export function createWorktree(opts: WorktreeOptions): WorktreeHandle {
  const spawn = opts.spawn ?? defaultSpawn;
  const jobId =
    opts.jobId ??
    mkdtempSync(join(tmpdir(), 'verifier_')).split('verifier_').slice(1).join('verifier_');
  const wtPath = join(tmpdir(), `verifier_${jobId}`);

  // Ensure stale worktree dir isn't present from a prior run with the same jobId.
  // git worktree add refuses to overwrite — we explicitly clean first.
  if (existsSync(wtPath)) {
    const r = spawn('git', ['worktree', 'remove', '--force', wtPath], opts.repoPath);
    if (r.status !== 0) {
      // Not fatal — fs rm below handles it.
      try {
        rmSync(wtPath, { recursive: true, force: true });
      } catch {
        // ignore — git worktree add will error and we'll surface that
      }
    }
  }

  const r = spawn('git', ['worktree', 'add', '--detach', wtPath, opts.commitSha], opts.repoPath);
  if (r.status !== 0) {
    const err = (r.stderr ?? Buffer.from('')).toString();
    throw new Error(`git worktree add failed (rc=${r.status}): ${err}`);
  }

  let cleaned = false;
  let reason: 'success' | 'exception' | 'timeout' | 'sigterm' | null = null;

  const cleanup = async (whyVal: 'success' | 'exception' | 'timeout' | 'sigterm') => {
    if (cleaned) return; // idempotent
    cleaned = true;
    reason = whyVal;
    // Try git worktree remove first (cleanest — also updates .git/worktrees/).
    try {
      spawn('git', ['worktree', 'remove', '--force', wtPath], opts.repoPath);
    } catch {
      // fall through to fs rm
    }
    // Defence-in-depth filesystem rm.
    try {
      await rm(wtPath, { recursive: true, force: true });
    } catch {
      // tolerate — the git remove above almost always succeeds
    }
    // Prune .git/worktrees in case a stale entry remains.
    try {
      spawn('git', ['worktree', 'prune'], opts.repoPath);
    } catch {
      // ignore
    }
  };

  return {
    path: wtPath,
    jobId,
    cleanup,
    cleanupReason: () => reason,
    cleanedUp: () => cleaned
  };
}
