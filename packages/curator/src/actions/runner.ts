/**
 * Curator Phase-2 — unified `act` runner.
 *
 * Wraps the full Curator action pipeline in one call:
 *
 *   scan -> classify findings -> load watchlist -> emit all 4 kinds
 *   (alarms, pr-proposals, backlog-directives, industry-briefings)
 *   -> return a combined summary.
 *
 * This is what the daily LaunchAgent / cron will invoke. The CLI
 * subcommand `caia-curator act` is a thin wrapper that prints the
 * summary as JSON.
 *
 * Idempotency: each per-kind emitter is idempotent on slug, so re-
 * running `runActDay` against the same memoryDir + scan output is a
 * no-op (modulo new findings). `--force` overrides per-emitter.
 */

import { writeAlarms } from './alarm-emitter.js';
import { writeBacklogDirectives } from './backlog-directive-emitter.js';
import { findingsToActions } from './classifier.js';
import { writeIndustryBriefings } from './industry-briefing-emitter.js';
import { writePrProposals } from './pr-proposal-emitter.js';
import { loadWatchlist } from './watchlist.js';

import type {
  AlarmAction,
  BacklogDirectiveAction,
  EmitResult,
  IndustryBriefingAction,
  PrProposalAction
} from './types.js';
import { runScan } from '../orchestrator.js';
import { phase1Scanners } from '../scanners/index.js';
import type { ScanContext } from '../types.js';

/** Options for `runActDay`. */
export interface RunActDayOptions {
  /** Overwrite existing files across all 4 emitters. Default: false. */
  force?: boolean;
  /**
   * Override the alarms output dir. Otherwise computed from
   * `<reportsDir>/curator/alarms`.
   */
  alarmsDir?: string;
  /** Override the pr-proposals output dir. */
  prProposalsDir?: string;
  /** Override the backlog-directives output dir. */
  backlogDirectivesDir?: string;
  /** Override the industry-briefings output dir. */
  industryBriefingsDir?: string;
  /** Override the watchlist file path. */
  watchlistPath?: string;
  /**
   * Skip the watchlist load entirely. Useful in tests + when the
   * operator hasn't filed any topics yet (the loader returns []
   * already, but this is more explicit).
   */
  skipIndustryBriefings?: boolean;
}

/** Aggregated result of `runActDay`. */
export interface RunActDayResult {
  /** Total findings produced by the scan run. */
  findingCount: number;
  /** All actions emitted by the classifier (pre-watchlist). */
  classifiedCount: number;
  /** Number of industry-briefings loaded from the watchlist. */
  watchlistCount: number;
  /** Per-emitter results. */
  emit: {
    alarms: EmitResult;
    prProposals: EmitResult;
    backlogDirectives: EmitResult;
    industryBriefings: EmitResult;
  };
  /** ISO-8601 start + end. */
  startedAt: string;
  endedAt: string;
}

/**
 * Run the full Curator action pipeline against a ScanContext.
 *
 * Sequence:
 *   1. Run all phase-1 scanners.
 *   2. Classify findings into alarm / pr-proposal / backlog-directive
 *      actions.
 *   3. Load operator-curated industry-briefing watchlist.
 *   4. Emit each kind to its own subdir under `<reportsDir>/curator/`.
 *   5. Return a combined summary.
 *
 * No per-emitter step is allowed to fail the others — emitters are
 * pure functions over their inputs and write files atomically.
 */
export async function runActDay(
  ctx: ScanContext,
  opts: RunActDayOptions = {}
): Promise<RunActDayResult> {
  const startedAt = new Date().toISOString();
  const result = await runScan(phase1Scanners, ctx);
  const actions = findingsToActions(result.findings);

  const alarms = actions.filter((a): a is AlarmAction => a.kind === 'alarm');
  const prs = actions.filter(
    (a): a is PrProposalAction => a.kind === 'pr-proposal'
  );
  const directives = actions.filter(
    (a): a is BacklogDirectiveAction => a.kind === 'backlog-directive'
  );

  const watchlistOpts: Parameters<typeof loadWatchlist>[0] = {};
  if (opts.watchlistPath !== undefined) {
    watchlistOpts.path = opts.watchlistPath;
  } else {
    watchlistOpts.memoryDir = ctx.memoryDir;
  }
  if (ctx.now !== undefined) watchlistOpts.now = ctx.now;
  const briefings: IndustryBriefingAction[] = opts.skipIndustryBriefings
    ? []
    : loadWatchlist(watchlistOpts);

  const force = opts.force === true;

  const alarmsEmit = opts.alarmsDir
    ? writeAlarms(alarms, { alarmsDir: opts.alarmsDir, force })
    : writeAlarms(alarms, { reportsDir: ctx.reportsDir, force });
  const prsEmit = opts.prProposalsDir
    ? writePrProposals(prs, { outDir: opts.prProposalsDir, force })
    : writePrProposals(prs, { reportsDir: ctx.reportsDir, force });
  const directivesEmit = opts.backlogDirectivesDir
    ? writeBacklogDirectives(directives, {
        outDir: opts.backlogDirectivesDir,
        force
      })
    : writeBacklogDirectives(directives, { reportsDir: ctx.reportsDir, force });
  const briefingsEmit = opts.industryBriefingsDir
    ? writeIndustryBriefings(briefings, {
        outDir: opts.industryBriefingsDir,
        force
      })
    : writeIndustryBriefings(briefings, { reportsDir: ctx.reportsDir, force });

  const endedAt = new Date().toISOString();

  return {
    findingCount: result.findings.length,
    classifiedCount: actions.length,
    watchlistCount: briefings.length,
    emit: {
      alarms: alarmsEmit,
      prProposals: prsEmit,
      backlogDirectives: directivesEmit,
      industryBriefings: briefingsEmit
    },
    startedAt,
    endedAt
  };
}
