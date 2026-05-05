/**
 * Postmerge watcher producer — periodic poll loop that emits events
 * into the mentor-event-bus.
 *
 * Each poll iteration:
 *
 *   1. Read the cursor (`last_pr_query_iso` / `last_run_query_iso`).
 *   2. Call `gh pr list --state merged --search "merged:>=<since>"`.
 *      For each PR not in `seen_prs`: emit a `PRMerged` event,
 *      record in `seen_prs`.
 *   3. Call `gh run list --status failure --branch <branch>` for each
 *      base branch (default: develop, main). For each run not in
 *      `seen_runs`: classify the run as either:
 *        - `RegressionDetected` if `head_sha` matches a known merged
 *          PR's mergeCommit (CI red after a merge).
 *        - `EvidenceGateFailure` otherwise (failed CI on a feature
 *          branch — pre-merge gate).
 *      Emit + record.
 *   4. Update the cursor to the iso timestamp of this iteration's
 *      query window.
 *
 * Errors during a single iteration are caught + logged; the loop
 * continues so a transient gh outage doesn't wedge the watcher.
 *
 * No proposal generation happens here — proposals are the Phase-2 PR-3
 * consumer's job. This module only translates "external world signals"
 * into "events on the bus."
 */

import { hostname as osHostname } from 'node:os';
import type { Database as DatabaseInstance } from 'better-sqlite3';

import { Client } from '@chiefaia/mentor-event-bus';

import {
  getFailedJobNames,
  listFailedRuns,
  listMergedPrs,
  type FailedRun,
  type GhClientOptions,
  type MergedPr
} from './gh-client.js';
import {
  getCursor,
  isPrSeen,
  isRunSeen,
  recordPrSeen,
  recordRunSeen,
  setCursor
} from './state-store.js';

/** Default poll interval: 5 min. Postmerge events aren't latency-critical. */
export const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

/** Default look-back window for the very first poll: 24h. */
export const DEFAULT_INITIAL_LOOKBACK_HOURS = 24;

/** Default base refs we watch. */
export const DEFAULT_BASE_REFS: ReadonlyArray<string> = ['develop', 'main'];

export interface ProducerOptions {
  /** State-store sqlite (already opened). */
  stateDb: DatabaseInstance;
  /** Event-bus client. Producer does not own its lifecycle (caller closes). */
  busClient: Client;
  /** Mock injection for `gh` CLI calls. */
  ghClient?: GhClientOptions;
  /** Branches to watch for merges + failures. Default: develop, main. */
  baseRefs?: ReadonlyArray<string>;
  /** First-poll look-back window in hours. Default 24. */
  initialLookbackHours?: number;
  /** Poll interval in ms. Default 5min. */
  pollIntervalMs?: number;
  /** AbortSignal for graceful shutdown. */
  abortSignal?: AbortSignal;
  /** Logger. Default console. */
  logger?: { info: (m: string) => void; warn: (m: string) => void };
  /** Override sleep (test injection). */
  sleepFn?: (ms: number) => Promise<void>;
  /** Override the now() clock. Default Date.now/Date. */
  now?: () => Date;
  /**
   * If true, do not call `gh run view <id> --json jobs` to fetch failed
   * job names — emit failedJobs as []. Useful for tests and for low-API
   * environments. Default false.
   */
  skipFailedJobLookup?: boolean;
}

