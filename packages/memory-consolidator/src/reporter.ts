/**
 * Reporter — renders the daily consolidation report markdown and writes
 * it to `<reportsRoot>/memory_consolidation_YYYY-MM-DD.md`.
 */
import * as path from 'node:path';

import type { ConsolidationReport, Finding, FsAdapter } from './types.js';

export interface ReporterOptions {
  reportsRoot: string;
  fs: FsAdapter;
  now: Date;
}

export function writeReport(report: ConsolidationReport, opts: ReporterOptions): string {
  const date = isoDate(opts.now);
  const file = path.join(opts.reportsRoot, `memory_consolidation_${date}.md`);
  if (!opts.fs.exists(opts.reportsRoot)) opts.fs.mkdirp(opts.reportsRoot);
  opts.fs.writeFile(file, renderReport(report, date));
  return file;
}

export function renderReport(report: ConsolidationReport, date: string): string {
  const byKind = new Map<string, Finding[]>();
  for (const f of report.findings) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }
  const lines: string[] = [];
  lines.push(`# Memory consolidation — ${date}`);
  lines.push('');
  lines.push(`Run at: ${report.runAt}`);
  lines.push(`Files scanned: ${report.filesScanned}`);
  lines.push(`Total findings: ${report.findings.length}`);
  lines.push(`New INBOX entries: ${report.newInboxEntries}`);
  if (report.dryRun) lines.push(`Mode: DRY-RUN`);
  lines.push('');
  if (report.findings.length === 0) {
    lines.push('No drift detected.');
    return lines.join('\n');
  }
  for (const [kind, list] of [...byKind.entries()].sort()) {
    lines.push(`## ${kind} (${list.length})`);
    lines.push('');
    for (const f of list) {
      lines.push(`- \`${f.sourceRelPath}\` — ${f.detail}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
