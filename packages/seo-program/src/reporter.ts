import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { AuditResult, DeltaReport, Finding, Severity } from './types.js';

const SEV_ORDER: Severity[] = ['critical', 'major', 'minor', 'info'];

function sevIcon(sev: Severity): string {
  return { critical: '✗', major: '!', minor: '~', info: 'i' }[sev];
}

function severityLine(f: Finding): string {
  return `  ${sevIcon(f.severity)} [${f.severity.toUpperCase().padEnd(8)}] ${f.message}`;
}

export function printReport(result: AuditResult): void {
  const { url, composite, grade, ttfb, dimensions, findings } = result;

  console.log('\n' + '═'.repeat(70));
  console.log(`SEO AUDIT: ${url}`);
  console.log(`Score: ${composite}/100 (${grade})   TTFB: ${ttfb}ms   Findings: ${findings.length}`);
  console.log('═'.repeat(70));

  for (const dim of dimensions) {
    const bar = '█'.repeat(Math.round(dim.score / 10)) + '░'.repeat(10 - Math.round(dim.score / 10));
    console.log(`\n${dim.label.padEnd(20)} ${String(dim.score).padStart(3)}/100  ${bar}`);
    const sevFindings = SEV_ORDER.flatMap(sev => dim.findings.filter(f => f.severity === sev));
    for (const f of sevFindings.slice(0, 5)) {
      console.log(severityLine(f));
    }
    if (sevFindings.length > 5) console.log(`  … and ${sevFindings.length - 5} more`);
  }

  console.log('\n' + '─'.repeat(70));
  const criticals = findings.filter(f => f.severity === 'critical');
  if (criticals.length > 0) {
    console.log(`TOP PRIORITY (${criticals.length} critical):`);
    for (const f of criticals) {
      console.log(`  → ${f.message}`);
      console.log(`    Fix: ${f.suggestedFix}`);
    }
  }
  console.log('');
}

export function saveJson(result: AuditResult, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const hostname = new URL(result.url).hostname.replace(/\./g, '-');
  const ts = result.timestamp.replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${hostname}-${ts}.json`;
  const path = join(dir, filename);
  writeFileSync(path, JSON.stringify(result, null, 2));
  return path;
}

export function saveHtml(result: AuditResult, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const hostname = new URL(result.url).hostname.replace(/\./g, '-');
  const ts = result.timestamp.replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${hostname}-${ts}.html`;
  const path = join(dir, filename);

  const rows = result.findings.map(f => `
    <tr class="sev-${f.severity}">
      <td><span class="badge ${f.severity}">${f.severity}</span></td>
      <td>${f.dimension}</td>
      <td>${f.message}</td>
      <td>${f.suggestedFix}</td>
      <td>${f.estimatedImpact}/10</td>
    </tr>`).join('');

  const dimCards = result.dimensions.map(d => `
    <div class="dim-card">
      <div class="dim-score">${d.score}</div>
      <div class="dim-label">${d.label}</div>
      <div class="dim-bar"><div class="dim-fill" style="width:${d.score}%"></div></div>
    </div>`).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SEO Report — ${result.url}</title>
<style>
  :root{--bg:#0f172a;--surface:#1e293b;--border:#334155;--text:#e2e8f0;--muted:#94a3b8;--green:#22c55e;--yellow:#eab308;--orange:#f97316;--red:#ef4444}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:system-ui,sans-serif;padding:2rem}
  h1{font-size:1.5rem;margin-bottom:.5rem}
  .meta{color:var(--muted);font-size:.875rem;margin-bottom:2rem}
  .score-hero{font-size:4rem;font-weight:700;line-height:1}
  .grade{font-size:2rem;font-weight:700;margin-left:.5rem}
  .dims{display:flex;flex-wrap:wrap;gap:1rem;margin:1.5rem 0}
  .dim-card{background:var(--surface);border:1px solid var(--border);border-radius:.5rem;padding:1rem;min-width:160px}
  .dim-score{font-size:2rem;font-weight:700}
  .dim-label{font-size:.75rem;color:var(--muted);margin:.25rem 0 .5rem}
  .dim-bar{background:var(--border);border-radius:9999px;height:6px}
  .dim-fill{background:var(--green);border-radius:9999px;height:6px}
  table{width:100%;border-collapse:collapse;font-size:.875rem}
  th{background:var(--surface);text-align:left;padding:.5rem .75rem;border-bottom:1px solid var(--border);color:var(--muted)}
  td{padding:.5rem .75rem;border-bottom:1px solid var(--border);vertical-align:top}
  .badge{display:inline-block;padding:.125rem .375rem;border-radius:.25rem;font-size:.75rem;font-weight:600;text-transform:uppercase}
  .badge.critical{background:var(--red);color:#fff}
  .badge.major{background:var(--orange);color:#fff}
  .badge.minor{background:var(--yellow);color:#000}
  .badge.info{background:var(--muted);color:#000}
  .sev-critical td:first-child{border-left:3px solid var(--red)}
  .sev-major td:first-child{border-left:3px solid var(--orange)}
</style>
</head>
<body>
<h1>SEO Audit Report</h1>
<div class="meta">${result.url} &middot; ${result.timestamp} &middot; TTFB: ${result.ttfb}ms</div>
<div class="score-hero">${result.composite}<span class="grade">${result.grade}</span></div>
<div class="dims">${dimCards}</div>
<table>
  <thead><tr><th>Severity</th><th>Dimension</th><th>Finding</th><th>Fix</th><th>Impact</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body>
</html>`;

  writeFileSync(path, html);
  return path;
}

export function printDelta(delta: DeltaReport): void {
  const sign = delta.delta >= 0 ? '+' : '';
  console.log(`\nDELTA REPORT: ${delta.url}`);
  console.log(`Score: ${delta.before.composite} → ${delta.after.composite} (${sign}${delta.delta})`);
  if (delta.improved.length > 0) console.log(`Fixed: ${delta.improved.map(f => f.id).join(', ')}`);
  if (delta.regressed.length > 0) console.log(`Regressed: ${delta.regressed.map(f => f.id).join(', ')}`);
}
