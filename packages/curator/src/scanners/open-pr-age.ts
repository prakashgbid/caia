/**
 * Open-PR age scanner.
 *
 * Reads `gh pr list --state open --json number,title,createdAt,author`
 * and reports any PR older than 7 days. Per the directive's dimension
 * #6 (Code Health: Git hygiene) + dimension #7 (Velocity: PR lifecycle).
 *
 * Pulls the operator's own PRs by default — Curator should not nag
 * about other people's PRs in our team setup. Filter is `--author @me`.
 */

import type { Finding, ScanContext, Scanner } from '../types.js';

interface PrRow {
  number: number;
  title: string;
  createdAt: string;
  author?: { login: string };
  url?: string;
}

const STALE_DAYS = 7;
const VERY_STALE_DAYS = 30;

export const openPrAgeScanner: Scanner = {
  id: 'open-pr-age',
  name: 'Open PR age',
  category: 'Code Health & Maintainability',
  scan(ctx: ScanContext): Finding[] {
    const findings: Finding[] = [];
    const detectedAt = (ctx.now ?? ((): Date => new Date()))().toISOString();

    let rows: PrRow[];
    try {
      const out = ctx.runShell('gh', [
        'pr',
        'list',
        '--state',
        'open',
        '--author',
        '@me',
        '--json',
        'number,title,createdAt,author,url',
        '--limit',
        '50'
      ]);
      rows = JSON.parse(out) as PrRow[];
    } catch (e) {
      findings.push({
        scannerId: 'open-pr-age',
        dimension: 'Git hygiene',
        category: 'Code Health & Maintainability',
        severity: 'low',
        title: 'Could not query open PRs',
        detail: `gh pr list failed: ${String(e)}`,
        evidence: [],
        recommendation:
          'Verify gh CLI is installed and authenticated. Curator runs without the open-PR-age check until this is resolved.',
        effort: 'trivial',
        impactScore: 10,
        detectedAt
      });
      return findings;
    }

    const now = (ctx.now ?? ((): Date => new Date()))();
    const stale: Array<{ row: PrRow; ageDays: number }> = [];
    const veryStale: Array<{ row: PrRow; ageDays: number }> = [];
    for (const row of rows) {
      const created = new Date(row.createdAt);
      const ageDays = (now.getTime() - created.getTime()) / (24 * 60 * 60 * 1000);
      if (ageDays >= VERY_STALE_DAYS) {
        veryStale.push({ row, ageDays });
      } else if (ageDays >= STALE_DAYS) {
        stale.push({ row, ageDays });
      }
    }

    if (veryStale.length > 0) {
      findings.push({
        scannerId: 'open-pr-age',
        dimension: 'Git hygiene',
        category: 'Code Health & Maintainability',
        severity: 'high',
        title: `${veryStale.length} open PR(s) older than ${VERY_STALE_DAYS} days`,
        detail:
          'Per `feedback_pr_lifecycle_and_branching.md`, PRs are not done until merged. Long-stale PRs accumulate rebase debt + block other work.',
        evidence: veryStale.map(
          (e) =>
            `#${e.row.number} ${e.row.title} (age ${Math.round(e.ageDays)}d) ${e.row.url ?? ''}`
        ),
        recommendation:
          'Drive each long-stale PR to merge or explicit close. If blocked, document the blocker in the PR description.',
        effort: 'medium',
        impactScore: 70,
        detectedAt
      });
    }
    if (stale.length > 0) {
      findings.push({
        scannerId: 'open-pr-age',
        dimension: 'Git hygiene',
        category: 'Code Health & Maintainability',
        severity: 'medium',
        title: `${stale.length} open PR(s) older than ${STALE_DAYS} days`,
        detail:
          'Aging open PRs hint at scope drift, missing review feedback, or forgotten work.',
        evidence: stale.map(
          (e) =>
            `#${e.row.number} ${e.row.title} (age ${Math.round(e.ageDays)}d) ${e.row.url ?? ''}`
        ),
        recommendation:
          'Review each: rebase + push, ping for review, or close with a follow-up issue.',
        effort: 'small',
        impactScore: 40,
        detectedAt
      });
    }
    if (stale.length === 0 && veryStale.length === 0) {
      findings.push({
        scannerId: 'open-pr-age',
        dimension: 'Git hygiene',
        category: 'Code Health & Maintainability',
        severity: 'info',
        title: 'No stale open PRs',
        detail: `${rows.length} open PR(s) authored by current user; none older than ${STALE_DAYS} days.`,
        evidence: [`openPrCount: ${rows.length}`],
        recommendation: 'No action.',
        effort: 'trivial',
        impactScore: 5,
        detectedAt
      });
    }

    return findings;
  }
};
