/**
 * Worker runtime — CODING-007 (Phase 2C).
 *
 * Glues the four CODING-001..006 building blocks (BundleReader,
 * WorktreeManager, ImplementationEngine, LocalTestRunner, DiffCommitter,
 * DodSelfCheck) to the IPC server and the orchestrator HTTP client.
 *
 * Responsibilities (in order):
 *   1. Register with the orchestrator (POST /api/workers/register), passing
 *      our IPC socket path so Fix-It can find us.
 *   2. Start the IPC server so apply_fix calls land cleanly.
 *   3. Run a heartbeat loop on `heartbeatIntervalMs`.
 *   4. Run an assignment-poll loop on `pollIntervalMs`. When an assignment
 *      arrives, dispatch it to the host's `dispatch` callback (provided by
 *      main.ts so the runtime stays test-friendly).
 *   5. On shutdown, stop loops → release the worker → close IPC.
 *
 * The runtime does NOT itself call the engine — main.ts wires that. The
 * runtime just plumbs lifecycle. That separation makes the unit test
 * possible without spinning up a real Claude SDK.
 *
 * @owner coding-agent (Phase 2C worker track)
 */

import { OrchestratorClient } from './orchestrator-client';
import type { AssignmentResponse, RegisterRequest } from './orchestrator-client';
import { IpcServer, defaultSocketPath } from './ipc-server';
import type { IpcHandlers } from './ipc-server';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RuntimeOptions {
  orchestratorUrl: string;
  /** Bucket ids this worker accepts; [] (default) = any bucket. */
  capabilities?: string[];
  /** Optional pre-supplied workerId; otherwise the orchestrator assigns one. */
  preferredWorkerId?: string;
  /** ms between heartbeats. Default 15_000. */
  heartbeatIntervalMs?: number;
  /** ms between assignment polls. Default 5_000. */
  pollIntervalMs?: number;
  /** Override IPC socket path (default ~/.caia/sockets/<workerId>.sock). */
  socketPath?: string;
  /** Test injection: HTTP fetch override. */
  fetchImpl?: typeof fetch;
  /** Test injection: orchestrator client override (preempts fetchImpl). */
  client?: OrchestratorClient;
  /** IPC handlers (from main.ts: applyFix, getStatus, flushLogs, shutdown). */
  ipcHandlers: IpcHandlers;
  /**
   * Called whenever the assignment poll surfaces a new (non-null) story.
   * The runtime suppresses repeats for the same storyId.
   */
  onAssignment: (assignment: NonNullable<AssignmentResponse['assignment']>) => Promise<void>;
  /** Override for Date.now() in tests. */
  now?: () => number;
  /** Logger override (default: console.error). */
  log?: (line: string) => void;
}

