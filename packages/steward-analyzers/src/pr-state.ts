/**
 * PR-state analyzers — failure modes #10 (PR stale > 14d / 30d) and
 * #11 (dependabot DIRTY > 30 days).
 *
 * Per architecture doc §3.10 + §3.11. These run via:
 *
 *   - `hygiene-report.yml` daily cron — appends a "Stale PRs" section
 *     to the daily Git Hygiene issue + recommends auto-close for
 *     >30d PRs that aren't labelled `keep-open`.
 *   - A new weekly cron — produces a per-ecosystem dependabot triage
 *     issue listing every DIRTY dependabot PR by npm / pip / docker /
 *     github-actions.
 *
 * Pure analyzer functions; CLI shim is responsible for `gh pr list`
 * + `gh pr close` side-effects.
 */

import type { Finding, Severity } from './types.js';

// ── Failure mode #10 — PRs stale > 14 days no activity ────────────────────

export interface PrRecord {
  number: number;
  title: string;
  /** Branch name (headRefName). */
  branch: string;
  /** ISO timestamp of last activity (`updatedAt`). */
  updatedAt: string;
  /** Labels on the PR. */
  labels: ReadonlyArray<string>;
  /** Whether the PR is a draft. */
  isDraft: boolean;
  /** Author login (e.g. 'app/dependabot' or 'prakashgbid'). */
  author: string;
}

export interface CheckPrStalenessOptions {
  prs: ReadonlyArray<PrRecord>;
  /** Reference now-ms. Default Date.now(). */
  nowMs?: number;
  /** Days above which severity is medium (warn). Default 14. */
  warnDays?: number;
  /** Days above which a recommend-auto-close action triggers. Default 30. */
  autoCloseDays?: number;
  /** Labels that pin a PR open regardless of staleness. Default ['keep-open']. */
  keepOpenLabels?: ReadonlyArray<string>;
  /**
   * Author logins to skip from auto-close (still listed for triage).
   * Default ['app/dependabot'] (handled in failure-mode 11 instead).
   */
  skipAutoCloseAuthors?: ReadonlyArray<string>;
}

const DAY_MS = 86_400_000;

export function checkPrStaleness({
  prs,
  nowMs = Date.now(),
  warnDays = 14,
  autoCloseDays = 30,
  keepOpenLabels = ['keep-open'],
  skipAutoCloseAuthors = ['app/dependabot'],
}: CheckPrStalenessOptions): Finding[] {
  const findings: Finding[] = [];
  for (const pr of prs) {
    const updatedMs = Date.parse(pr.updatedAt);
    if (Number.isNaN(updatedMs)) continue;
    const ageDays = Math.floor((nowMs - updatedMs) / DAY_MS);
    if (ageDays < warnDays) continue;
    if (pr.labels.some((l) => keepOpenLabels.includes(l))) continue;

    const eligibleForAutoClose =
      ageDays >= autoCloseDays && !skipAutoCloseAuthors.includes(pr.author);
    const severity: Severity = eligibleForAutoClose ? 'medium' : 'medium';

    findings.push({
      analyzer: 'pr-state',
      ruleId: eligibleForAutoClose ? 'pr-stale-auto-close' : 'pr-stale-warn',
      path: `pr#${pr.number}`,
      severity,
      message: eligibleForAutoClose
        ? `PR #${pr.number} (${pr.branch}) idle ${ageDays}d - eligible for auto-close. Title: ${pr.title}`
        : `PR #${pr.number} (${pr.branch}) idle ${ageDays}d - warn threshold ${warnDays}d. Title: ${pr.title}`,
      remediation: eligibleForAutoClose
        ? `gh pr close ${pr.number} --comment "Stale (>30d no activity); reopen if needed. Reference: agent/memory/feedback_git_flow_enforced.md"`
        : `Review + ship or archive: gh pr ready ${pr.number} or label keep-open if intentionally on hold`,
      context: {
        prNumber: pr.number,
        ageDays,
        author: pr.author,
        eligibleForAutoClose,
      },
    });
  }
  return findings;
}

// ── Failure mode #11 — dependabot DIRTY > 30 days ──────────────────────────

export interface DependabotPrRecord {
  number: number;
  title: string;
  branch: string;
  updatedAt: string;
  /** GitHub mergeStateStatus — DIRTY indicates conflicts vs base. */
  mergeStateStatus: 'CLEAN' | 'DIRTY' | 'UNSTABLE' | 'BEHIND' | 'BLOCKED' | 'UNKNOWN';
  /** Ecosystem inferred from branch name or labels (npm | pip | docker | github-actions). */
  ecosystem: string;
}

export interface CheckDependabotTriageOptions {
  prs: ReadonlyArray<DependabotPrRecord>;
  nowMs?: number;
  /** Days above which severity is medium (warn). Default 7. */
  warnDays?: number;
  /** Days above which severity is high (security risk). Default 30. */
  highDays?: number;
}

export function checkDependabotTriage({
  prs,
  nowMs = Date.now(),
  warnDays = 7,
  highDays = 30,
}: CheckDependabotTriageOptions): Finding[] {
  const findings: Finding[] = [];
  for (const pr of prs) {
    if (pr.mergeStateStatus !== 'DIRTY') continue;
    const updatedMs = Date.parse(pr.updatedAt);
    if (Number.isNaN(updatedMs)) continue;
    const ageDays = Math.floor((nowMs - updatedMs) / DAY_MS);
    if (ageDays < warnDays) continue;
    const severity: Severity = ageDays >= highDays ? 'high' : 'medium';
    findings.push({
      analyzer: 'pr-state',
      ruleId: 'dependabot-dirty',
      path: `pr#${pr.number}`,
      severity,
      message: `Dependabot PR #${pr.number} (${pr.ecosystem}) DIRTY for ${ageDays}d. Security exposure window growing.`,
      remediation: `On the PR: comment '@dependabot rebase' OR close + let dependabot reopen against latest base.`,
      context: {
        prNumber: pr.number,
        ecosystem: pr.ecosystem,
        ageDays,
        warnDays,
        highDays,
      },
    });
  }
  return findings;
}

// ── Helpers — group dependabot findings by ecosystem for triage rendering ──

export function groupDependabotByEcosystem(
  findings: ReadonlyArray<Finding>,
): Record<string, Finding[]> {
  const out: Record<string, Finding[]> = {};
  for (const f of findings) {
    if (f.analyzer !== 'pr-state' || f.ruleId !== 'dependabot-dirty') continue;
    const eco = (f.context?.ecosystem as string) ?? 'unknown';
    if (!out[eco]) out[eco] = [];
    out[eco].push(f);
  }
  return out;
}
