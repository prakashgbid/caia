/**
 * WorkerPool — lightweight pool of coding workers on top of
 * @caia/state-machine's worker primitives.
 *
 * Responsibilities:
 *   - Register N workers with a tier-aware capacity hint.
 *   - claim(projectId, workerId) → wraps StateMachine.tryAssignWork; only
 *     one worker per project wins; concurrent losers see claimed=false.
 *   - heartbeat(workerId) → wraps recordWorkerHeartbeat.
 *   - release(workerId, finalState?) → wraps completeWork.
 *   - sweepDead() → wraps expireInactiveWorkers (releases assignments
 *     whose heartbeat is older than TTL; default 90s per FSM spec).
 *   - status() → snapshot of every registered worker.
 *
 * The pool is intentionally narrow: it does not spawn child processes
 * (that's the Dispatcher's job) and it does not own the dependency
 * graph (the bucketer's job). It exists so the Dispatcher can manage
 * lifecycle without re-implementing the FSM worker semantics.
 */

import type {
  ClaimResult,
  ProjectState,
  TransitionResult,
  TriggeredBy,
} from '@caia/state-machine';
import type {
  SchedulerStateMachine,
  TenantTier,
  WorkerRegistration,
  WorkerStatus,
} from './types.js';

/** Default worker TTL in seconds — matches @caia/state-machine. */
export const DEFAULT_WORKER_TTL_SECONDS = 90;

/** Default heartbeat interval — half the TTL so a single missed beat doesn't expire the worker. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

export interface WorkerPoolOptions {
  readonly stateMachine: SchedulerStateMachine;
  readonly ttlSeconds?: number;
  readonly clock?: () => Date;
}

/**
 * In-memory pool record kept per worker. The FSM owns the durable claim
 * state; this just tracks last-known heartbeat for the local status()
 * snapshot.
 */
interface PoolWorker {
  readonly workerId: string;
  readonly tier: TenantTier;
  readonly capabilities: readonly string[];
  lastHeartbeatAt: Date | null;
  assignedProjects: Set<string>;
}

export class WorkerPool {
  private readonly stateMachine: SchedulerStateMachine;
  private readonly ttlSeconds: number;
  private readonly clock: () => Date;
  private readonly workers = new Map<string, PoolWorker>();

  constructor(opts: WorkerPoolOptions) {
    this.stateMachine = opts.stateMachine;
    this.ttlSeconds = opts.ttlSeconds ?? DEFAULT_WORKER_TTL_SECONDS;
    this.clock = opts.clock ?? ((): Date => new Date());
  }

  /** Register a worker. Idempotent — re-registering refreshes capabilities. */
  register(reg: WorkerRegistration): void {
    const existing = this.workers.get(reg.workerId);
    if (existing) {
      // Keep existing assignments + heartbeat; refresh capabilities only.
      this.workers.set(reg.workerId, {
        ...existing,
        tier: reg.tier,
        capabilities: reg.capabilities ?? existing.capabilities,
      });
      return;
    }
    this.workers.set(reg.workerId, {
      workerId: reg.workerId,
      tier: reg.tier,
      capabilities: reg.capabilities ?? [],
      lastHeartbeatAt: null,
      assignedProjects: new Set(),
    });
  }

  /** List registered workers. */
  list(): readonly string[] {
    return Array.from(this.workers.keys());
  }

  /**
   * Try to claim a project's work-slot for the given worker.
   *
   * Returns the underlying ClaimResult — `claimed=true` means the worker
   * won; `claimed=false` means another worker already holds the slot.
   * Throws if the worker is not registered.
   */
  async claim(projectId: string, workerId: string): Promise<ClaimResult> {
    const w = this.workers.get(workerId);
    if (!w) throw new Error(`WorkerPool.claim: unknown worker ${workerId}`);
    const result = await this.stateMachine.tryAssignWork(projectId, workerId, {
      ttlSeconds: this.ttlSeconds,
    });
    if (result.claimed) {
      w.assignedProjects.add(projectId);
      w.lastHeartbeatAt = this.clock();
    }
    return result;
  }

  /**
   * Heartbeat every active assignment for the worker. Safe to call every
   * `DEFAULT_HEARTBEAT_INTERVAL_MS` (default 30s).
   */
  async heartbeat(workerId: string): Promise<{ ok: boolean; refreshed: string[] }> {
    const w = this.workers.get(workerId);
    if (!w) throw new Error(`WorkerPool.heartbeat: unknown worker ${workerId}`);
    const result = await this.stateMachine.recordWorkerHeartbeat(workerId);
    if (result.ok) {
      w.lastHeartbeatAt = this.clock();
    }
    return result;
  }

  /**
   * Release every assignment held by the worker, optionally driving an FSM
   * transition on each released project (eg `coding-in-progress` on
   * success). Mirrors StateMachine.completeWork.
   */
  async release(
    workerId: string,
    finalState?: ProjectState,
    opts?: {
      reason?: string;
      triggeredBy?: TriggeredBy;
      payload?: Record<string, unknown>;
    },
  ): Promise<{ released: string[]; transitioned: TransitionResult[] }> {
    const w = this.workers.get(workerId);
    if (!w) throw new Error(`WorkerPool.release: unknown worker ${workerId}`);
    const result = await this.stateMachine.completeWork(
      workerId,
      finalState,
      opts,
    );
    for (const pid of result.released) w.assignedProjects.delete(pid);
    return result;
  }

  /**
   * Sweep dead-worker assignments. Returns the list of projectIds whose
   * claims were released.
   */
  async sweepDead(): Promise<{ releasedAssignments: string[] }> {
    const result = await this.stateMachine.expireInactiveWorkers();
    // Local bookkeeping: drop any project that was swept from any worker
    // whose lastHeartbeatAt is older than ttl.
    const cutoff = this.clock().getTime() - this.ttlSeconds * 1000;
    for (const w of this.workers.values()) {
      if (w.lastHeartbeatAt && w.lastHeartbeatAt.getTime() < cutoff) {
        for (const pid of result.releasedAssignments) {
          w.assignedProjects.delete(pid);
        }
      }
    }
    return result;
  }

  /** Snapshot every registered worker. */
  status(): WorkerStatus[] {
    const now = this.clock().getTime();
    const ttlMs = this.ttlSeconds * 1000;
    const out: WorkerStatus[] = [];
    for (const w of this.workers.values()) {
      const isAlive =
        w.lastHeartbeatAt !== null && now - w.lastHeartbeatAt.getTime() <= ttlMs;
      out.push(
        Object.freeze({
          workerId: w.workerId,
          tier: w.tier,
          assignedProjects: Object.freeze(Array.from(w.assignedProjects)),
          lastHeartbeatAt: w.lastHeartbeatAt,
          isAlive,
        }),
      );
    }
    return out;
  }

  /** Test-only: drop all workers. */
  reset(): void {
    this.workers.clear();
  }
}