export interface RuntimeHandle {
  workerId: string;
  ipcServer: IpcServer;
  client: OrchestratorClient;
  /** Tick the heartbeat once (used by tests instead of waiting on the timer). */
  heartbeatOnce: () => Promise<void>;
  /** Tick the assignment poll once (used by tests). */
  pollOnce: () => Promise<void>;
  /** Stop loops + release worker + close IPC. Idempotent. */
  shutdown: (reason?: 'task-completed' | 'manual-shutdown' | 'orchestrator-shutdown') => Promise<void>;
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

/**
 * Brings the worker up: registers, starts IPC, starts heartbeat + poll
 * loops. Returns a handle that exposes per-tick entry points so
 * deterministic tests can drive each step explicitly.
 */
export async function startRuntime(opts: RuntimeOptions): Promise<RuntimeHandle> {
  const log = opts.log ?? ((line) => process.stderr.write(`${line}\n`));
  const heartbeatMs = opts.heartbeatIntervalMs ?? 15_000;
  const pollMs = opts.pollIntervalMs ?? 5_000;

  const client =
    opts.client ??
    new OrchestratorClient({ baseUrl: opts.orchestratorUrl, fetchImpl: opts.fetchImpl });

  // Decide the socket path BEFORE we know the worker id. We tell the
  // orchestrator about it on register so Fix-It can dial it later.
  const tentativeSocketPath = opts.socketPath ?? defaultSocketPath(opts.preferredWorkerId ?? `wkr_pending_${process.pid}`);

  const reg: RegisterRequest = {
    kind: 'coding',
    capabilities: opts.capabilities ?? [],
    socketPath: tentativeSocketPath,
    metadata: { pid: process.pid, host: process.env.HOSTNAME ?? 'local' },
  };
  // Allow caller to dictate the worker id via `preferredWorkerId`. The
  // orchestrator currently echoes whatever the caller passed.
  if (opts.preferredWorkerId) (reg as RegisterRequest & { id?: string }).id = opts.preferredWorkerId;
  const regOut = await client.register(reg);
  const workerId = regOut.workerId;
  log(`[worker-coding] registered as ${workerId}`);

  // If the user didn't override the socket path, derive it from the
  // assigned worker id now that we know it.
  const finalSocketPath =
    opts.socketPath ?? (opts.preferredWorkerId ? tentativeSocketPath : defaultSocketPath(workerId));
  if (finalSocketPath !== tentativeSocketPath) {
    // Not common path: re-register with the corrected socketPath. This
    // happens when the orchestrator generates a new id.
    await client.release(workerId, { reason: 'manual-shutdown' });
    const reReg = await client.register({ ...reg, socketPath: finalSocketPath });
    log(`[worker-coding] re-registered with socket=${finalSocketPath} → ${reReg.workerId}`);
  }

  const ipcServer = new IpcServer({
    workerId,
    socketPath: finalSocketPath,
    handlers: opts.ipcHandlers,
    now: opts.now,
  });
  await ipcServer.start();
  log(`[worker-coding] ipc listening on ${ipcServer.path}`);

  // Loop state
  let stopped = false;
  let lastDispatchedStoryId: string | null = null;

  // Heartbeat
  const heartbeatOnce = async (): Promise<void> => {
    if (stopped) return;
    try {
      await client.heartbeat(workerId);
    } catch (e) {
      log(`[worker-coding] heartbeat failed: ${(e as Error).message}`);
    }
  };
  const hbTimer = setInterval(() => { void heartbeatOnce(); }, heartbeatMs);
  hbTimer.unref?.();

  // Assignment poll
  const pollOnce = async (): Promise<void> => {
    if (stopped) return;
    let res: AssignmentResponse;
    try {
      res = await client.getAssignment(workerId);
    } catch (e) {
      log(`[worker-coding] assignment poll failed: ${(e as Error).message}`);
      return;
    }
    if (!res.assignment) return;
    if (res.assignment.storyId === lastDispatchedStoryId) return;
    lastDispatchedStoryId = res.assignment.storyId;
    log(`[worker-coding] dispatching story ${res.assignment.storyId}`);
    try {
      await opts.onAssignment(res.assignment);
    } catch (e) {
      log(`[worker-coding] dispatch handler threw: ${(e as Error).message}`);
    }
  };
  const pollTimer = setInterval(() => { void pollOnce(); }, pollMs);
  pollTimer.unref?.();

  // Shutdown
  const shutdown = async (reason: 'task-completed' | 'manual-shutdown' | 'orchestrator-shutdown' = 'manual-shutdown'): Promise<void> => {
    if (stopped) return;
    stopped = true;
    clearInterval(hbTimer);
    clearInterval(pollTimer);
    try {
      await client.release(workerId, { reason });
    } catch (e) {
      log(`[worker-coding] release failed during shutdown: ${(e as Error).message}`);
    }
    await ipcServer.stop();
    log(`[worker-coding] shut down (reason=${reason})`);
  };

  return { workerId, ipcServer, client, heartbeatOnce, pollOnce, shutdown };
}
