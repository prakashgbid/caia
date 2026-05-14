// H-15 (chain-runner-battle-harden phase 9, 2026-05-14). success_criteria
// enforcement at markDone time. Replaces the standalone bin/gate-mark-done.sh
// (which checks PRs after-the-fact via grep over a log file) with an
// in-process validator that fires INSIDE markDone, so the audit log,
// state.json, and alerting backbone all see the same outcome.
//
// Modes (per D-5):
//   warn   — default for back-compat. On any failed criterion, emit a
//            `phase_acceptance_warn` audit event + alert, then proceed with
//            mark-done. Existing chains keep behaving as before this lands.
//   strict — opt-in. On any failed criterion, refuse mark-done — the phase
//            stays in_progress, the audit logs `phase_acceptance_failed`,
//            the caller gets a non-zero CLI exit. Operator then either fixes
//            the artifact + retries, or calls `caia-chain adjudicate <id>
//            --to done --reason '...' --evidence pr=<url>` to override.
//
// Criteria implemented today:
//   - output_file: stat() the path, refuse if missing.
//   - min_bytes: stat().size >= min_bytes when set.
//   - grep_match: regex search across the output_file content.
//   - requires_merged_pr: scrape the per-phase dispatch log for PR URLs and
//     verify each is state=MERGED via `gh pr view`. Mirrors gate-mark-done.sh
//     so chains can switch enforcement venue without changing PR semantics.
//
// Why both this AND bin/gate-mark-done.sh? Different layers:
//   - The bash gate sits in the WORKER's check-before-mark-done — it can
//     attempt a merge via caia-pr-merge-or-fail, retrying GH state. It stays
//     operational for back-compat and is deprecated in phase 11 (H-29).
//   - This validator runs INSIDE state.markDone — a defense-in-depth check
//     that fires even if the worker forgot to call the bash gate. It does
//     NOT attempt a merge; it only verifies. If a PR is unmerged in strict
//     mode, the phase refuses to advance and the operator decides.
//
// All four criteria are best-effort tolerant:
//   - missing output_file with no other criteria → no failure (the criterion
//     simply isn't enforced).
//   - requires_merged_pr with no PR URLs in the log → warn-level note, not a
//     failure (matches gate-mark-done.sh which exits 0 in that case).
//
// CRITICAL invariants:
//   - Pure where possible: takes paths, returns a result. The caller wires
//     audit / alert / state mutation around it.
//   - Safe to run on EVERY mark-done — when success_criteria is omitted the
//     validator returns ok=true after a single object-existence check.
//   - The gh subprocess has a 10s per-PR timeout so a wedged GitHub API
//     can't hang mark-done forever; on timeout the PR-check is treated as a
//     failure (in strict mode) / warn (in warn mode) with reason="gh_timeout".

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type {
  ChainConfig,
  PhaseDefinition,
  PhaseSuccessCriteria,
} from './types.js';

export type EnforceMode = 'warn' | 'strict';

export interface AcceptanceContext {
  /** Chain base dir (used to locate per-phase dispatch logs). */
  chainBaseDir?: string;
  /**
   * Phase id used to pick dispatch log file from chainBaseDir. The dispatcher
   * writes `dispatch-<phase>-<sessionId>-<datetime>-<pid>.log`; we glob the
   * most recent matching file when requires_merged_pr fires.
   */
  phaseId?: number;
  /**
   * Explicit log path override. Tests pass this; production callers pass
   * chainBaseDir+phaseId and let the resolver pick the most recent dispatch
   * log file.
   */
  dispatchLogPath?: string;
  /** Override `gh pr view` invocation (tests pass a stub). */
  ghPrViewer?: (owner: string, repo: string, pr: number) => GhPrState;
  /** Per-PR `gh` timeout (ms). Default 10000. */
  ghTimeoutMs?: number;
}

export interface GhPrState {
  /** MERGED | OPEN | CLOSED | UNKNOWN — the last value normalizes to UNKNOWN. */
  state: 'MERGED' | 'OPEN' | 'CLOSED' | 'UNKNOWN';
  /** True when the gh subprocess timed out before producing a state. */
  timedOut?: boolean;
}

export type AcceptanceCheckKind =
  | 'output_file_exists'
  | 'output_file_min_bytes'
  | 'grep_match'
  | 'requires_merged_pr';

export interface AcceptanceCheck {
  kind: AcceptanceCheckKind;
  ok: boolean;
  reason: string;
  detail?: Record<string, unknown>;
}

