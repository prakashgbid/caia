import { runGauntlet } from '../verify/gauntlet.js';
import { inferPackages } from './affected-packages.js';
import { renderVerificationComment } from './comment.js';
import {
  applyVerdictLabels,
  upsertVerificationComment,
  listAdoptionPRs,
  getPR,
} from './gh.js';
import { pnpmInstall, prepareWorktree } from './worktree.js';
import type { PullRequest } from './types.js';

export interface RunOptions {
  readonly repoCwd: string;
  readonly prNumber?: number;
  readonly dryRun?: boolean;
  /** Per-PR wall-clock cap (default 15 min, per task spec). */
  readonly perPrWallClockMs?: number;
}

export interface PrVerificationOutcome {
  readonly pr: PullRequest;
  readonly verdict: 'pass' | 'fail' | 'error';
  readonly setupErrors: string[];
  readonly commentAction?: 'created' | 'updated' | 'skipped';
  readonly labelAction?: 'verified' | 'failed' | 'skipped';
  readonly durationMs: number;
}

const DEFAULT_PER_PR_WALL_CLOCK_MS = 15 * 60 * 1000;

export async function runAll(options: RunOptions): Promise<PrVerificationOutcome[]> {
  const prs = options.prNumber !== undefined
    ? [await getPR(options.repoCwd, options.prNumber)]
    : await listAdoptionPRs({ repoCwd: options.repoCwd });

  const outcomes: PrVerificationOutcome[] = [];
  for (const pr of prs) {
    outcomes.push(await runOne(pr, options));
  }
  return outcomes;
}

export async function runOne(
  pr: PullRequest,
  options: RunOptions,
): Promise<PrVerificationOutcome> {
  const startedAtIso = new Date().toISOString();
  const started = Date.now();
  const wallClock = options.perPrWallClockMs ?? DEFAULT_PER_PR_WALL_CLOCK_MS;
  const setupErrors: string[] = [];

  let worktree: { dir: string; cleanup: () => Promise<void> } | null = null;
  try {
    worktree = await prepareWorktree({
      repoCwd: options.repoCwd,
      headSha: pr.headRefOid,
      headRef: pr.headRefName,
    });
  } catch (err) {
    setupErrors.push(`prepareWorktree: ${describe(err)}`);
  }

  if (worktree === null) {
    const finishedAtIso = new Date().toISOString();
    const commentBody = renderVerificationComment({
      pr,
      targetPackages: [],
      consumerPackages: [],
      result: { pass: false, checks: [], durationMs: 0 },
      worktreeDir: '(setup failed)',
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      setupErrors,
    });
    await postAndLabel(options, pr, commentBody, false, setupErrors);
    return {
      pr,
      verdict: 'error',
      setupErrors,
      commentAction: options.dryRun === true ? 'skipped' : 'created',
      labelAction: options.dryRun === true ? 'skipped' : 'failed',
      durationMs: Date.now() - started,
    };
  }

  try {
    const install = await pnpmInstall(worktree.dir);
    if (install.exitCode !== 0) {
      setupErrors.push(
        `pnpm install exit ${install.exitCode}: ${install.stderrTail.slice(-300)}`,
      );
    }

    const { targetPackages, consumerPackages } = await inferPackages({
      worktreeDir: worktree.dir,
      pr,
    });

    const remainingMs = Math.max(60_000, wallClock - (Date.now() - started));
    const result = await runGauntlet({
      cwd: worktree.dir,
      targetPackages,
      consumerPackages,
      wallClockMs: remainingMs,
    });

    const finishedAtIso = new Date().toISOString();
    const commentBody = renderVerificationComment({
      pr,
      targetPackages,
      consumerPackages,
      result,
      worktreeDir: worktree.dir,
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      setupErrors,
    });

    const passed = result.pass && setupErrors.length === 0;
    const { commentAction, labelAction } = await postAndLabel(
      options,
      pr,
      commentBody,
      passed,
      setupErrors,
    );

    return {
      pr,
      verdict: passed ? 'pass' : 'fail',
      setupErrors,
      commentAction,
      labelAction,
      durationMs: Date.now() - started,
    };
  } finally {
    if (worktree) {
      await worktree.cleanup().catch(() => undefined);
    }
  }
}

async function postAndLabel(
  options: RunOptions,
  pr: PullRequest,
  commentBody: string,
  passed: boolean,
  setupErrors: string[],
): Promise<{
  commentAction: 'created' | 'updated' | 'skipped';
  labelAction: 'verified' | 'failed' | 'skipped';
}> {
  if (options.dryRun === true) {
    return { commentAction: 'skipped', labelAction: 'skipped' };
  }

  let commentAction: 'created' | 'updated' = 'created';
  try {
    const res = await upsertVerificationComment({
      repoCwd: options.repoCwd,
      prNumber: pr.number,
      body: commentBody,
    });
    commentAction = res.action;
  } catch (err) {
    setupErrors.push(`upsertComment: ${describe(err)}`);
  }

  try {
    await applyVerdictLabels(options.repoCwd, pr.number, passed);
  } catch (err) {
    setupErrors.push(`applyLabels: ${describe(err)}`);
  }

  return {
    commentAction,
    labelAction: passed ? 'verified' : 'failed',
  };
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
