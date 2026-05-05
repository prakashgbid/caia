/**
 * @chiefaia/curator — public API.
 *
 * Phase-1 of the Curator agent (per
 * `agent/memory/curator_agent_directive.md`): a daily-running CAIA
 * agent that scans the platform across measurable quality dimensions
 * and emits a daily digest of findings ranked by impact / effort.
 *
 * Phase-1 ships:
 *   - The scan-loop infrastructure (Scanner interface + orchestrator
 *     + digest renderer)
 *   - 5 representative scanners covering 4 of the 10 directive
 *     categories (worktree count, open-PR age, memory drift, stale
 *     TODOs, Dependabot CVEs)
 *   - A `caia-curator daily` CLI that runs the scanners + writes the
 *     digest to `~/Documents/projects/reports/curator/<date>-digest.md`
 *
 * Subsequent PRs add more scanners across the 80-dimension taxonomy.
 *
 * Typical use (from a cron / LaunchAgent):
 *
 *   import { runScan, renderDigest, phase1Scanners } from '@chiefaia/curator';
 *   import { defaultScanContext } from '@chiefaia/curator';
 *
 *   const ctx = defaultScanContext();
 *   const result = await runScan(phase1Scanners, ctx);
 *   const md = renderDigest(result);
 *   // ... write md to a file ...
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

export type {
  Category,
  Effort,
  Finding,
  ScanContext,
  Scanner,
  ScanRunResult,
  Severity
} from './types.js';
