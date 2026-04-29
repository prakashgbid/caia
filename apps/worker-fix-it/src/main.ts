/**
 * Fix-It Test Agent worker entry point — FIX-001 (Phase 2D).
 *
 * On startup:
 *   1. Read ORCHESTRATOR_URL + WORKER_KIND env vars.
 *   2. Register with the orchestrator's WorkerPoolRegistry (TASKMGR-002).
 *   3. Start the heartbeat loop (every 15s).
 *   4. Subscribe to `task.coding_complete` events for stories assigned
 *      to this worker.
 *   5. On a coding_complete event, fetch the bundle, run the
 *      `FixItOrchestrator`, and emit either `task.tested_and_done` or
 *      `task.fix_loop_escalated`.
 *
 * FIX-001 lands env reading + bootstrap + orchestrator wiring with
 * stubs. Steps 2-5 layer on across FIX-002 .. FIX-006 + the parallel
 * track FIX-007 .. FIX-013.
 *
 * The worker is a long-running Node process; one instance per worker.
 *
 * @owner fix-it-test-agent (Phase 2D worker track)
 */

import { FixItOrchestrator } from './orchestrator';

export interface WorkerEnv {
  orchestratorUrl: string;
  workerKind: 'fix-it';
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  maxAttemptsPerCase: number;
}

export const DEFAULT_POLL_INTERVAL_MS = 5000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
export const DEFAULT_MAX_ATTEMPTS_PER_CASE = 6;

/**
 * Read + validate the env vars the worker needs.
 *
 * `ORCHESTRATOR_URL` is the only required variable; everything else
 * has a documented default. Throws synchronously so a misconfigured
 * worker fails on the first line of `bootstrap()` rather than
 * silently floating.
 */
export function readEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const orchestratorUrl = env.ORCHESTRATOR_URL;
  if (!orchestratorUrl) throw new Error('ORCHESTRATOR_URL env var is required');
  const workerKind = (env.WORKER_KIND as 'fix-it') ?? 'fix-it';
  if (workerKind !== 'fix-it') {
    throw new Error(
      `worker-fix-it expects WORKER_KIND='fix-it', got '${workerKind}'`,
    );
  }
  const maxAttempts = Number.parseInt(
    env.MAX_ATTEMPTS_PER_CASE ?? `${DEFAULT_MAX_ATTEMPTS_PER_CASE}`,
    10,
  );
  if (!Number.isFinite(maxAttempts) || maxAttempts < 1) {
    throw new Error(
      `MAX_ATTEMPTS_PER_CASE must be a positive integer, got '${env.MAX_ATTEMPTS_PER_CASE}'`,
    );
  }
  return {
    orchestratorUrl,
    workerKind,
    pollIntervalMs: Number.parseInt(
      env.POLL_INTERVAL_MS ?? `${DEFAULT_POLL_INTERVAL_MS}`,
      10,
    ),
    heartbeatIntervalMs: Number.parseInt(
      env.HEARTBEAT_INTERVAL_MS ?? `${DEFAULT_HEARTBEAT_INTERVAL_MS}`,
      10,
    ),
    maxAttemptsPerCase: maxAttempts,
  };
}

/**
 * Bootstrap entry — exported for tests; called by the CLI shim if this
 * file is run directly.
 */
export async function bootstrap(env: WorkerEnv): Promise<{
  orchestrator: FixItOrchestrator;
  shutdown: () => Promise<void>;
}> {
  const orchestrator = new FixItOrchestrator();
  // Subsequent PRs:
  //   - FIX-002 .. FIX-006: real generator/runner/diagnoser/IPC plumbed in
  //   - FIX-007 .. FIX-013: heartbeat, register(), assignment IPC, dashboard
  return {
    orchestrator,
    shutdown: async () => {
      // graceful shutdown lands in FIX-007
    },
  };
}

// CLI shim — only runs when this file is invoked as the main module.
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {
    const env = readEnv();
    // eslint-disable-next-line no-console
    console.log(`[worker-fix-it] booting against ${env.orchestratorUrl}`);
    await bootstrap(env);
  })();
}
