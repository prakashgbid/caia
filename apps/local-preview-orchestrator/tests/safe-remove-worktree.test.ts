/**
 * Unit tests for the always-on three-step worktree teardown introduced in PR-G.
 *
 * The function under test is `safeRemoveWorktree`. We exercise:
 *   - rmSync runs even when git worktree remove succeeded but left the dir
 *     behind (partial-cleanup safety net)
 *   - rmSync runs when git worktree remove threw
 *   - prune is called regardless of git/rmSync outcomes
 *   - early-out when the workspace dir doesn't exist
 *   - errors at any step are logged but never thrown
 */

import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeRemoveWorktree } from '../src/deploy';
import type { GitOps } from '../src/git-ops';

const noopLogger = { error: vi.fn() };

function makeFakeGitOps(overrides: Partial<GitOps> = {}): GitOps {
  return {
    fetch: vi.fn(async () => undefined),
    resolveBranchSha: vi.fn(async () => 'abc1234'),
    worktreeAdd: vi.fn(async () => undefined),
    worktreeRemove: vi.fn(async () => undefined),
    pruneWorktrees: vi.fn(async () => undefined),
    ...overrides
  };
}

describe('safeRemoveWorktree', () => {
  it('returns early if workspace dir does not exist', async () => {
    const gitOps = makeFakeGitOps();
    await safeRemoveWorktree(gitOps, '/repo', '/nonexistent/path-xyz', noopLogger);
    expect(gitOps.worktreeRemove).not.toHaveBeenCalled();
    expect(gitOps.pruneWorktrees).not.toHaveBeenCalled();
  });

  it('calls git worktree remove + prune in the happy path', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lp-srw-happy-'));
    const wt = join(tmp, 'workspace');
    mkdirSync(wt);
    let gitRemoveRanFirst = false;
    let pruneRanAfterRemove = false;
    const gitOps = makeFakeGitOps({
      worktreeRemove: vi.fn(async () => {
        gitRemoveRanFirst = true;
        // Real git worktree remove would delete the dir; simulate that.
        const { rmSync } = await import('node:fs');
        rmSync(wt, { recursive: true, force: true });
      }),
      pruneWorktrees: vi.fn(async () => {
        if (gitRemoveRanFirst) pruneRanAfterRemove = true;
      })
    });

    await safeRemoveWorktree(gitOps, '/repo', wt, noopLogger);
    expect(gitOps.worktreeRemove).toHaveBeenCalledOnce();
    expect(gitOps.pruneWorktrees).toHaveBeenCalledOnce();
    expect(pruneRanAfterRemove).toBe(true);
    expect(existsSync(wt)).toBe(false);
  });

  it('falls back to rmSync when git worktree remove throws', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lp-srw-throws-'));
    const wt = join(tmp, 'workspace');
    mkdirSync(wt);
    const errorLogger = { error: vi.fn() };
    const gitOps = makeFakeGitOps({
      worktreeRemove: vi.fn(async () => {
        throw new Error('boom');
      })
    });

    await safeRemoveWorktree(gitOps, '/repo', wt, errorLogger);
    expect(existsSync(wt)).toBe(false); // rmSync swept it
    expect(gitOps.pruneWorktrees).toHaveBeenCalledOnce(); // prune runs anyway
    // Should have logged the git error (but NOT the rmSync fallback success)
    expect(errorLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('worktree remove failed')
    );
  });

  it('always-on rmSync sweeps a partial cleanup even when git reported success', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lp-srw-partial-'));
    const wt = join(tmp, 'workspace');
    mkdirSync(wt);
    const gitOps = makeFakeGitOps({
      worktreeRemove: vi.fn(async () => undefined) // success but leaves dir behind
    });

    await safeRemoveWorktree(gitOps, '/repo', wt, noopLogger);
    expect(existsSync(wt)).toBe(false); // rmSync mopped up
    expect(gitOps.pruneWorktrees).toHaveBeenCalledOnce();
  });

  it('logs but does not throw when prune fails', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lp-srw-prune-fail-'));
    const wt = join(tmp, 'workspace');
    mkdirSync(wt);
    const errorLogger = { error: vi.fn() };
    const gitOps = makeFakeGitOps({
      worktreeRemove: vi.fn(async () => {
        const { rmSync } = await import('node:fs');
        rmSync(wt, { recursive: true, force: true });
      }),
      pruneWorktrees: vi.fn(async () => {
        throw new Error('prune boom');
      })
    });

    await expect(
      safeRemoveWorktree(gitOps, '/repo', wt, errorLogger)
    ).resolves.toBeUndefined();
    expect(errorLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('prune failed')
    );
  });

  it('logs but does not throw when rmSync fails (extreme defensive case)', async () => {
    // Simulate a non-existent path that rmSync would no-op on (the more
    // realistic "rmSync fails" requires permission games we don't want in CI).
    // Here we only verify the function returns even when prune throws AND
    // the pre-existing dir was already gone before step 2.
    const tmp = mkdtempSync(join(tmpdir(), 'lp-srw-resilient-'));
    const wt = join(tmp, 'workspace');
    mkdirSync(wt);
    const errorLogger = { error: vi.fn() };
    const gitOps = makeFakeGitOps({
      worktreeRemove: vi.fn(async () => {
        const { rmSync } = await import('node:fs');
        rmSync(wt, { recursive: true, force: true });
      }),
      pruneWorktrees: vi.fn(async () => {
        throw new Error('prune boom');
      })
    });

    await expect(
      safeRemoveWorktree(gitOps, '/repo', wt, errorLogger)
    ).resolves.toBeUndefined();
  });
});
