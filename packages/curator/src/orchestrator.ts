/**
 * Curator scan orchestrator.
 *
 * Runs N scanners over a ScanContext, catches per-scanner errors so a
 * single broken scanner doesn't wedge the whole run, and returns a
 * ScanRunResult that the digest renderer turns into markdown.
 *
 * The orchestrator is deliberately small + sync-friendly. Scanners
 * declare async if they need to (Phase-1 ones are sync-fast).
 */

import type { Finding, ScanContext, Scanner, ScanRunResult } from './types.js';

/**
 * Run all `scanners` against `ctx`. Each scanner is awaited in turn
 * (sequential by default — most scanners are fast and sequential is
 * easier to debug). If a scanner throws, the error is recorded in
 * `perScanner[*].error` and the next scanner runs. Findings from prior
 * scanners are preserved.
 */
export async function runScan(
  scanners: Scanner[],
  ctx: ScanContext
): Promise<ScanRunResult> {
  const startedAt = new Date().toISOString();
  const findings: Finding[] = [];
  const perScanner: ScanRunResult['perScanner'] = [];

  for (const sc of scanners) {
    const t0 = Date.now();
    let scannerFindings: Finding[] = [];
    let error: string | null = null;
    try {
      const ret = await sc.scan(ctx);
      scannerFindings = ret;
    } catch (e) {
      error = String(e);
    }
    const durationMs = Date.now() - t0;
    perScanner.push({
      scannerId: sc.id,
      name: sc.name,
      durationMs,
      findingCount: scannerFindings.length,
      error
    });
    findings.push(...scannerFindings);
  }

  const endedAt = new Date().toISOString();
  return { startedAt, endedAt, findings, perScanner };
}

/**
 * Rank findings by impact / effort. Used by the digest renderer to
 * surface the highest-leverage items at the top.
 *
 * effortWeight: trivial=1, small=2, medium=4, large=8, xlarge=16.
 * priority   = impactScore / effortWeight.
 *
 * Critical-severity findings bypass the ranking + always come first
 * (they're flagged for immediate attention regardless of effort).
 */
export function rankFindings(findings: Finding[]): Finding[] {
  const effortWeight: Record<string, number> = {
    trivial: 1,
    small: 2,
    medium: 4,
    large: 8,
    xlarge: 16
  };
  const ranked = [...findings];
  ranked.sort((a, b) => {
    if (a.severity === 'critical' && b.severity !== 'critical') return -1;
    if (b.severity === 'critical' && a.severity !== 'critical') return 1;
    const pa = a.impactScore / (effortWeight[a.effort] ?? 4);
    const pb = b.impactScore / (effortWeight[b.effort] ?? 4);
    return pb - pa;
  });
  return ranked;
}
