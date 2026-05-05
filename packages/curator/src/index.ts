/**
 * @chiefaia/curator — public API.
 *
 * Per `agent/memory/curator_agent_directive.md`: a daily-running CAIA
 * agent that scans the platform across measurable quality dimensions
 * and emits a daily digest of findings ranked by impact / effort.
 *
 * Phase-1 (legs 4-5) shipped:
 *   - The scan-loop infrastructure (Scanner interface + orchestrator
 *     + digest renderer).
 *   - 5 representative scanners covering 4 of the 10 directive
 *     categories (worktree count, open-PR age, memory drift, stale
 *     TODOs, Dependabot CVEs).
 *   - `caia-curator daily` CLI that runs the scanners + writes the
 *     digest to `~/Documents/projects/reports/curator/<date>-digest.md`.
 *
 * Phase-2 (leg-9, this layer) adds the **action layer** on top — per
 * the directive's output modes 5..8 (PR proposals, backlog directives,
 * alarms, industry briefings). Phase-2 ships incrementally:
 *   - PR-1: action types + `findingsToActions` classifier + alarm
 *     emitter (mode 7) + `caia-curator emit-alarms` CLI.
 *   - PR-2 (THIS): PR-proposal emitter (mode 5) + backlog-directive
 *     emitter (mode 6) + `caia-curator emit-pr-proposals` and
 *     `caia-curator emit-backlog-directives` CLIs.
 *   - PR-3: industry-briefing scanner (mode 8) + unified
 *     `caia-curator act` runner.
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
  defaultPrProposalsDir,
  findingsToActions,
  renderAlarmMarkdown,
  renderBacklogDirectiveMarkdown,
  renderPrProposalMarkdown,
  slugify,
  writeAlarms,
  writeBacklogDirectives,
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
  PrProposalAction,
  WriteAlarmsOptions,
  WriteBacklogDirectivesOptions,
  WritePrProposalsOptions
} from './actions/index.js';