const consoleLogger = {
  info: (m: string): void => console.log(m),
  warn: (m: string): void => console.warn(m)
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Stats returned per iteration — useful for tests + status reporting. */
export interface IterationStats {
  prsSeen: number;
  prsEmitted: number;
  runsSeen: number;
  runsEmittedAsRegression: number;
  runsEmittedAsGateFailure: number;
  errors: string[];
}

/** Run a single iteration. Exposed for tests + scan-once CLI. */
export function runIteration(opts: ProducerOptions): IterationStats {
  const stats: IterationStats = {
    prsSeen: 0,
    prsEmitted: 0,
    runsSeen: 0,
    runsEmittedAsRegression: 0,
    runsEmittedAsGateFailure: 0,
    errors: []
  };

  const logger = opts.logger ?? consoleLogger;
  const baseRefs = opts.baseRefs ?? DEFAULT_BASE_REFS;
  const lookbackHours =
    opts.initialLookbackHours ?? DEFAULT_INITIAL_LOOKBACK_HOURS;
  const now = (opts.now ?? ((): Date => new Date()))();
  const cursor = getCursor(opts.stateDb);
  const fallbackPrSince = new Date(
    now.getTime() - lookbackHours * 3600_000
  ).toISOString();
  const sincePrIso = cursor.lastPrQueryIso ?? fallbackPrSince;
  const sinceRunIso = cursor.lastRunQueryIso ?? fallbackPrSince;
  // gh search syntax wants minute precision (no T-separator), so format:
  //   YYYY-MM-DDTHH:MM:SSZ → keep as ISO; gh accepts it.
  // Use the raw ISO timestamp.

  // ─── 1. Poll merged PRs ──────────────────────────────────────────────
  let mergedPrs: MergedPr[] = [];
  try {
    mergedPrs = listMergedPrs(
      opts.ghClient ?? {},
      sincePrIso,
      baseRefs,
      50
    );
    stats.prsSeen = mergedPrs.length;
  } catch (e) {
    const msg = `gh pr list failed: ${String(e)}`;
    logger.warn(`[postmerge-watcher] ${msg}`);
    stats.errors.push(msg);
  }

  for (const pr of mergedPrs) {
    if (isPrSeen(opts.stateDb, pr.number)) continue;
    let eventId: string | null = null;
    try {
      eventId = opts.busClient.emit('PRMerged', {
        prNumber: pr.number,
        sha: pr.mergeCommit,
        branch: pr.baseRefName,
        author: pr.author
      });
      if (eventId !== null) stats.prsEmitted++;
    } catch (e) {
      const msg = `emit PRMerged for #${pr.number} failed: ${String(e)}`;
      logger.warn(`[postmerge-watcher] ${msg}`);
      stats.errors.push(msg);
    }
    recordPrSeen(opts.stateDb, {
      prNumber: pr.number,
      mergeSha: pr.mergeCommit,
      mergedAt: pr.mergedAt,
      emittedEventId: eventId,
      processedAt: now.toISOString()
    });
  }

  // ─── 2. Poll failed runs ─────────────────────────────────────────────
  let failedRuns: FailedRun[] = [];
  try {
    failedRuns = listFailedRuns(
      opts.ghClient ?? {},
      sinceRunIso,
      baseRefs,
      50
    );
    stats.runsSeen = failedRuns.length;
  } catch (e) {
    const msg = `gh run list failed: ${String(e)}`;
    logger.warn(`[postmerge-watcher] ${msg}`);
    stats.errors.push(msg);
  }

  // Build a sha → mergedPr lookup so we can route by signal type. Both
  // the freshly-seen PRs above and the existing seen_prs rows are
  // candidates — query the DB.
  const mergedShas = new Set<string>();
  const mergeShaRows = opts.stateDb
    .prepare("SELECT merge_sha FROM seen_prs WHERE merge_sha IS NOT NULL AND merge_sha != ''")
    .all() as Array<{ merge_sha: string }>;
  for (const row of mergeShaRows) mergedShas.add(row.merge_sha);

  for (const run of failedRuns) {
    if (isRunSeen(opts.stateDb, run.databaseId)) continue;
    let failedJobs: string[] = [];
    if (!opts.skipFailedJobLookup) {
      try {
        failedJobs = getFailedJobNames(opts.ghClient ?? {}, run.databaseId);
      } catch (e) {
        const msg = `gh run view ${run.databaseId} failed: ${String(e)}`;
        logger.warn(`[postmerge-watcher] ${msg}`);
        stats.errors.push(msg);
      }
    }

    let eventId: string | null = null;
    try {
      if (mergedShas.has(run.headSha)) {
        // Failed CI on a known merge commit → regression.
        eventId = opts.busClient.emit('RegressionDetected', {
          testName: run.workflowName || 'unknown-workflow',
          failedSha: run.headSha
        });
        if (eventId !== null) stats.runsEmittedAsRegression++;
      } else {
        // Failed CI on a non-merged ref → pre-merge evidence-gate failure.
        // We don't have a canonical PR# here (run is on a branch, not
        // necessarily tied to an open PR), so we emit prNumber=0 as a
        // sentinel meaning "no PR association captured." Consumer
        // tolerates this.
        eventId = opts.busClient.emit('EvidenceGateFailure', {
          prNumber: 0,
          failedJobs:
            failedJobs.length > 0
              ? failedJobs
              : [run.workflowName || 'unknown-workflow']
        });
        if (eventId !== null) stats.runsEmittedAsGateFailure++;
      }
    } catch (e) {
      const msg = `emit run ${run.databaseId} failed: ${String(e)}`;
      logger.warn(`[postmerge-watcher] ${msg}`);
      stats.errors.push(msg);
    }
    recordRunSeen(opts.stateDb, {
      runId: run.databaseId,
      headSha: run.headSha,
      updatedAt: run.updatedAt,
      emittedEventId: eventId,
      processedAt: now.toISOString()
    });
  }

  // ─── 3. Advance cursor ───────────────────────────────────────────────
  setCursor(opts.stateDb, {
    lastPrQueryIso: now.toISOString(),
    lastRunQueryIso: now.toISOString()
  });

  return stats;
}

/**
 * Long-running poll loop. Resolves when `abortSignal` fires.
 *
 * Each iteration is wrapped in try/catch so a transient gh failure
 * doesn't kill the daemon. The cursor is only advanced if the iteration
 * completes without a top-level throw.
 */
export async function runProducer(opts: ProducerOptions): Promise<void> {
  const logger = opts.logger ?? consoleLogger;
  const sleep = opts.sleepFn ?? defaultSleep;
  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const host = osHostname();

  logger.info(
    `[postmerge-watcher] starting; host=${host} interval=${interval}ms baseRefs=${(opts.baseRefs ?? DEFAULT_BASE_REFS).join(',')}`
  );

  while (!(opts.abortSignal?.aborted ?? false)) {
    try {
      const stats = runIteration(opts);
      logger.info(
        `[postmerge-watcher] tick: prs=${stats.prsSeen}/${stats.prsEmitted} runs=${stats.runsSeen}/${stats.runsEmittedAsRegression}+${stats.runsEmittedAsGateFailure} errors=${stats.errors.length}`
      );
    } catch (e) {
      logger.warn(`[postmerge-watcher] iteration threw: ${String(e)}`);
    }
    await sleep(interval);
  }

  logger.info('[postmerge-watcher] producer stopped');
}
