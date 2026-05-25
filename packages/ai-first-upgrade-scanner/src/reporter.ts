/**
 * Reporter — writes daily_upgrade_scan_YYYY-MM-DD.md.
 */
import * as path from 'node:path';

import type { FsAdapter, ScanReport } from './types.js';

export interface ReporterOptions {
  reportsRoot: string;
  fs: FsAdapter;
  now: Date;
}

export function writeScanReport(report: ScanReport, opts: ReporterOptions): string {
  const date = isoDate(opts.now);
  const file = path.join(opts.reportsRoot, `daily_upgrade_scan_${date}.md`);
  if (!opts.fs.exists(opts.reportsRoot)) opts.fs.mkdirp(opts.reportsRoot);
  opts.fs.writeFile(file, renderReport(report, date));
  return file;
}

export function renderReport(report: ScanReport, date: string): string {
  const lines: string[] = [];
  lines.push(`# AI-First daily upgrade scan — ${date}`);
  lines.push('');
  lines.push(`Run at: ${report.runAt}`);
  lines.push(`Sources scanned: ${report.sourcesScanned}`);
  lines.push(`Items found: ${report.itemsFound}`);
  lines.push(`Items judged: ${report.itemsJudged}`);
  lines.push(`Items relevant (above threshold): ${report.itemsRelevant}`);
  lines.push(`Candidate ADRs drafted: ${report.candidateAdrs.length}`);
  lines.push(`INBOX entries: ${report.inboxEntries}`);
  if (report.dryRun) lines.push(`Mode: DRY-RUN`);
  lines.push('');
  if (report.candidateAdrs.length > 0) {
    lines.push('## Candidate ADRs');
    lines.push('');
    for (const c of report.candidateAdrs) {
      lines.push(`- \`${c.filePath}\``);
    }
    lines.push('');
  }
  if (report.errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const e of report.errors) {
      lines.push(`- [${e.kind}] ${e.sourceId ?? ''} ${e.itemUrl ?? ''} — ${e.message}`);
    }
    lines.push('');
  } else {
    lines.push('No errors.');
  }
  return lines.join('\n');
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
