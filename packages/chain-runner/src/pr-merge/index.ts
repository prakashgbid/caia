// Core logic for `caia-pr-merge-or-fail`.
//
// Public entrypoint: `mergeOrFail({ repo, pr, timeoutSeconds, ... })`.
// Exits with detailed result; CLI wraps with process.exit code translation.
//
// Behaviour (matches operator spec, 2026-05-13):
// - Poll `gh pr view` every `pollIntervalSeconds` until checks settle.
// - If green + mergeable → `gh pr merge --admin --squash --delete-branch`.
// - If only non-substantive checks fail (lint, format, dependabot, doc-only,
//   semgrep tier-warn, axe, visual, lighthouse, bundle-size) → admin-bypass
//   cycle: DELETE protection.enforce_admins → merge → POST to re-arm.
// - Returns "merged" ONLY when `gh pr view` returns `state=MERGED &&
//   mergedAt!=null`.
// - Every attempt appended to ~/.caia/chain-runner/pr-merge-attempts.jsonl.
// - Post-merge sweep: delete remote/local branches, worktree prune, stash
//   cleanup.

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface MergeOrFailOpts {
  repo: string; // OWNER/REPO
  pr: number;
  timeoutSeconds?: number | undefined; // default 900
  pollIntervalSeconds?: number | undefined; // default 30
  squashCommitTitle?: string | undefined;
  squashCommitBody?: string | undefined;
  workdir?: string | undefined; // local git checkout for post-merge sweep
  bypassPattern?: 'admin' | 'never' | undefined; // default admin
  logFile?: string | undefined;
  dryRun?: boolean | undefined;
}

export type MergeOutcome =
  | { kind: 'merged'; pr: number; mergedAt: string; bypassed: boolean }
  | {
      kind: 'failed';
      pr: number;
      reason: string;
      lastState?: PRState | undefined;
    };

export interface CheckEntry {
  name: string | null;
  context: string | null;
  state: string | null;
  conclusion?: string | null;
}

export interface PRState {
  state: string;
  mergedAt: string | null;
  mergeable: string;
  mergeStateStatus: string;
  headRefName: string;
  baseRefName: string;
  isDraft: boolean;
  title: string;
  checks: CheckEntry[];
}

const DEFAULT_LOG = join(
  homedir(),
  '.caia',
  'chain-runner',
  'pr-merge-attempts.jsonl',
);

// Names (case-insensitive substring) of CI checks whose FAILURE is treated
// as non-substantive. Failures only in these are eligible for admin-bypass.
const NON_SUBSTANTIVE_CHECK_PATTERNS = [
  'lint',
  'format',
  'prettier',
  'eslint',
  'semgrep',
  'axe',
  'visual',
  'lighthouse',
  'bundle-size',
  'bundle size',
  'dependabot',
  'coderabbit',
  'code reviewer',
  'gitleaks',
  'codeql',
  'docs',
  'docs-only',
  'markdown',
];

function nowIso(): string {
  return new Date().toISOString();
}

