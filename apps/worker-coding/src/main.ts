/**
 * Coding Agent worker entry point.
 *
 * On startup:
 *   1. Read ORCHESTRATOR_URL + WORKER_KIND env vars (CODING-001).
 *   2. Register with the orchestrator's WorkerPoolRegistry (CODING-007).
 *   3. Start the IPC socket so Fix-It can call apply_fix (CODING-007).
 *   4. Heartbeat loop, every HEARTBEAT_INTERVAL_MS (CODING-007).
 *   5. Poll for assignments every POLL_INTERVAL_MS (CODING-007).
 *   6. On assignment, fetch the bundle (BundleReader) → claim a worktree
 *      (CODING-002) → drive Claude SDK (CODING-003) → run tests
 *      (CODING-004) → open PR (CODING-005) → DoD check (CODING-006) →
 *      hand off to Fix-It (CODING-007) → release on Fix-It done.
 *
 * The runtime lifecycle (register / heartbeat / poll / shutdown) lives in
 * `runtime.ts`; this file is the thin CLI shim that wires env → runtime
 * + the per-story dispatch handler. Each piece is unit-tested separately.
 *
 * @owner coding-agent (Phase 2C worker track)
 */

import { BundleReader } from './bundle-reader';
import { startRuntime, type RuntimeHandle } from './runtime';
import type { IpcHandlers, FixRequest, FixResultOut } from './ipc-server';

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
 *
 * The bootstrap deliberately does NOT start the runtime by default — that
 * keeps the CODING-001 smoke tests green without a live orchestrator. Pass
 * `withRuntime: true` (or call `startRuntime` directly) to wire the full
 * lifecycle.
 */
export interface BootstrapOptions {
  /** When true, calls startRuntime() so the worker registers + listens. */
  withRuntime?: boolean;
}

export async function bootstrap(
  env: WorkerEnv,
  opts: BootstrapOptions = {},
): Promise<{
  reader: BundleReader;
  runtime: RuntimeHandle | null;
  shutdown: () => Promise<void>;
}> {
  const reader = new BundleReader({ baseUrl: env.orchestratorUrl });

  if (!opts.withRuntime) {
    return { reader, runtime: null, shutdown: async () => {} };
  }

  const runtime = await startRuntime({
    orchestratorUrl: env.orchestratorUrl,
    heartbeatIntervalMs: env.heartbeatIntervalMs,
    pollIntervalMs: env.pollIntervalMs,
    ipcHandlers: makeDefaultIpcHandlers(),
    onAssignment: async (assignment) => {
      // Full per-story dispatch (worktree → engine → tests → PR → DoD →
      // hand-off to Fix-It) lives in CODING-009's E2E. For now, we log
      // and let CODING-009 wire it once we have a real-git harness.
      // eslint-disable-next-line no-console
      console.error(`[worker-coding] received assignment storyId=${assignment.storyId}`);
    },
  });

  return {
    reader,
    runtime,
    shutdown: async () => {
      await runtime.shutdown('manual-shutdown');
    },
  };
}

/**
 * Default IPC handlers used when bootstrap doesn't want to wire the full
 * engine itself. Returns "no story in progress" responses; main.ts
 * replaces this with engine-aware versions when the runtime starts a story.
 *
 * Replacing the handlers requires composing your own IpcHandlers and
 * passing them to `startRuntime` directly — see runtime.test.ts.
 */
export function makeDefaultIpcHandlers(): IpcHandlers {
  return {
    applyFix: async (_req: FixRequest): Promise<FixResultOut> => {
      // Until CODING-009 wires per-story state into the IPC handler, we
      // refuse fix calls — the orchestrator should not have routed one
      // to a worker that hasn't dispatched its story yet.
      throw Object.assign(new Error('no story in progress'), { code: 'no-story' });
    },
    getStatus: () => ({ status: 'idle' as const, currentStoryId: null }),
    flushLogs: () => [],
    shutdown: async () => {
      // Process exit is the responsibility of the CLI shim below; the
      // runtime stops loops on its own when shutdown() is called.
      // eslint-disable-next-line no-console
      console.error('[worker-coding] shutdown requested via IPC');
    },
  };
}

// CLI shim — only runs when this file is invoked as the main module.
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {
    const env = readEnv();
    // eslint-disable-next-line no-console
    console.error(`[worker-coding] booting against ${env.orchestratorUrl}`);
    const handle = await bootstrap(env, { withRuntime: true });
    const stop = async (signal: string) => {
      // eslint-disable-next-line no-console
      console.error(`[worker-coding] received ${signal}, shutting down`);
      await handle.shutdown();
      process.exit(0);
    };
    process.once('SIGINT', () => void stop('SIGINT'));
    process.once('SIGTERM', () => void stop('SIGTERM'));
  })();
}
