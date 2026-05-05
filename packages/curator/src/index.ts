/**
 * @chiefaia/curator — public API.
 *
 * Per `agent/memory/curator_agent_directive.md`: a daily-running CAIA
 * agent that scans the platform across measurable quality dimensions
 * and emits a daily digest of findings ranked by impact / effort.
 *
 * Phase-1 (legs 4-5):
 *   - Scan-loop infrastructure + 5 representative scanners + daily
 *     digest renderer + `caia-curator daily` CLI.
 *
 * Phase-2 (leg-9, action layer covering directive output modes 5..8):
 *   - PR-1 (#338): action types + `findingsToActions` classifier +
 *     `writeAlarms` (mode 7) + `caia-curator emit-alarms`.
 *   - PR-2 (#339): `writePrProposals` (mode 5) + `writeBacklogDirectives`
 *     (mode 6) + `caia-curator emit-pr-proposals` and
 *     `caia-curator emit-backlog-directives`.
 *   - PR-3 (THIS): `loadWatchlist` + `writeIndustryBriefings` (mode 8)
 *     + `runActDay` unified runner + `caia-curator act` CLI.
 */

export { runScan, rankFindings } from './orchestrator.js';
export { renderDigest } from './digest.js';
export { defaultScanContext, defaultRunShell } from './context.js';
export {
  phase1Scanners,
  dependabotCvesScanner,
  memoryDriftScanner,
  openPrAgeScanner,
  staleTodosScanner,
  worktreeCountScanner
} from './scanners/index.js';

export {
  actionSlugForFinding,
  classifyKind,
  defaultAlarmsDir,
  defaultBacklogDirectivesDir,
  defaultIndustryBriefingsDir,
  defaultPrProposalsDir,
  defaultWatchlistPath,
  findingsToActions,
  loadWatchlist,
  renderAlarmMarkdown,
  renderBacklogDirectiveMarkdown,
  renderIndustryBriefingMarkdown,
  renderPrProposalMarkdown,
  runActDay,
  slugify,
  writeAlarms,
  writeBacklogDirectives,
  writeIndustryBriefings,
  writePrProposals
} from './actions/index.js';

export type {
  Category,
  Effort,
  Finding,
  ScanContext,
  Scanner,
  ScanRunResult,
  Severity
} from './types.js';

export type {
  Action,
  ActionKind,
  AlarmAction,
  BacklogDirectiveAction,
  BaseAction,
  EmitResult,
  EmittedActionRef,
  IndustryBriefingAction,
  LoadWatchlistOptions,
  PrProposalAction,
  RunActDayOptions,
  RunActDayResult,
  WatchlistEntry,
  WatchlistFile,
  WriteAlarmsOptions,
  WriteBacklogDirectivesOptions,
  WriteIndustryBriefingsOptions,
  WritePrProposalsOptions
} from './actions/index.js';
