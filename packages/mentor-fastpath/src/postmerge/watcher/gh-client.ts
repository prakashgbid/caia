/**
 * Thin wrapper around the GitHub `gh` CLI for the postmerge watcher.
 *
 * Subscription-only constraint: NO Octokit / paid API tokens. The
 * operator's `gh` CLI is already authenticated against their personal
 * GitHub account; we shell out to it.
 *
 * Each call uses `execFileSync` (NOT `execSync`) to keep arguments out
 * of shell-escape territory. All commands include `--json <fields>` so
 * we get parseable output and never depend on `gh` text formatting.
 *
 * Errors:
 *   - Network / auth errors throw — caller decides whether to retry
 *     vs. surface a warning.
 *   - JSON parse errors throw with the raw text for debugging.
 *
 * Tests inject a mock `runGh` to avoid real network. Production uses
 * `defaultRunGh` which calls `execFileSync('gh', ...)`.
 */

import { execFileSync } from 'node:child_process';

/**
 * Function signature for the gh-runner. Tests pass a mock; production
 * uses `defaultRunGh`. Returns stdout (utf-8, trimmed). Throws on
 * non-zero exit.
 */
export type RunGh = (args: ReadonlyArray<string>) => string;

/** Default real-shell gh runner. Times out after 60s per command. */
export const defaultRunGh: RunGh = (args) => {
  const out = execFileSync('gh', [...args], {
    encoding: 'utf-8',
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024
  });
  return out.trim();
};

// ─── Type contracts ───────────────────────────────────────────────────────

export interface MergedPr {
  number: number;
  title: string;
  /** Merge SHA. May be empty in degenerate cases — caller should skip. */
  mergeCommit: string;
  /** Branch name the PR merged into (e.g. 'develop'). */
  baseRefName: string;
  /** PR head ref, e.g. 'feat/mentor-phase2-001-...'. Useful for filtering. */
  headRefName: string;
  /** ISO 8601 timestamp of the merge. */
  mergedAt: string;
  /** PR author login. */
  author: string;
}

export interface FailedRun {
  /** GitHub workflow-run id. Stable across queries — use for dedupe. */
  databaseId: number;
  /** Workflow name (e.g. 'Build · Test · Lint · Typecheck'). */
  workflowName: string;
  /** Branch name (head_branch) the run targeted. */
  headBranch: string;
  /** Commit SHA the run was triggered against. */
  headSha: string;
  /** ISO 8601 of run completion. */
  updatedAt: string;
  /** Run status — 'completed' filtered to status=failure / cancelled. */
  conclusion: string;
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface GhClientOptions {
  /** Mock injection. Default: real `gh` CLI. */
  runGh?: RunGh;
  /** Repo owner/name. Default: detected from cwd via `gh repo view`. */
  repo?: string;
}

/**
 * List PRs merged since `sinceIso` against any of the given base refs.
 *
 * Uses `gh pr list --state merged --search "merged:>=<sinceIso> base:<branch>"`.
 *
 * Returns the parsed PRs in newest-first order (gh's default).
 */
export function listMergedPrs(
  opts: GhClientOptions,
  sinceIso: string,
  baseRefs: ReadonlyArray<string> = ['develop', 'main'],
  limit = 50
): MergedPr[] {
  const run = opts.runGh ?? defaultRunGh;
  const baseQuery = baseRefs.map((b) => `base:${b}`).join(' ');
  const search = `merged:>=${sinceIso} ${baseQuery}`;
  const args = [
    'pr',
    'list',
    '--state',
    'merged',
    '--search',
    search,
    '--limit',
    String(limit),
    '--json',
    'number,title,mergeCommit,baseRefName,headRefName,mergedAt,author'
  ];
  if (opts.repo) {
    args.push('--repo', opts.repo);
  }
  const raw = run(args);
  if (raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`gh pr list returned unparseable JSON: ${String(e)}\nraw=${raw.slice(0, 200)}`, { cause: e });
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`gh pr list expected array; got ${typeof parsed}`);
  }
  return parsed.map(normalizeMergedPr);
}

