/**
 * @caia/memory-consolidator — public surface.
 *
 * Layer 4 of the AI-first continuous discipline framework.
 * See PLAN.md and EA-REVIEW-OUTCOME.json for the implementation contract.
 */
export {
  runConsolidation,
  CAIA_DEFAULT_CORPUS_ROOT,
  CAIA_DEFAULT_RESEARCH_ROOT,
  CAIA_DEFAULT_REPORTS_ROOT,
} from './run.js';
export { scanCorpus, parseMemoryFile } from './scanner.js';
export { findBrokenReferences } from './cross-referencer.js';
export { findFreshnessIssues } from './freshness-checker.js';
export { surfaceToInbox, dedupKey } from './inbox-surfacer.js';
export { writeReport, renderReport } from './reporter.js';
export { makeNodeFsAdapter, makeMemoryFsAdapter } from './fs-adapter.js';
export type {
  ConsolidatorConfig,
  ConsolidationReport,
  Finding,
  FsAdapter,
  MemoryFile,
  ScanResult,
} from './types.js';
