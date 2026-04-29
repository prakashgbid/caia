/**
 * WorkerPoolRegistry — TASKMGR-002 (Phase 2)
 *
 * In-process singleton wrapping the durable `worker_pool` table from
 * migration 0033. Tracks every Phase 2 worker process (Coding Agent +
 * Fix-It Test Agent) and provides the API the Task Manager Agent uses
 * to register, heartbeat, claim, and release workers.
 *
 * Stale detection runs every 30 s; any worker whose `lastHeartbeatAt`
 * is older than the configured threshold (default 60 s) is flipped to
 * `crashed` and emits a `worker.crashed` event so Task Manager can
 * requeue the assigned story.
 *
 * Event emissions (per Phase 2A spec, §2.1):
 *   - worker.registered  on register()
 *   - worker.heartbeat   on heartbeat()  (severity=debug; off the critical path)
 *   - worker.released    on release()
 *   - worker.crashed     on detectStale() flip
 *
 * The class deliberately does NOT subscribe to events itself — it's a
 * passive registry. The TaskManager (TASKMGR-003) wires it into the
 * event bus.
 *
 * @owner task-manager (Phase 2 worker-pool track)
 */

import { eq, lt, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../db/connection';
import { workerPool } from '../db/schema';
import { eventBus } from '../events/bus-adapter';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Discriminator for worker process kind. */
export type WorkerKind = 'coding' | 'fix-it';

/** Lifecycle status for a worker row. */
export type WorkerStatus = 'idle' | 'busy' | 'crashed' | 'released';

/** Reason carried on a worker.released event for debuggability. */
export type WorkerReleaseReason =
  | 'task-completed'
  | 'manual-shutdown'
  | 'orchestrator-shutdown'
  | 'evicted-after-stuck';

/** Snapshot of a registry row for callers that don't want raw drizzle access. */
export interface WorkerRecord {
  id: string;
  kind: WorkerKind;
  capabilities: string[];        // bucket ids the worker accepts; [] = any
  status: WorkerStatus;
  currentStoryId: string | null;
  lastHeartbeatAt: number;
  registeredAt: number;
  releasedAt: number | null;
  metadata: Record<string, unknown>;
}

export interface RegisterInput {
  kind: WorkerKind;
  capabilities?: string[];        // defaults to [] (any bucket)
  metadata?: Record<string, unknown>;
  /** Optional pre-supplied id; defaults to a generated wkr_ + nanoid. */
  id?: string;
}

export interface ListIdleOpts {
  kind?: WorkerKind;
  bucket?: string;                // returns workers whose capabilities is empty OR contains bucket
}

/** Tunable thresholds. Constructor accepts overrides for testability. */
export interface RegistryOptions {
  /** Milliseconds since lastHeartbeatAt that flip a worker to crashed. */
  staleThresholdMs?: number;
  /** Skip event emission entirely (unit tests that don't wire bus). */
  silent?: boolean;
  /** Override for Date.now() in tests. */
  now?: () => number;
}

const DEFAULT_STALE_MS = 60_000;

// ─── Class ──────────────────────────────────────────────────────────────────

export class WorkerPoolRegistry {
  private readonly db: Db;
  private readonly staleMs: number;
  private readonly silent: boolean;
  private readonly now: () => number;

  constructor(db: Db, opts: RegistryOptions = {}) {
    this.db = db;
    this.staleMs = opts.staleThresholdMs ?? DEFAULT_STALE_MS;
    this.silent = opts.silent ?? false;
    this.now = opts.now ?? Date.now;
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  /** Inserts a new worker row in `idle` state and emits `worker.registered`. */
  register(input: RegisterInput): WorkerRecord {
    const id = input.id ?? `wkr_${nanoid(12)}`;
    const ts = this.now();
    const capabilities = input.capabilities ?? [];
    const metadata = input.metadata ?? {};
    this.db
      .insert(workerPool)
      .values({
        id,
        kind: input.kind,
        capabilitiesJson: JSON.stringify(capabilities),
        status: 'idle',
        currentStoryId: null,
        lastHeartbeatAt: ts,
        registeredAt: ts,
        releasedAt: null,
        metadataJson: JSON.stringify(metadata),
      })
      .run();
    this.emit('worker.registered', { workerId: id, kind: input.kind, capabilities, registeredAt: ts });
    return {
      id,
      kind: input.kind,
      capabilities,
      status: 'idle',
      currentStoryId: null,
      lastHeartbeatAt: ts,
      registeredAt: ts,
      releasedAt: null,
      metadata,
    };
  }

  /**
   * Updates `lastHeartbeatAt` so the stale-detector doesn't reap this worker.
   * Returns true if the row was found and bumped, false otherwise (allows
   * callers to detect a phantom heartbeat from a worker the registry has
   * already evicted).
   */
  heartbeat(workerId: string): boolean {
    const ts = this.now();
    const row = this.getRaw(workerId);
    if (!row) return false;
    if (row.status === 'released') return false;  // released workers don't get to come back
    this.db
      .update(workerPool)
      .set({ lastHeartbeatAt: ts })
      .where(eq(workerPool.id, workerId))
      .run();
    this.emit('worker.heartbeat', {
      workerId,
      status: row.status,
      currentStoryId: row.currentStoryId,
      ts,
    });
    return true;
  }

  /**
   * Atomic transition `idle` → `busy(storyId)`. Throws if the worker is not
   * idle (the caller is racing with another assigner). Tests rely on this
   * to detect double-assignment bugs in the ReadyPoolConsumer.
   */
  setBusy(workerId: string, storyId: string): WorkerRecord {
    const row = this.requireRow(workerId);
    if (row.status !== 'idle') {
      throw new Error(`worker ${workerId} is not idle (status=${row.status}); cannot assign`);
    }
    const ts = this.now();
    this.db
      .update(workerPool)
      .set({ status: 'busy', currentStoryId: storyId, lastHeartbeatAt: ts })
      .where(eq(workerPool.id, workerId))
      .run();
    return { ...toRecord(row), status: 'busy', currentStoryId: storyId, lastHeartbeatAt: ts };
  }

  /**
   * Atomic transition `busy` → `idle`. Idempotent on already-idle workers
   * (no error). Crashed workers are NOT brought back to idle here — only
   * registration after a process restart.
   */
  setIdle(workerId: string): WorkerRecord {
    const row = this.requireRow(workerId);
    if (row.status === 'crashed' || row.status === 'released') {
      throw new Error(`worker ${workerId} is ${row.status}; cannot return to idle`);
    }
    const ts = this.now();
    this.db
      .update(workerPool)
      .set({ status: 'idle', currentStoryId: null, lastHeartbeatAt: ts })
      .where(eq(workerPool.id, workerId))
      .run();
    return { ...toRecord(row), status: 'idle', currentStoryId: null, lastHeartbeatAt: ts };
  }

  /**
   * Marks a worker `released` and emits `worker.released`. The worker row
   * stays in the table so the dashboard can render terminal-state history.
   */
  release(workerId: string, reason: WorkerReleaseReason = 'task-completed'): WorkerRecord {
    const row = this.requireRow(workerId);
    const ts = this.now();
    this.db
      .update(workerPool)
      .set({ status: 'released', releasedAt: ts, lastHeartbeatAt: ts })
      .where(eq(workerPool.id, workerId))
      .run();
    this.emit('worker.released', {
      workerId,
      lastStoryId: row.currentStoryId,
      releasedAt: ts,
      reason,
    });
    return { ...toRecord(row), status: 'released', releasedAt: ts, lastHeartbeatAt: ts };
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  /**
   * Returns idle workers, optionally filtered by kind and/or accepting a
   * specific bucket. Sorted by registeredAt asc so older workers are
   * preferred (warm-cache assumption).
   */
  listIdle(opts: ListIdleOpts = {}): WorkerRecord[] {
    const all = this.db.select().from(workerPool).where(eq(workerPool.status, 'idle')).all();
    return all
      .filter((r) => (opts.kind ? r.kind === opts.kind : true))
      .filter((r) => {
        if (!opts.bucket) return true;
        const caps: string[] = JSON.parse(r.capabilitiesJson);
        return caps.length === 0 || caps.includes(opts.bucket);
      })
      .map(toRecord)
      .sort((a, b) => a.registeredAt - b.registeredAt);
  }

  /** Returns busy workers (status = 'busy'). Useful for `/workers` dashboard. */
  listBusy(): WorkerRecord[] {
    return this.db
      .select()
      .from(workerPool)
      .where(eq(workerPool.status, 'busy'))
      .all()
      .map(toRecord);
  }

  /** Returns one worker record by id (or null). */
  get(workerId: string): WorkerRecord | null {
    const row = this.getRaw(workerId);
    return row ? toRecord(row) : null;
  }

  /**
   * Aggregates {idle, busy, crashed} counts for the /workers summary endpoint.
   * Released workers are excluded (they're terminal).
   */
  countByStatus(): { idle: number; busy: number; crashed: number; released: number } {
    const rows = this.db.select().from(workerPool).all();
    const out = { idle: 0, busy: 0, crashed: 0, released: 0 };
    for (const r of rows) {
      out[r.status as keyof typeof out] = (out[r.status as keyof typeof out] ?? 0) + 1;
    }
    return out;
  }

  // ─── Stale detection ──────────────────────────────────────────────────────

  /**
   * Sweeps the table for workers whose `lastHeartbeatAt` is older than
   * `staleThresholdMs`. Each match is flipped to `crashed` (with a
   * `worker.crashed` event emitted) so Task Manager can requeue the
   * assigned story. Returns the list of evicted worker ids.
   *
   * Only `idle` and `busy` workers can be marked crashed — `released` and
   * already-`crashed` rows are skipped.
   */
  detectStale(now?: number): string[] {
    const ts = now ?? this.now();
    const cutoff = ts - this.staleMs;
    const stale = this.db
      .select()
      .from(workerPool)
      .where(and(lt(workerPool.lastHeartbeatAt, cutoff)))
      .all()
      .filter((r) => r.status === 'idle' || r.status === 'busy');
    const ids: string[] = [];
    for (const row of stale) {
      this.db
        .update(workerPool)
        .set({ status: 'crashed' })
        .where(eq(workerPool.id, row.id))
        .run();
      this.emit('worker.crashed', {
        workerId: row.id,
        lastStoryId: row.currentStoryId,
        error: 'heartbeat-stale',
        lastHeartbeatAt: row.lastHeartbeatAt,
        ts,
      });
      ids.push(row.id);
    }
    return ids;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private getRaw(workerId: string) {
    return this.db
      .select()
      .from(workerPool)
      .where(eq(workerPool.id, workerId))
      .get();
  }

  private requireRow(workerId: string) {
    const row = this.getRaw(workerId);
    if (!row) throw new Error(`worker ${workerId} not in registry`);
    return row;
  }

  private emit(type: string, payload: Record<string, unknown>): void {
    if (this.silent) return;
    eventBus.publish({
      type: type as never,
      actor: type === 'worker.crashed' ? 'task-scheduler' : 'worker',
      entity_type: 'worker',
      entity_id: payload.workerId as string,
      payload,
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toRecord(r: typeof workerPool.$inferSelect): WorkerRecord {
  return {
    id: r.id,
    kind: r.kind as WorkerKind,
    capabilities: safeJsonArray(r.capabilitiesJson),
    status: r.status as WorkerStatus,
    currentStoryId: r.currentStoryId ?? null,
    lastHeartbeatAt: r.lastHeartbeatAt,
    registeredAt: r.registeredAt,
    releasedAt: r.releasedAt ?? null,
    metadata: safeJsonObject(r.metadataJson),
  };
}

function safeJsonArray(s: string): string[] {
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeJsonObject(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
