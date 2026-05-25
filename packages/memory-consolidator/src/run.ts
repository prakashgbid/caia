/**
 * Orchestrator — composes scanner → cross-referencer → freshness-checker
 * → inbox-surfacer → reporter. Returns a ConsolidationReport.
 *
 * Parameterised per Option-E. CAIA defaults inlined here as the SINGLE
 * site that knows the operator's paths.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { findBrokenReferences } from './cross-referencer.js';
import { findFreshnessIssues } from './freshness-checker.js';
import { makeNodeFsAdapter } from './fs-adapter.js';
import { surfaceToInbox } from './inbox-surfacer.js';
import { writeReport } from './reporter.js';
import { scanCorpus } from './scanner.js';
import type { ConsolidationReport, ConsolidatorConfig, Finding } from './types.js';

export const CAIA_DEFAULT_CORPUS_ROOT = path.posix.join(os.homedir(), 'Documents/projects/agent-memory');
export const CAIA_DEFAULT_RESEARCH_ROOT = path.posix.join(os.homedir(), 'Documents/projects/research');
export const CAIA_DEFAULT_REPORTS_ROOT = path.posix.join(os.homedir(), 'Documents/projects/reports');

export async function runConsolidation(config: ConsolidatorConfig = {}): Promise<ConsolidationReport> {
  const fs = config.fs ?? makeNodeFsAdapter();
  const clock = config.clock ?? (() => new Date());
  const now = clock();
  const corpusRoot = config.corpusRoot ?? CAIA_DEFAULT_CORPUS_ROOT;
  const inboxPath = config.inboxPath ?? path.posix.join(corpusRoot, 'INBOX.md');
  const reportsRoot = config.reportsRoot ?? CAIA_DEFAULT_REPORTS_ROOT;
  const dedupeWindowDays = config.dedupeWindowDays ?? 7;
  const indexFileName = config.indexFileName ?? 'MEMORY.md';
  const dryRun = config.dryRun === true;

  const scan = scanCorpus({ corpusRoot, indexFileName, fs });
  const xrefFindings = findBrokenReferences(scan);
  const freshFindings = findFreshnessIssues(scan);
  const findings: Finding[] = [...xrefFindings, ...freshFindings];

  let newInboxEntries = 0;
  if (!dryRun) {
    const surfaced = surfaceToInbox(findings, { inboxPath, fs, now, dedupeWindowDays });
    newInboxEntries = surfaced.newEntries;
  }

  const report: ConsolidationReport = {
    runAt: now.toISOString(),
    filesScanned: scan.files.length,
    findings,
    newInboxEntries,
    reportPath: null,
    dryRun,
  };

  if (!dryRun) {
    const reportPath = writeReport(report, { reportsRoot, fs, now });
    report.reportPath = reportPath;
  }

  return report;
}