export interface AcceptanceResult {
  ok: boolean;
  enforce: EnforceMode;
  checks: AcceptanceCheck[];
  /** Concatenated short summary suitable for an audit-event field. */
  summary: string;
}

export function resolveEnforceMode(
  phase: PhaseDefinition,
  chain_config: ChainConfig | undefined,
): EnforceMode {
  const criteria = phase.success_criteria as PhaseSuccessCriteria | undefined;
  if (criteria && criteria.enforce === 'strict') return 'strict';
  if (criteria && criteria.enforce === 'warn') return 'warn';
  if (phase.acceptance_enforce === 'strict') return 'strict';
  if (phase.acceptance_enforce === 'warn') return 'warn';
  if (chain_config?.acceptance_enforce_default === 'strict') return 'strict';
  return 'warn';
}

const PR_URL_RE = /github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)/g;

export function extractPrRefs(
  logText: string,
): Array<{ owner: string; repo: string; pr: number }> {
  const seen = new Set<string>();
  const refs: Array<{ owner: string; repo: string; pr: number }> = [];
  for (const m of logText.matchAll(PR_URL_RE)) {
    const key = `${m[1]}/${m[2]}#${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ owner: m[1]!, repo: m[2]!, pr: Number(m[3]!) });
  }
  return refs;
}

function resolveDispatchLogPath(
  ctx: AcceptanceContext,
): string | null {
  if (ctx.dispatchLogPath) {
    return existsSync(ctx.dispatchLogPath) ? ctx.dispatchLogPath : null;
  }
  if (!ctx.chainBaseDir || ctx.phaseId === undefined) return null;
  if (!existsSync(ctx.chainBaseDir)) return null;
  const needle = `dispatch-${ctx.phaseId}-`;
  // Most recent dispatch log for this phase — newest mtime wins.
  const matches = readdirSync(ctx.chainBaseDir)
    .filter((n) => n.startsWith(needle) && n.endsWith('.log'))
    .map((n) => {
      const full = join(ctx.chainBaseDir!, n);
      return { full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return matches[0]?.full ?? null;
}

function defaultGhPrViewer(
  owner: string,
  repo: string,
  pr: number,
  timeoutMs: number,
): GhPrState {
  const out = spawnSync(
    'gh',
    ['pr', 'view', String(pr), '--repo', `${owner}/${repo}`, '--json', 'state', '-q', '.state'],
    { encoding: 'utf8', timeout: timeoutMs },
  );
  if (out.error && (out.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
    return { state: 'UNKNOWN', timedOut: true };
  }
  if (out.status !== 0) {
    return { state: 'UNKNOWN' };
  }
  const raw = (out.stdout ?? '').trim().toUpperCase();
  if (raw === 'MERGED' || raw === 'OPEN' || raw === 'CLOSED') {
    return { state: raw };
  }
  return { state: 'UNKNOWN' };
}

/**
 * Run the per-criterion checks for `phase.success_criteria`. Returns an
 * AcceptanceResult that the caller in state.markDone wires into the
 * warn/strict branching. Pure-ish: reads from disk + maybe spawns `gh`,
 * but doesn't mutate state.
 */
export function validateAcceptance(
  phase: PhaseDefinition,
  chain_config: ChainConfig | undefined,
  ctx: AcceptanceContext = {},
): AcceptanceResult {
  const enforce = resolveEnforceMode(phase, chain_config);
  const criteria = (phase.success_criteria ?? {}) as PhaseSuccessCriteria;
  const checks: AcceptanceCheck[] = [];

  // 1. output_file
  if (typeof criteria.output_file === 'string' && criteria.output_file.length > 0) {
    const expanded = expandHome(criteria.output_file);
    if (!existsSync(expanded)) {
      checks.push({
        kind: 'output_file_exists',
        ok: false,
        reason: `output_file does not exist: ${criteria.output_file}`,
        detail: { path: criteria.output_file },
      });
    } else {
      checks.push({
        kind: 'output_file_exists',
        ok: true,
        reason: `output_file exists`,
        detail: { path: criteria.output_file },
      });
      // 2. min_bytes
      const size = statSync(expanded).size;
      if (typeof criteria.min_bytes === 'number') {
        if (size < criteria.min_bytes) {
          checks.push({
            kind: 'output_file_min_bytes',
            ok: false,
            reason: `output_file ${size} bytes < min_bytes ${criteria.min_bytes}`,
            detail: { size, min_bytes: criteria.min_bytes },
          });
        } else {
          checks.push({
            kind: 'output_file_min_bytes',
            ok: true,
            reason: `output_file ${size} bytes >= min_bytes ${criteria.min_bytes}`,
            detail: { size, min_bytes: criteria.min_bytes },
          });
        }
      }
      // 3. grep_match — read the content lazily for both grep_match and any
      // future text-based checks.
      if (typeof criteria.grep_match === 'string' && criteria.grep_match.length > 0) {
        let outputContent: string | null = null;
        try {
          outputContent = readFileSync(expanded, 'utf8');
        } catch (err) {
          checks.push({
            kind: 'grep_match',
            ok: false,
            reason: `failed to read output_file for grep_match: ${(err as Error).message.slice(0, 200)}`,
            detail: { path: criteria.output_file },
          });
        }
        if (outputContent !== null) {
          let regex: RegExp | null = null;
          try {
            regex = new RegExp(criteria.grep_match);
          } catch (err) {
            checks.push({
              kind: 'grep_match',
              ok: false,
              reason: `grep_match regex invalid: ${(err as Error).message.slice(0, 200)}`,
              detail: { pattern: criteria.grep_match },
            });
          }
          if (regex) {
            const matched = regex.test(outputContent);
            checks.push({
              kind: 'grep_match',
              ok: matched,
              reason: matched
                ? `grep_match matched`
                : `grep_match did not match`,
              detail: { pattern: criteria.grep_match },
            });
          }
        }
      }
    }
  } else if (typeof criteria.grep_match === 'string') {
    // grep_match set but no output_file — surface this as a misconfiguration
    // warning. Cheaper than silently passing.
    checks.push({
      kind: 'grep_match',
      ok: false,
      reason: `grep_match set but output_file not configured`,
      detail: { pattern: criteria.grep_match },
    });
  }

  // 4. requires_merged_pr
  if (criteria.requires_merged_pr === true) {
    const logPath = resolveDispatchLogPath(ctx);
    if (!logPath) {
      checks.push({
        kind: 'requires_merged_pr',
        ok: true,
        reason: 'no_dispatch_log_found — nothing to check (matches gate-mark-done.sh semantics)',
        detail: {},
      });
    } else {
      let logText = '';
      try {
        logText = readFileSync(logPath, 'utf8');
      } catch (err) {
        checks.push({
          kind: 'requires_merged_pr',
          ok: false,
          reason: `failed to read dispatch log: ${(err as Error).message.slice(0, 200)}`,
          detail: { log_path: logPath },
        });
      }
      const refs = extractPrRefs(logText);
      if (refs.length === 0) {
        checks.push({
          kind: 'requires_merged_pr',
          ok: true,
          reason: 'no_pr_refs_in_dispatch_log — pass-through (matches gate-mark-done.sh)',
          detail: { log_path: logPath },
        });
      } else {
        const ghTimeout = ctx.ghTimeoutMs ?? 10000;
        const viewer =
          ctx.ghPrViewer ??
          ((o: string, r: string, p: number) =>
            defaultGhPrViewer(o, r, p, ghTimeout));
        for (const ref of refs) {
          const state = viewer(ref.owner, ref.repo, ref.pr);
          if (state.state === 'MERGED') {
            checks.push({
              kind: 'requires_merged_pr',
              ok: true,
              reason: `${ref.owner}/${ref.repo}#${ref.pr} MERGED`,
              detail: { owner: ref.owner, repo: ref.repo, pr: ref.pr },
            });
          } else {
            checks.push({
              kind: 'requires_merged_pr',
              ok: false,
              reason: state.timedOut
                ? `gh_timeout for ${ref.owner}/${ref.repo}#${ref.pr}`
                : `${ref.owner}/${ref.repo}#${ref.pr} state=${state.state} (expected MERGED)`,
              detail: {
                owner: ref.owner,
                repo: ref.repo,
                pr: ref.pr,
                gh_state: state.state,
                gh_timeout: state.timedOut ?? false,
              },
            });
          }
        }
      }
    }
  }

  const ok = checks.every((c) => c.ok);
  const failed = checks.filter((c) => !c.ok);
  const summary = ok
    ? `all_acceptance_checks_passed (${checks.length})`
    : `${failed.length}/${checks.length} acceptance checks failed: ${failed
        .map((c) => `${c.kind}:${c.reason}`)
        .join('; ')
        .slice(0, 500)}`;
  return { ok, enforce, checks, summary };
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    const home = process.env['HOME'] ?? '';
    return home ? join(home, p.slice(2)) : p;
  }
  return p;
}
