/**
 * Smart CI/CD Agent — daily-cycle daemon entrypoint.
 *
 * Reference: caia-ai-tech-modernization-proposal-2026-04-30.md §6A.5.
 *
 * **Hard invariant — propose-only.** This daemon never:
 *   - merges PRs
 *   - deletes branches
 *   - force-pushes
 *   - calls --admin
 * It writes observation rows. An operator (or a future, separate "actor"
 * subsystem behind the capability-broker) is the only path to mutation.
 *
 * PR1 lands the SKELETON: a daily 04:00 invocation that records a single
 * `silent` observation per cycle. Subsequent PRs (PR2 observer, PR3
 * classifier-proposer, PR4 actor, PR5 weekly self-review) fill in the rest.
 */

import Database from 'better-sqlite3';
import { insertObservation } from './db.js';
import { SMART_CICD } from './types.js';

export interface DaemonConfig {
  /** Path to the orchestrator SQLite DB containing the smart_cicd_observations table. */
  dbPath: string;
  /** ms-epoch reference for `observationDate` (typically local-midnight). */
  cycleAtMs: number;
}

/**
 * Run a single propose-only daily cycle. Returns the observation IDs
 * recorded so the caller can correlate downstream artefacts.
 *
 * In PR1 this is intentionally a no-op aggregation pass — it only records
 * a single 'silent' bookkeeping observation so the daemon's heartbeat is
 * visible in the table and so dashboards can confirm the daemon is wired up.
 */
export async function runOneCycle(cfg: DaemonConfig): Promise<{
  observationIds: string[];
  cycleStartedAt: number;
  cycleFinishedAt: number;
  version: string;
}> {
  const cycleStartedAt = Date.now();
  const db = new Database(cfg.dbPath);
  try {
    const id = insertObservation(db, {
      observationDate: cfg.cycleAtMs,
      bucketName: 'lint_failures', // dummy bucket — PR1 skeleton only
      rootCause: 'unknown',
      rootCauseConfidence: 0,
      proposedActionKind: 'silent',
      proposedActionPayload: {
        kind: 'silent',
        note: `smart-cicd skeleton heartbeat ${SMART_CICD}`,
      },
    });
    return {
      observationIds: [id],
      cycleStartedAt,
      cycleFinishedAt: Date.now(),
      version: SMART_CICD,
    };
  } finally {
    db.close();
  }
}

/**
 * CLI entry: `node dist/daemon.js`. Reads SMART_CICD_DB env var.
 */
async function main(): Promise<void> {
  const dbPath = process.env.SMART_CICD_DB;
  if (!dbPath) {
    // eslint-disable-next-line no-console
    console.error('SMART_CICD_DB env var is required');
    process.exit(2);
  }
  const result = await runOneCycle({
    dbPath,
    cycleAtMs: Date.now(),
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result));
}

// Only run main() when executed directly (not when imported).
const isCli =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  process.argv[1].endsWith('daemon.js');
if (isCli) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main();
}
