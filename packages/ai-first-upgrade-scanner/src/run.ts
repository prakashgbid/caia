/**
 * Orchestrator - composes loadSourceList -> scanSources -> filterItems ->
 * draftCandidateAdrs -> surfaceCandidates -> writeScanReport.
 */
import { fileURLToPath } from "node:url";
import * as os from "node:os";
import * as path from "node:path";

import { draftCandidateAdrs } from "./candidate-adr-drafter.js";
import { makeNodeFsAdapter } from "./fs-adapter.js";
import { surfaceCandidates } from "./inbox-surfacer.js";
import { NullRelevanceCritic, filterItems } from "./relevance-filter.js";
import { writeScanReport } from "./reporter.js";
import { NullWebSearcher, loadSourceList, scanSources } from "./searcher.js";
import type { ScanReport, ScannerConfig } from "./types.js";

export const CAIA_DEFAULT_DECISIONS_ROOT = path.posix.join(os.homedir(), "Documents/projects/caia-ea/decisions");
export const CAIA_DEFAULT_INBOX_PATH = path.posix.join(os.homedir(), "Documents/projects/agent-memory/INBOX.md");
export const CAIA_DEFAULT_REPORTS_ROOT = path.posix.join(os.homedir(), "Documents/projects/reports");

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CAIA_DEFAULT_SOURCES_PATH = path.posix.join(HERE, "..", "sources", "00-default-sources.json");

export async function runScan(config: ScannerConfig = {}): Promise<ScanReport> {
  const fs = config.fs ?? makeNodeFsAdapter();
  const clock = config.clock ?? (() => new Date());
  const now = clock();
  const sourcesPath = config.sourcesPath ?? CAIA_DEFAULT_SOURCES_PATH;
  const decisionsRoot = config.decisionsRoot ?? CAIA_DEFAULT_DECISIONS_ROOT;
  const inboxPath = config.inboxPath ?? CAIA_DEFAULT_INBOX_PATH;
  const reportsRoot = config.reportsRoot ?? CAIA_DEFAULT_REPORTS_ROOT;
  const searcher = config.webSearcher ?? new NullWebSearcher();
  const critic = config.relevanceCritic ?? new NullRelevanceCritic();
  const confidenceThreshold = config.confidenceThreshold ?? 0.7;
  const dailyCap = config.inboxDailyCap ?? 5;
  const lookbackHours = config.lookbackHours ?? 24;
  const sinceIso = new Date(now.getTime() - lookbackHours * 3_600_000).toISOString();

  const sources = loadSourceList(sourcesPath, fs);
  const { results, errors: searchErrors } = await scanSources({ sources, searcher, sinceIso });
  const { judged, relevant, errors: judgeErrors } = await filterItems({ items: results, critic, confidenceThreshold });
  const { drafts, errors: draftErrors } = draftCandidateAdrs({ judged: relevant, decisionsRoot, fs, now });
  const surface = surfaceCandidates(relevant, drafts, { inboxPath, fs, now, dailyCap });

  const report: ScanReport = {
    runAt: now.toISOString(),
    sourcesScanned: sources.length,
    itemsFound: results.length,
    itemsJudged: judged.length,
    itemsRelevant: relevant.length,
    candidateAdrs: drafts,
    inboxEntries: surface.newEntries,
    reportPath: null,
    errors: [
      ...searchErrors.map((e) => ({ kind: "search-error" as const, sourceId: e.sourceId, message: e.message })),
      ...judgeErrors,
      ...draftErrors,
    ],
    dryRun: false,
  };

  const reportPath = writeScanReport(report, { reportsRoot, fs, now });
  report.reportPath = reportPath;
  return report;
}
