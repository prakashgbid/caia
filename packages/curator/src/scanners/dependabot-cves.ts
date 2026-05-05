/**
 * Dependabot-CVE scanner.
 *
 * Reads the GitHub Dependabot vulnerability feed for the repo and
 * reports counts by severity. Per the directive's dimension #5
 * (Security & Trust: Vulnerability surface) + the operator's
 * subscription-only mandate (no paid feeds — Dependabot is free for
 * private repos).
 *
 * Calls `gh api repos/<owner>/<repo>/dependabot/alerts --paginate`
 * (which uses the operator's gh auth, no API key).
 */

import type { Finding, ScanContext, Scanner } from '../types.js';

const REPO = 'prakashgbid/caia';

interface AlertRow {
  number: number;
  state: 'open' | 'fixed' | 'dismissed' | 'auto_dismissed';
  security_advisory?: {
    severity: 'low' | 'medium' | 'high' | 'critical';
    summary: string;
    cve_id?: string;
  };
  dependency?: {
    package?: { name?: string };
  };
  html_url?: string;
}

interface SeverityCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export const dependabotCvesScanner: Scanner = {
  id: 'dependabot-cves',
  name: 'Dependabot CVE alerts',
  category: 'Security & Trust',
  scan(ctx: ScanContext): Finding[] {
    const findings: Finding[] = [];
    const detectedAt = (ctx.now ?? ((): Date => new Date()))().toISOString();

    let alerts: AlertRow[];
    try {
      const out = ctx.runShell('gh', [
        'api',
        `repos/${REPO}/dependabot/alerts`,
        '--paginate',
        '-H',
        'Accept: application/vnd.github+json'
      ]);
      // The --paginate output concatenates JSON arrays. Stitch them.
      const stitched = out.replace(/\]\s*\[/g, ',');
      alerts = JSON.parse(stitched) as AlertRow[];
    } catch (e) {
      findings.push({
        scannerId: 'dependabot-cves',
        dimension: 'Vulnerability surface',
        category: 'Security & Trust',
        severity: 'low',
        title: 'Could not query Dependabot alerts',
        detail: `gh api dependabot/alerts failed: ${String(e)}`,
        evidence: [`repo: ${REPO}`],
        recommendation:
          'Verify gh CLI is authenticated for this repo + has security_events scope.',
        effort: 'trivial',
        impactScore: 10,
        detectedAt
      });
      return findings;
    }

    const open = alerts.filter((a) => a.state === 'open');
    const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const a of open) {
      const sev = a.security_advisory?.severity;
      if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') {
        counts[sev] += 1;
      }
    }

    if (counts.critical > 0) {
      findings.push({
        scannerId: 'dependabot-cves',
        dimension: 'Vulnerability surface',
        category: 'Security & Trust',
        severity: 'critical',
        title: `${counts.critical} CRITICAL Dependabot CVE(s) open`,
        detail: 'Critical Dependabot alerts must be triaged immediately.',
        evidence: open
          .filter((a) => a.security_advisory?.severity === 'critical')
          .slice(0, 10)
          .map(
            (a) =>
              `${a.security_advisory?.cve_id ?? '(no CVE)'}: ${a.security_advisory?.summary ?? ''} (pkg: ${a.dependency?.package?.name ?? '?'}) ${a.html_url ?? ''}`
          ),
        recommendation:
          'Run `gh api repos/' +
          REPO +
          '/dependabot/alerts?state=open&severity=critical` to triage. For each: bump the affected dep or mark as dismissed-with-justification.',
        effort: 'small',
        impactScore: 95,
        detectedAt
      });
    }
    if (counts.high > 0) {
      findings.push({
        scannerId: 'dependabot-cves',
        dimension: 'Vulnerability surface',
        category: 'Security & Trust',
        severity: 'high',
        title: `${counts.high} HIGH-severity Dependabot CVE(s) open`,
        detail:
          'High-severity Dependabot alerts should be addressed within the current sprint.',
        evidence: open
          .filter((a) => a.security_advisory?.severity === 'high')
          .slice(0, 10)
          .map(
            (a) =>
              `${a.security_advisory?.cve_id ?? '(no CVE)'}: ${a.security_advisory?.summary ?? ''} (pkg: ${a.dependency?.package?.name ?? '?'})`
          ),
        recommendation:
          'Schedule a dependency-bump PR for each affected package; let Dependabot auto-PR and review.',
        effort: 'small',
        impactScore: 80,
        detectedAt
      });
    }
    if (counts.medium > 0 || counts.low > 0) {
      findings.push({
        scannerId: 'dependabot-cves',
        dimension: 'Vulnerability surface',
        category: 'Security & Trust',
        severity: counts.medium > 0 ? 'medium' : 'low',
        title: `${counts.medium} MED + ${counts.low} LOW Dependabot CVE(s) open`,
        detail: 'Medium / low alerts can be batched into the next dependency-hygiene PR.',
        evidence: [`mediumCount: ${counts.medium}`, `lowCount: ${counts.low}`],
        recommendation:
          'Track in the next dependency-hygiene PR; do not let the queue grow unbounded.',
        effort: 'medium',
        impactScore: counts.medium > 0 ? 40 : 20,
        detectedAt
      });
    }
    if (open.length === 0) {
      findings.push({
        scannerId: 'dependabot-cves',
        dimension: 'Vulnerability surface',
        category: 'Security & Trust',
        severity: 'info',
        title: 'No open Dependabot CVE alerts',
        detail: 'Vulnerability surface clean as of this scan.',
        evidence: [`totalAlerts: ${alerts.length}`, `openAlerts: 0`],
        recommendation: 'No action.',
        effort: 'trivial',
        impactScore: 5,
        detectedAt
      });
    }

    return findings;
  }
};
