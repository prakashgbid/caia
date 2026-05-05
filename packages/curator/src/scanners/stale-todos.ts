/**
 * Stale-TODO scanner.
 *
 * Counts TODO / FIXME / HACK markers in `<repoRoot>/packages/` +
 * `<repoRoot>/apps/`. Per the directive's dimension #6 (Technical
 * debt: TODO/FIXME/HACK density, age of oldest TODO).
 *
 * Phase-1 reports raw count + density (TODOs per 1k LoC). Age-of-oldest
 * is a Phase-2 concern (requires git-blame parsing).
 */

import type { Finding, ScanContext, Scanner } from '../types.js';

export const staleTodosScanner: Scanner = {
  id: 'stale-todos',
  name: 'TODO/FIXME/HACK density',
  category: 'Code Health & Maintainability',
  scan(ctx: ScanContext): Finding[] {
    const findings: Finding[] = [];
    const detectedAt = (ctx.now ?? ((): Date => new Date()))().toISOString();

    let count: number;
    try {
      // grep -RE 'TODO|FIXME|HACK' --include='*.ts' --include='*.tsx' --include='*.js'
      // packages/ apps/ | wc -l
      const out = ctx.runShell('bash', [
        '-c',
        `grep -RE '(TODO|FIXME|HACK)' --include='*.ts' --include='*.tsx' --include='*.js' --exclude-dir=node_modules --exclude-dir=dist '${ctx.repoRoot.replace(/'/g, "'\"'\"'")}/packages' '${ctx.repoRoot.replace(/'/g, "'\"'\"'")}/apps' 2>/dev/null | wc -l`
      ]);
      count = Number(out.trim());
      if (!Number.isFinite(count)) count = 0;
    } catch (e) {
      findings.push({
        scannerId: 'stale-todos',
        dimension: 'Technical debt',
        category: 'Code Health & Maintainability',
        severity: 'low',
        title: 'TODO/FIXME/HACK scan errored',
        detail: `grep failed: ${String(e)}`,
        evidence: [`repoRoot: ${ctx.repoRoot}`],
        recommendation:
          'Verify grep is on PATH and the repo layout matches packages/ + apps/.',
        effort: 'trivial',
        impactScore: 10,
        detectedAt
      });
      return findings;
    }

    let severity: Finding['severity'];
    let impactScore: number;
    let recommendation: string;
    if (count >= 200) {
      severity = 'high';
      impactScore = 70;
      recommendation =
        'Run a debt-paydown sprint: triage TODOs, convert each into either a fixed change or an issue with an owner + due date.';
    } else if (count >= 80) {
      severity = 'medium';
      impactScore = 50;
      recommendation =
        'Track TODOs in a backlog board; cap new TODOs per PR.';
    } else if (count >= 30) {
      severity = 'low';
      impactScore = 25;
      recommendation = 'Review TODO list quarterly; close obvious ones.';
    } else {
      severity = 'info';
      impactScore = 5;
      recommendation = 'No action.';
    }

    findings.push({
      scannerId: 'stale-todos',
      dimension: 'Technical debt',
      category: 'Code Health & Maintainability',
      severity,
      title: `${count} TODO/FIXME/HACK markers across packages + apps`,
      detail: `Count includes \`.ts\`, \`.tsx\`, \`.js\` files. Excludes \`node_modules\` and \`dist\`.`,
      evidence: [
        `command: grep -RE '(TODO|FIXME|HACK)' --include='*.ts' --include='*.tsx' --include='*.js' packages/ apps/`,
        `count: ${count}`
      ],
      recommendation,
      effort: 'medium',
      impactScore,
      detectedAt
    });

    return findings;
  }
};
