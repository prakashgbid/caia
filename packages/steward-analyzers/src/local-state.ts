/**
 * Local-state analyzers — failure modes #4 (stash accumulation),
 * #5 (orphan branches without open PR), and #6 (worktree count over cap).
 *
 * These check the Mac-local working state of a CAIA checkout, so they
 * are designed to be invoked by:
 *
 *   - The `hygiene-report.yml` GitHub Actions cron (which checks-out
 *     the repo and can call `git stash`, `git worktree list`,
 *     `git for-each-ref`, and `gh pr list`). Repo-state checks #5
 *     work in CI; #4 + #6 only meaningfully apply to a developer's
 *     working tree but are still safe to run in CI (just trivially 0).
 *   - The `steward preflight` CLI subcommand (Mac-local pre-spawn hook
 *     per `feedback_operational_discipline.md`).
 *
 * Pure analyzer functions accept already-collected raw data and
 * return Finding[]. The shell/git/gh side-effects live in the CLI
 * shim (`bin/steward-gatekeeper.mjs`) so unit tests can drive the
 * analyzers with synthetic inputs.
 *
 * Reference: architecture doc §3.4, §3.5, §3.6 + memory directive
 * `steward_gatekeeper_directive.md` (failure modes 4-6).
 */

import type { Finding, Severity } from './types.js';

// ── Failure mode #4 — stash accumulation ─────────────────────────────────

export interface CheckStashCountOptions {
  /** Result of `git stash list` parsed to one entry per line. */
  stashEntries: ReadonlyArray<string>;
  /**
   * Threshold above which severity escalates from `medium` to `high`.
   * Default 5 (matches steward_gatekeeper_directive.md mode 4).
   */
  highThreshold?: number;
}

export function checkStashCount({
  stashEntries,
  highThreshold = 5,
}: CheckStashCountOptions): Finding[] {
  const count = stashEntries.length;
  if (count === 0) return [];
  const severity: Severity = count > highThreshold ? 'high' : 'medium';
  return [
    {
      analyzer: 'local-state',
      ruleId: 'stash-accumulation',
      path: '<repo>',
      severity,
      message: `Stash count = ${count}; standing rule is 0 (per feedback_git_flow_enforced.md). Convert each to backup/* via 'git stash branch backup/stash-<slug> stash@{N}' then push.`,
      remediation:
        "for i in `seq 0 $(( $(git stash list | wc -l) - 1 ))`; do git stash branch backup/stash-$(date +%s)-$i \"stash@{0}\"; done && git push origin --all 'backup/*'",
      context: { count, highThreshold },
    },
  ];
}

// ── Failure mode #6 — worktree count over cap ────────────────────────────

export interface WorktreeEntry {
  /** Filesystem path of the worktree. */
  path: string;
  /** Branch checked out, or null for detached. */
  branch: string | null;
}

export interface CheckWorktreeCountOptions {
  /** All worktree entries returned by `git worktree list --porcelain`. */
  worktrees: ReadonlyArray<WorktreeEntry>;
  /** Warn threshold. Default 8 (matches steward_gatekeeper_directive.md). */
  warnThreshold?: number;
  /** Block threshold. Default 12. */
  blockThreshold?: number;
}

export function checkWorktreeCount({
  worktrees,
  warnThreshold = 8,
  blockThreshold = 12,
}: CheckWorktreeCountOptions): Finding[] {
  // Subtract 1 for the main checkout. Caller passes ALL entries; the
  // first is conventionally the primary working tree.
  const count = Math.max(0, worktrees.length - 1);
  if (count <= warnThreshold) return [];
  const overBlock = count > blockThreshold;
  const severity: Severity = overBlock ? 'high' : 'medium';
  return [
    {
      analyzer: 'local-state',
      ruleId: 'worktree-cap-exceeded',
      path: '<repo>',
      severity,
      message: overBlock
        ? `Worktree count = ${count}; exceeds block threshold ${blockThreshold}. Pause new spawn until pruned (per feedback_operational_discipline.md).`
        : `Worktree count = ${count}; exceeds warn threshold ${warnThreshold}. Prune merged-and-clean worktrees before next spawn.`,
      remediation:
        "git worktree list | awk '{print $1}' | tail -n +2 | xargs -I{} sh -c 'cd {} && [ -z \"$(git status --porcelain)\" ] && echo PRUNE-CANDIDATE: {}'",
      context: { count, warnThreshold, blockThreshold },
    },
  ];
}

// ── Failure mode #5 — orphan branches without open PR ────────────────────

export interface OrphanBranchInput {
  /** Branch name without the `refs/remotes/origin/` prefix. */
  branch: string;
  /** Unix epoch seconds of the branch's last commit. */
  committerTimeUnix: number;
  /** True iff there's an open PR with this branch as headRef. */
  hasOpenPr: boolean;
}

