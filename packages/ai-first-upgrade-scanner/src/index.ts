/**
 * @caia/ai-first-upgrade-scanner public surface.
 */
export {
  runScan,
  CAIA_DEFAULT_DECISIONS_ROOT,
  CAIA_DEFAULT_INBOX_PATH,
  CAIA_DEFAULT_REPORTS_ROOT,
  CAIA_DEFAULT_SOURCES_PATH,
} from "./run.js";
export { NullWebSearcher, CannedWebSearcher, loadSourceList, scanSources } from "./searcher.js";
export { NullRelevanceCritic, StubRelevanceCritic, filterItems } from "./relevance-filter.js";
export { draftCandidateAdrs, renderCandidate, slugify } from "./candidate-adr-drafter.js";
export { surfaceCandidates } from "./inbox-surfacer.js";
export { writeScanReport, renderReport } from "./reporter.js";
export { makeNodeFsAdapter, makeMemoryFsAdapter } from "./fs-adapter.js";
export type {
  ScannerConfig,
  ScanReport,
  ScanError,
  Source,
  SourceList,
  SearchResult,
  RelevanceVerdict,
  JudgedItem,
  CandidateAdr,
  WebSearcher,
  RelevanceCritic,
  FsAdapter,
} from "./types.js";