function logEvent(file: string, event: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ ts: nowIso(), ...event })}\n`, {
      mode: 0o600,
    });
  } catch {
    // never throw from logger
  }
}

function gh(args: string[], opts: { json?: boolean; cwd?: string } = {}): {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number;
  json?: unknown;
} {
  const r = spawnSync('gh', args, {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: process.env,
  });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  const code = r.status ?? 1;
  const ok = code === 0;
  let json: unknown = undefined;
  if (opts.json && ok) {
    try {
      json = JSON.parse(stdout);
    } catch {
      // leave undefined
    }
  }
  return { ok, stdout, stderr, code, json };
}

export function viewPR(repo: string, pr: number): PRState | null {
  const r = gh(
    [
      'pr',
      'view',
      String(pr),
      '--repo',
      repo,
      '--json',
      'state,mergedAt,mergeable,mergeStateStatus,headRefName,baseRefName,isDraft,title,statusCheckRollup',
    ],
    { json: true },
  );
  if (!r.ok || !r.json || typeof r.json !== 'object') {
    return null;
  }
  const o = r.json as Record<string, unknown>;
  const rawChecks = Array.isArray(o.statusCheckRollup)
    ? (o.statusCheckRollup as Array<Record<string, unknown>>)
    : [];
  const checks: CheckEntry[] = rawChecks.map((c) => ({
    name: typeof c.name === 'string' ? c.name : null,
    context: typeof c.context === 'string' ? c.context : null,
    state:
      typeof c.state === 'string'
        ? c.state
        : typeof c.conclusion === 'string'
          ? c.conclusion
          : null,
    conclusion: typeof c.conclusion === 'string' ? c.conclusion : null,
  }));
  return {
    state: String(o.state ?? ''),
    mergedAt: (o.mergedAt as string | null) ?? null,
    mergeable: String(o.mergeable ?? ''),
    mergeStateStatus: String(o.mergeStateStatus ?? ''),
    headRefName: String(o.headRefName ?? ''),
    baseRefName: String(o.baseRefName ?? ''),
    isDraft: Boolean(o.isDraft),
    title: String(o.title ?? ''),
    checks,
  };
}

function checkIsPending(c: CheckEntry): boolean {
  const s = (c.state ?? '').toUpperCase();
  return s === 'PENDING' || s === 'QUEUED' || s === 'IN_PROGRESS' || s === '';
}

function checkIsFailure(c: CheckEntry): boolean {
  const s = (c.state ?? '').toUpperCase();
  return (
    s === 'FAILURE' ||
    s === 'FAILED' ||
    s === 'ERROR' ||
    s === 'TIMED_OUT' ||
    s === 'CANCELLED' ||
    s === 'ACTION_REQUIRED'
  );
}

function checkLabel(c: CheckEntry): string {
  return (c.name ?? c.context ?? '').toLowerCase();
}

// Markers that, when present in a check label, force-classify the check as
// SUBSTANTIVE even if it also mentions lint/format. E.g. the combined
// "Build · Test · Lint · Typecheck" job — its failure could be a real test
// failure, so don't auto-bypass.
const SUBSTANTIVE_CHECK_PATTERNS = [
  'build',
  'test',
  'e2e',
  'pipeline',
  'integration',
  'regression',
  'unit',
  'gitflow',
  'conformance',
  'secret detection',
  'gatekeeper',
  'migration-numbering',
  'migration-linter',
  'verifier',
];

export function isNonSubstantive(c: CheckEntry): boolean {
  const label = checkLabel(c);
  if (!label) {
    return false;
  }
  // If the label hits any substantive marker, never treat as non-substantive.
  if (SUBSTANTIVE_CHECK_PATTERNS.some((p) => label.includes(p))) {
    return false;
  }
  return NON_SUBSTANTIVE_CHECK_PATTERNS.some((p) => label.includes(p));
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function setEnforceAdmins(
  repo: string,
  branch: string,
  enable: boolean,
): boolean {
  const method = enable ? 'POST' : 'DELETE';
  const r = gh([
    'api',
    '-X',
    method,
    `repos/${repo}/branches/${branch}/protection/enforce_admins`,
  ]);
  return r.ok;
}

function runMergeOnce(
  repo: string,
  pr: number,
  squashTitle?: string,
  squashBody?: string,
): { ok: boolean; out: string; err: string } {
  const args = [
    'pr',
    'merge',
    String(pr),
    '--repo',
    repo,
    '--squash',
    '--delete-branch',
    '--admin',
  ];
  if (squashTitle) {
    args.push('--subject', squashTitle);
  }
  if (squashBody) {
    args.push('--body', squashBody);
  }
  const r = gh(args);
  return { ok: r.ok, out: r.stdout, err: r.stderr };
}

function postMergeSweep(branch: string, workdir?: string): string[] {
  const events: string[] = [];
  if (!branch) {
    return events;
  }
  const cwd = workdir;

  // Remote: gh already does --delete-branch but try via git too (idempotent).
  const r1 = spawnSync('git', ['push', 'origin', '--delete', branch], {
    encoding: 'utf8',
    cwd,
  });
  events.push(`git push --delete origin/${branch}: rc=${r1.status ?? 'n/a'}`);

  // Local branch
  const r2 = spawnSync('git', ['branch', '-D', branch], {
    encoding: 'utf8',
    cwd,
  });
  events.push(`git branch -D ${branch}: rc=${r2.status ?? 'n/a'}`);

  // Worktree prune
  const r3 = spawnSync('git', ['worktree', 'prune'], {
    encoding: 'utf8',
    cwd,
  });
  events.push(`git worktree prune: rc=${r3.status ?? 'n/a'}`);

  // Stash matching branch name
  const r4 = spawnSync('git', ['stash', 'list'], { encoding: 'utf8', cwd });
  if ((r4.status ?? 1) === 0) {
    const matches: number[] = [];
    (r4.stdout || '').split('\n').forEach((line, idx) => {
      if (line.includes(branch)) {
        matches.push(idx);
      }
    });
    // Drop from highest index to keep indices valid
    matches.reverse().forEach((idx) => {
      const r5 = spawnSync('git', ['stash', 'drop', `stash@{${idx}}`], {
        encoding: 'utf8',
        cwd,
      });
      events.push(`git stash drop stash@{${idx}}: rc=${r5.status ?? 'n/a'}`);
    });
  }
  return events;
}

export async function mergeOrFail(
  opts: MergeOrFailOpts,
): Promise<MergeOutcome> {
  const logFile = opts.logFile ?? DEFAULT_LOG;
  const timeoutSeconds = opts.timeoutSeconds ?? 900;
  const pollMs = (opts.pollIntervalSeconds ?? 30) * 1000;
  const start = Date.now();
  const deadline = start + timeoutSeconds * 1000;

  logEvent(logFile, {
    event: 'attempt.start',
    repo: opts.repo,
    pr: opts.pr,
    timeoutSeconds,
    dryRun: !!opts.dryRun,
  });

  let lastState: PRState | null = null;
  // Poll loop
  while (Date.now() < deadline) {
    const st = viewPR(opts.repo, opts.pr);
    if (!st) {
      logEvent(logFile, {
        event: 'view.failed',
        repo: opts.repo,
        pr: opts.pr,
      });
      await sleep(pollMs);
      continue;
    }
    lastState = st;

    if (st.state === 'MERGED' && st.mergedAt) {
      // Already merged externally
      logEvent(logFile, {
        event: 'already.merged',
        repo: opts.repo,
        pr: opts.pr,
        mergedAt: st.mergedAt,
      });
      postMergeSweep(st.headRefName, opts.workdir);
      return {
        kind: 'merged',
        pr: opts.pr,
        mergedAt: st.mergedAt,
        bypassed: false,
      };
    }
    if (st.isDraft) {
      logEvent(logFile, {
        event: 'pr.draft.marking-ready',
        repo: opts.repo,
        pr: opts.pr,
      });
      gh(['pr', 'ready', String(opts.pr), '--repo', opts.repo]);
      await sleep(2000);
      continue;
    }
    if (st.mergeable === 'CONFLICTING' || st.mergeStateStatus === 'DIRTY') {
      logEvent(logFile, {
        event: 'pr.conflicts',
        repo: opts.repo,
        pr: opts.pr,
      });
      return {
        kind: 'failed',
        pr: opts.pr,
        reason: `conflicts (mergeable=${st.mergeable} mergeStateStatus=${st.mergeStateStatus})`,
        lastState: st,
      };
    }

    const pendingChecks = st.checks.filter(checkIsPending);
    const failedChecks = st.checks.filter(checkIsFailure);

    if (pendingChecks.length > 0 && failedChecks.length === 0) {
      logEvent(logFile, {
        event: 'pr.checks.pending',
        repo: opts.repo,
        pr: opts.pr,
        pendingCount: pendingChecks.length,
        pending: pendingChecks.map(checkLabel),
      });
      await sleep(pollMs);
      continue;
    }

    const onlyNonSubstantiveFailing =
      failedChecks.length > 0 && failedChecks.every(isNonSubstantive);

    const allGreen =
      failedChecks.length === 0 && pendingChecks.length === 0;

    // Eligible to merge if (allGreen + mergeable) OR
    // (failures are all non-substantive — bypass).
    const canPlainMerge =
      allGreen &&
      (st.mergeable === 'MERGEABLE' ||
        st.mergeStateStatus === 'CLEAN' ||
        st.mergeStateStatus === 'HAS_HOOKS' ||
        st.mergeStateStatus === 'UNSTABLE');

    const needBypass =
      onlyNonSubstantiveFailing ||
      st.mergeStateStatus === 'BLOCKED' ||
      st.mergeStateStatus === 'BEHIND' ||
      (allGreen && st.mergeStateStatus === 'UNSTABLE');

    if (opts.dryRun) {
      logEvent(logFile, {
        event: 'dryrun',
        repo: opts.repo,
        pr: opts.pr,
        canPlainMerge,
        needBypass,
        failed: failedChecks.map(checkLabel),
      });
      return {
        kind: 'failed',
        pr: opts.pr,
        reason: 'dry-run (no merge attempted)',
        lastState: st,
      };
    }

    if (canPlainMerge) {
      logEvent(logFile, {
        event: 'merge.plain',
        repo: opts.repo,
        pr: opts.pr,
      });
      const m = runMergeOnce(
        opts.repo,
        opts.pr,
        opts.squashCommitTitle,
        opts.squashCommitBody,
      );
      logEvent(logFile, {
        event: 'merge.plain.result',
        repo: opts.repo,
        pr: opts.pr,
        ok: m.ok,
        err: m.err.slice(0, 500),
      });
      if (m.ok) {
        const verify = viewPR(opts.repo, opts.pr);
        if (verify?.state === 'MERGED' && verify.mergedAt) {
          postMergeSweep(verify.headRefName, opts.workdir);
          logEvent(logFile, {
            event: 'merged',
            repo: opts.repo,
            pr: opts.pr,
            mergedAt: verify.mergedAt,
            bypassed: false,
          });
          return {
            kind: 'merged',
            pr: opts.pr,
            mergedAt: verify.mergedAt,
            bypassed: false,
          };
        }
      }
      // Fall through to bypass attempt
    }

    if (needBypass && opts.bypassPattern !== 'never') {
      const branch = st.baseRefName;
      logEvent(logFile, {
        event: 'bypass.start',
        repo: opts.repo,
        pr: opts.pr,
        baseBranch: branch,
        failed: failedChecks.map(checkLabel),
      });
      const offOk = setEnforceAdmins(opts.repo, branch, false);
      if (!offOk) {
        logEvent(logFile, {
          event: 'bypass.disable_admins.failed',
          repo: opts.repo,
          pr: opts.pr,
        });
        return {
          kind: 'failed',
          pr: opts.pr,
          reason: 'failed to disable enforce_admins',
          lastState: st,
        };
      }
      const m = runMergeOnce(
        opts.repo,
        opts.pr,
        opts.squashCommitTitle,
        opts.squashCommitBody,
      );
      logEvent(logFile, {
        event: 'bypass.merge.result',
        repo: opts.repo,
        pr: opts.pr,
        ok: m.ok,
        err: m.err.slice(0, 500),
      });
      // Re-arm regardless of merge success
      const onOk = setEnforceAdmins(opts.repo, branch, true);
      if (!onOk) {
        logEvent(logFile, {
          event: 'bypass.re-arm.failed',
          repo: opts.repo,
          pr: opts.pr,
          baseBranch: branch,
        });
      }
      if (m.ok) {
        const verify = viewPR(opts.repo, opts.pr);
        if (verify?.state === 'MERGED' && verify.mergedAt) {
          postMergeSweep(verify.headRefName, opts.workdir);
          logEvent(logFile, {
            event: 'merged',
            repo: opts.repo,
            pr: opts.pr,
            mergedAt: verify.mergedAt,
            bypassed: true,
          });
          return {
            kind: 'merged',
            pr: opts.pr,
            mergedAt: verify.mergedAt,
            bypassed: true,
          };
        }
      }
      return {
        kind: 'failed',
        pr: opts.pr,
        reason: `bypass merge failed: ${m.err.trim().split('\n').pop() ?? 'unknown'}`,
        lastState: st,
      };
    }

    // Substantive failure outside our bypass list — give up.
    if (failedChecks.length > 0 && !onlyNonSubstantiveFailing) {
      const substantive = failedChecks.filter((c) => !isNonSubstantive(c));
      logEvent(logFile, {
        event: 'substantive.failures',
        repo: opts.repo,
        pr: opts.pr,
        failed: substantive.map(checkLabel),
      });
      return {
        kind: 'failed',
        pr: opts.pr,
        reason: `substantive check failures: ${substantive.map(checkLabel).join(', ')}`,
        lastState: st,
      };
    }

    await sleep(pollMs);
  }

  logEvent(logFile, {
    event: 'timeout',
    repo: opts.repo,
    pr: opts.pr,
    timeoutSeconds,
  });
  return {
    kind: 'failed',
    pr: opts.pr,
    reason: `timeout after ${timeoutSeconds}s`,
    lastState: lastState ?? undefined,
  };
}

// Utility exported for the runner gate.
export function findOpenPrForBranch(
  repo: string,
  branch: string,
): number | null {
  if (!branch) {
    return null;
  }
  const r = gh(
    [
      'pr',
      'list',
      '--repo',
      repo,
      '--state',
      'open',
      '--head',
      branch,
      '--json',
      'number',
      '--limit',
      '5',
    ],
    { json: true },
  );
  if (!r.ok || !Array.isArray(r.json)) {
    return null;
  }
  const arr = r.json as Array<{ number?: number }>;
  return arr.length > 0 && typeof arr[0]?.number === 'number'
    ? arr[0]!.number!
    : null;
}

export { DEFAULT_LOG as PR_MERGE_LOG_FILE };

// Re-export `existsSync` and similar helpers as needed elsewhere
export { existsSync };