export interface CheckOrphanBranchesOptions {
  /** All non-protected branches with their metadata. */
  branches: ReadonlyArray<OrphanBranchInput>;
  /** Reference timestamp for "now" (epoch seconds). Default `Date.now()/1000`. */
  nowEpoch?: number;
  /**
   * Branch name patterns to ignore (regex strings, joined with |).
   * Default ignores main, develop, backup/*, release/*, dependabot/*,
   * archive/*, gh-pages.
   */
  ignorePattern?: RegExp;
  /**
   * Age in days above which an orphan is reported. Default 7
   * (steward_gatekeeper_directive.md mode 5).
   */
  ageDaysThreshold?: number;
  /**
   * Cumulative count above which severity escalates to `high`.
   * Default 50 (per architecture doc §3.5).
   */
  cumulativeHighThreshold?: number;
}

const DEFAULT_IGNORE = /^(main|develop|HEAD|gh-pages)$|^(backup|release|dependabot|archive)\//;

export function checkOrphanBranches({
  branches,
  nowEpoch = Math.floor(Date.now() / 1000),
  ignorePattern = DEFAULT_IGNORE,
  ageDaysThreshold = 7,
  cumulativeHighThreshold = 50,
}: CheckOrphanBranchesOptions): Finding[] {
  const ageThresholdSec = ageDaysThreshold * 86400;
  const offenders = branches.filter(
    (b) =>
      !ignorePattern.test(b.branch) &&
      !b.hasOpenPr &&
      nowEpoch - b.committerTimeUnix > ageThresholdSec,
  );
  if (offenders.length === 0) return [];

  const severity: Severity =
    offenders.length > cumulativeHighThreshold ? 'high' : 'medium';

  // One aggregate finding (cumulative count is the actionable signal),
  // plus per-branch context for the dashboard.
  return [
    {
      analyzer: 'local-state',
      ruleId: 'orphan-branches',
      path: '<repo>',
      severity,
      message: `${offenders.length} orphan branch(es) older than ${ageDaysThreshold}d with no open PR. Per feedback_git_flow_enforced.md, every live branch must have an open PR or live in backup/*.`,
      remediation:
        'For each: open a PR (gh pr create), or archive via tag + delete: git tag archive/$(date +%Y-%m-%d)/<branch> origin/<branch> && git push origin tag archive/* && git push origin :<branch>',
      context: {
        count: offenders.length,
        ageDaysThreshold,
        cumulativeHighThreshold,
        offenders: offenders.map((b) => ({
          branch: b.branch,
          ageDays: Math.round((nowEpoch - b.committerTimeUnix) / 86400),
        })),
      },
    },
  ];
}

// ── Pre-spawn hook — fast subset for `steward preflight` ─────────────────

export interface PreflightInput {
  stashEntries: ReadonlyArray<string>;
  worktrees: ReadonlyArray<WorktreeEntry>;
  /** Output of `git status --porcelain` line count on the primary checkout. */
  dirtyTreeEntries: number;
}

export interface PreflightOptions {
  stashHighThreshold?: number;
  worktreeWarnThreshold?: number;
  worktreeBlockThreshold?: number;
  dirtyTreeBlockThreshold?: number;
}

/**
 * Pre-spawn preflight check. Returns Findings for any predicate that
 * would block a new substantial-work spawn per
 * `feedback_operational_discipline.md`. The CLI maps any `block` or
 * `high` severity Finding to exit code 1.
 */
export function preflightChecks(
  input: PreflightInput,
  opts: PreflightOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  const stashOpts: CheckStashCountOptions = { stashEntries: input.stashEntries };
  if (opts.stashHighThreshold !== undefined) {
    stashOpts.highThreshold = opts.stashHighThreshold;
  }
  findings.push(...checkStashCount(stashOpts));

  const wtOpts: CheckWorktreeCountOptions = { worktrees: input.worktrees };
  if (opts.worktreeWarnThreshold !== undefined) {
    wtOpts.warnThreshold = opts.worktreeWarnThreshold;
  }
  if (opts.worktreeBlockThreshold !== undefined) {
    wtOpts.blockThreshold = opts.worktreeBlockThreshold;
  }
  findings.push(...checkWorktreeCount(wtOpts));

  const dirtyBlock = opts.dirtyTreeBlockThreshold ?? 5;
  if (input.dirtyTreeEntries > dirtyBlock) {
    findings.push({
      analyzer: 'local-state',
      ruleId: 'dirty-tree-cap-exceeded',
      path: '<repo>',
      severity: 'high',
      message: `Dirty-tree entry count = ${input.dirtyTreeEntries}; exceeds block threshold ${dirtyBlock}. Either commit/stash to backup/* or pin spawn to a fresh worktree (per feedback_operational_discipline.md).`,
      remediation:
        "git status --porcelain  # inspect; commit relevant files OR 'git stash branch backup/preflight-stash-$(date +%s)' to preserve",
      context: { count: input.dirtyTreeEntries, dirtyBlock },
    });
  }
  return findings;
}
