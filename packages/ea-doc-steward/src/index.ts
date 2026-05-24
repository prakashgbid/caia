/**
 * @caia/ea-doc-steward — public surface.
 *
 * The Documentation Steward: auto-files ADRs from approved EA reviews,
 * maintains repository freshness, validates supersession graphs, and
 * keeps INDEX files current.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §4.5.
 */

export { AdrFiler } from './adr-filer.js';
export { RepoFreshnessChecker } from './repo-freshness.js';
export { IndexMaintainer, type SignoffIndexEntry } from './index-maintainer.js';
export {
  validateSupersessionGraph,
  parseSupersedes,
  parseSupersededBy
} from './supersession-graph.js';

export type {
  StewardFilingInput,
  StewardFilingOutput,
  FiledAdrRef,
  SupersessionGraphValidation,
  IndexMaintenanceResult,
  StaleAdrFinding,
  FreshnessReport,
  DocStewardConfig,
  IndexEntry,
  AdrRecord
} from './types.js';
