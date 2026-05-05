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
 * alarms, industry briefings). Phase-2 PR-1 ships:
 *   - The `Action` type system + `findingsToActions` classifier.
 *   - The `writeAlarms` emitter (output mode 7) — urgent CVE / ToS /
 *     spend / capacity findings escalate immediately rather than
 *     waiting for the daily digest.
 *
 * Subsequent PRs add the PR-proposal + backlog-directive emitters
 * (PR-2) and the industry-briefing scanner + a unified `caia-curator
 * act` runner (PR-3).
 *
 * Typical use (from a cron / LaunchAgent):
 *
 *   import { runScan, renderDigest, phase1Scanners } from '@chiefaia/curator';
 *   import { defaultScanContext } from '@chiefaia/curator';
 *   import { findingsToActions, writeAlarms } from '@chiefaia/curator';
 *
 *   const ctx = defaultScanContext();
 *   const result = await runScan(phase1Scanners, ctx);
 *   const md = renderDigest(result);
 *   // ... write md to a file ...
 *
 *   // Phase-2 — escalate urgent findings to alarms.
 *   const actions = findingsToActions(result.findings);
 *   const alarms = actions.filter((a) => a.kind === 'alarm');
 *   const emitted = writeAlarms(alarms, { reportsDir: ctx.reportsDir });
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
  findingsToActions,
  renderAlarmMarkdown,
  slugify,
  writeAlarms
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
  WriteAlarmsOptions
} from './actions/index.js';
