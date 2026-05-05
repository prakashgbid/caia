/**
 * Worktree-count scanner.
 *
 * Per `feedback_operational_discipline.md`: worktree budget ≤8 alarm,
 * ≤12 hard-block. Per the directive's dimension #4 (Concurrency
 * safety) + #6 (Coordination failure).
 *
 * Reads `git worktree list --porcelain` and reports the count.
 */

import type { Finding, ScanContext, Scanner } from '../types.js';

const ALARM_THRESHOLD = 8;
const HARD_BLOCK_THRESHOLD = 12;

export const worktreeCountScanner: Scanner = {
  id: 'worktree-count',
  name: 'Git worktree count',
  category: 'Reliability & Resilience',
  scan(ctx: ScanContext): Finding[] {
    const findings: Finding[] = [];
    const detectedAt = (ctx.now ?? ((): Date => new Date()))().toISOString();

    let lines: string[];
    let count: number;
    try {
      const out = ctx.runShell('git', [
        '-C',
        ctx.repoRoot,
        'worktree',
        'list',
        '--porcelain'
      ]);
      // Each worktree is a block separated by blank lines, starting with `worktree <path>`.
      lines = out.split('\n');
      count = lines.filter((l) => l.startsWith('worktree ')).length;
    } catch (e) {
      findings.push({
        scannerId: 'worktree-count',
        dimension: 'Coordination failure',
        category: 'Reliability & Resilience',
        severity: 'low',
        title: 'Could not count git worktrees',
        detail: `git worktree list failed: ${String(e)}`,
        evidence: [`repoRoot: ${ctx.repoRoot}`],
        recommendation:
          'Verify repoRoot is a valid git checkout and git is on PATH.',
        effort: 'trivial',
        impactScore: 10,
        detectedAt
      });
      return findings;
    }

    let severity: Finding['severity'];
    let impactScore: number;
    let recommendation: string;
    if (count >= HARD_BLOCK_THRESHOLD) {
      severity = 'critical';
      impactScore = 95;
      recommendation =
        'Worktree count crossed the hard-block threshold (≥12). Stop spawning new concurrent work; clean up stale worktrees with `git worktree remove <path>` before resuming.';
    } else if (count >= ALARM_THRESHOLD) {
      severity = 'high';
      impactScore = 80;
      recommendation =
        'Worktree count crossed the alarm threshold (≥8). Audit + cleanup before adding more.';
    } else {
      severity = 'info';
      impactScore = 5;
      recommendation = 'No action.';
    }

    const worktrees = lines
      .filter((l) => l.startsWith('worktree '))
      .map((l) => l.slice('worktree '.length));

    findings.push({
      scannerId: 'worktree-count',
      dimension: 'Coordination failure',
      category: 'Reliability & Resilience',
      severity,
      title: `${count} active git worktree(s) (alarm @${ALARM_THRESHOLD}, hard-block @${HARD_BLOCK_THRESHOLD})`,
      detail: `Per \`feedback_operational_discipline.md\` worktree budget rules.`,
      evidence: worktrees.slice(0, 15).map((p) => `worktree: ${p}`),
      recommendation,
      effort: 'trivial',
      impactScore,
      detectedAt
    });

    return findings;
  }
};