/**
 * List failed workflow runs since `sinceIso` against the given branches.
 *
 * Uses `gh run list --branch <b> --status failure` (one call per branch
 * because gh has no multi-branch filter).
 */
export function listFailedRuns(
  opts: GhClientOptions,
  sinceIso: string,
  branches: ReadonlyArray<string> = ['develop', 'main'],
  limit = 50
): FailedRun[] {
  const run = opts.runGh ?? defaultRunGh;
  const all: FailedRun[] = [];
  for (const branch of branches) {
    const args = [
      'run',
      'list',
      '--branch',
      branch,
      '--status',
      'failure',
      '--limit',
      String(limit),
      '--json',
      'databaseId,name,headBranch,headSha,updatedAt,conclusion'
    ];
    if (opts.repo) {
      args.push('--repo', opts.repo);
    }
    const raw = run(args);
    if (raw.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `gh run list (branch=${branch}) returned unparseable JSON: ${String(e)}\nraw=${raw.slice(0, 200)}`,
        { cause: e }
      );
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`gh run list (branch=${branch}) expected array; got ${typeof parsed}`);
    }
    for (const r of parsed) {
      const norm = normalizeRun(r);
      if (norm.updatedAt >= sinceIso) all.push(norm);
    }
  }
  return all;
}

/**
 * Fetch the failed job names within a given workflow run.
 *
 * Uses `gh run view <id> --json jobs`. Filters to jobs with
 * `conclusion === 'failure'`. Returns just the names (the synthesizer
 * uses these for FailureMode routing).
 */
export function getFailedJobNames(
  opts: GhClientOptions,
  runId: number
): string[] {
  const run = opts.runGh ?? defaultRunGh;
  const args = ['run', 'view', String(runId), '--json', 'jobs'];
  if (opts.repo) {
    args.push('--repo', opts.repo);
  }
  const raw = run(args);
  if (raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`gh run view ${runId} returned unparseable JSON: ${String(e)}`, { cause: e });
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const jobs = (parsed as { jobs?: Array<{ name?: string; conclusion?: string }> }).jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs
    .filter((j) => j.conclusion === 'failure')
    .filter((j): j is { name: string; conclusion: string } => typeof j.name === 'string' && j.name.length > 0)
    .map((j) => j.name);
}

// ─── Normalizers (defensive parsing for gh JSON variations) ───────────────

interface RawAuthor {
  login?: string;
  is_bot?: boolean;
}
interface RawMergeCommit {
  oid?: string;
}
interface RawMergedPr {
  number: number;
  title: string;
  mergeCommit?: RawMergeCommit | null;
  baseRefName?: string;
  headRefName?: string;
  mergedAt?: string;
  author?: RawAuthor;
}
interface RawRun {
  databaseId: number;
  name?: string;
  headBranch?: string;
  headSha?: string;
  updatedAt?: string;
  conclusion?: string;
}

function normalizeMergedPr(raw: unknown): MergedPr {
  const r = raw as RawMergedPr;
  return {
    number: r.number,
    title: r.title ?? '',
    mergeCommit: r.mergeCommit?.oid ?? '',
    baseRefName: r.baseRefName ?? 'develop',
    headRefName: r.headRefName ?? '',
    mergedAt: r.mergedAt ?? '',
    author: r.author?.login ?? 'unknown'
  };
}

function normalizeRun(raw: unknown): FailedRun {
  const r = raw as RawRun;
  return {
    databaseId: r.databaseId,
    workflowName: r.name ?? '',
    headBranch: r.headBranch ?? '',
    headSha: r.headSha ?? '',
    updatedAt: r.updatedAt ?? '',
    conclusion: r.conclusion ?? ''
  };
}
