/**
 * Coding Agent worker entry point — CODING-001 (skeleton).
 *
 * On startup:
 *   1. Read ORCHESTRATOR_URL + WORKER_KIND env vars.
 *   2. Register with the orchestrator's WorkerPoolRegistry (TASKMGR-002).
 *   3. Start the heartbeat loop (every 15s).
 *   4. Listen for `task.assigned` IPC pushes (or poll
 *      /api/workers/assignments — wired in CODING-007).
 *   5. On assignment, fetch the bundle (BundleReader) → claim a worktree
 *      (CODING-002) → drive Claude SDK (CODING-003) → run tests
 *      (CODING-004) → open PR (CODING-005) → DoD check (CODING-006) →
 *      hand off to Fix-It (CODING-007) → release on Fix-It done.
 *
 * This file is the skeleton. Step 1 (env) + Step 2 (register) + Step 3
 * (heartbeat) live here. Steps 4-end land in their respective PRs.
 *
 * The worker is a long-running Node process; one instance per worker.
 *
 * @owner coding-agent (Phase 2C worker track)
 */

import { BundleReader } from './bundle-reader';

export interface WorkerEnv {
  orchestratorUrl: string;
  workerKind: 'coding';
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
}

export function readEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const orchestratorUrl = env.ORCHESTRATOR_URL;
  if (!orchestratorUrl) throw new Error('ORCHESTRATOR_URL env var is required');
  return {
    orchestratorUrl,
    workerKind: (env.WORKER_KIND as 'coding') ?? 'coding',
    pollIntervalMs: Number.parseInt(env.POLL_INTERVAL_MS ?? '5000', 10),
    heartbeatIntervalMs: Number.parseInt(env.HEARTBEAT_INTERVAL_MS ?? '15000', 10),
  };
}

/**
 * Bootstrap entry — exported for tests; called by the CLI shim if this
 * file is run directly.
 */
export async function bootstrap(env: WorkerEnv): Promise<{
  reader: BundleReader;
  shutdown: () => Promise<void>;
}> {
  const reader = new BundleReader({ baseUrl: env.orchestratorUrl });
  // Subsequent PRs:
  //   - CODING-002: WorktreeManager
  //   - CODING-003: Implementation engine
  //   - CODING-007: register() + heartbeat() + assignment IPC
  // For now, return only the reader so test scaffolding can verify the
  // entry-point + env reading works.
  return {
    reader,
    shutdown: async () => {
      // graceful shutdown lands in CODING-007
    },
  };
}

// CLI shim — only runs when this file is invoked as the main module.
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {
    const env = readEnv();
    // eslint-disable-next-line no-console
    console.log(`[worker-coding] booting against ${env.orchestratorUrl}`);
    await bootstrap(env);
  })();
}
