/**
 * BackpressureMonitor — TASKMGR-004 (Phase 2)
 *
 * Watches ready-pool depth per bucket and emits backpressure events when
 * a bucket's queue grows past the configured ceiling. PO Agent
 * subscribes to these events and pauses new prompt creation for affected
 * buckets (deferring to `prompts.status='deferred_backpressure'`) until
 * the queue drains below the release threshold (ceiling - hysteresis).
 *
 * Why hysteresis: prevents flapping when the queue depth oscillates
 * around the ceiling. Default ceiling=25, hysteresis=5 ⇒ engage at
 * depth ≥25, release at depth ≤20. PO Agent only sees a fresh event
 * when the bucket actually transitions states.
 *
 * The monitor itself is purely event-driven — it does not poll. Callers
 * invoke `checkBucket(bucketId)` after every story placement +
 * completion. Both events change the depth.
 *
 * @owner task-manager (Phase 2 worker-pool track)
 */

import { eq, and, isNull } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { stories } from '../db/schema';
import { eventBus } from '../events/bus-adapter';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BackpressureOptions {
  /** Queue depth at which backpressure engages. Default 25. */
  ceiling?: number;
  /** Hysteresis: release threshold = ceiling - hysteresis. Default 5. */
  hysteresis?: number;
  /** Skip event emission entirely (unit tests that don't wire bus). */
  silent?: boolean;
  /** Override for Date.now() in tests. */
  now?: () => number;
}

export interface BackpressureSnapshot {
  bucketId: string;
  queueDepth: number;
  engaged: boolean;
  ceiling: number;
  hysteresis: number;
}

// ─── Class ──────────────────────────────────────────────────────────────────

export class BackpressureMonitor {
  private readonly db: Db;
  private readonly ceiling: number;
  private readonly hysteresis: number;
  private readonly silent: boolean;
  private readonly now: () => number;
  /** Buckets currently under backpressure (engaged events emitted). */
  private engaged = new Set<string>();

  constructor(db: Db, opts: BackpressureOptions = {}) {
    this.db = db;
    this.ceiling = opts.ceiling ?? 25;
    this.hysteresis = opts.hysteresis ?? 5;
    this.silent = opts.silent ?? false;
    this.now = opts.now ?? Date.now;
    if (this.ceiling <= 0) {
      throw new Error(`BackpressureMonitor: ceiling must be > 0 (got ${this.ceiling})`);
    }
    if (this.hysteresis < 0 || this.hysteresis >= this.ceiling) {
      throw new Error(
        `BackpressureMonitor: hysteresis must be in [0, ceiling) (got ${this.hysteresis} with ceiling ${this.ceiling})`,
      );
    }
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────

  /**
   * Returns the current queue depth for a bucket. Counts stories that are:
   *   - bucket_id = the requested bucket
   *   - status = 'pending'
   *   - assigned_worker_id IS NULL (not yet picked up by a worker)
   * This is the same set ReadyPoolConsumer.pump() considers, scoped per bucket.
   */
  depth(bucketId: string): number {
    const rows = this.db
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(
          eq(stories.bucketId, bucketId),
          eq(stories.status, 'pending'),
          isNull(stories.assignedWorkerId),
        ),
      )
      .all();
    return rows.length;
  }

  /** Returns whether the bucket is currently engaged + the depth + thresholds. */
  snapshot(bucketId: string): BackpressureSnapshot {
    return {
      bucketId,
      queueDepth: this.depth(bucketId),
      engaged: this.engaged.has(bucketId),
      ceiling: this.ceiling,
      hysteresis: this.hysteresis,
    };
  }

  /** Returns all currently-engaged bucket ids. Useful for the dashboard. */
  listEngaged(): string[] {
    return [...this.engaged];
  }

  // ─── Mutations ────────────────────────────────────────────────────────────

  /**
   * Re-evaluates a single bucket's pressure and emits transition events
   * if the engaged-state changes. Idempotent — calling twice with the
   * same depth does NOT re-emit. Returns the post-check snapshot.
   *
   * Should be called after every event that changes a bucket's queue
   * depth (story placement, story completion, story reassignment).
   */
  checkBucket(bucketId: string): BackpressureSnapshot {
    const depth = this.depth(bucketId);
    const releaseAt = this.ceiling - this.hysteresis;
    const isEngaged = this.engaged.has(bucketId);
    if (depth >= this.ceiling && !isEngaged) {
      this.engaged.add(bucketId);
      this.emit('task-scheduler.backpressure.engaged', {
        bucketId,
        queueDepth: depth,
        ceiling: this.ceiling,
        ts: this.now(),
      });
    } else if (depth <= releaseAt && isEngaged) {
      this.engaged.delete(bucketId);
      this.emit('task-scheduler.backpressure.released', {
        bucketId,
        queueDepth: depth,
        ts: this.now(),
      });
    }
    return this.snapshot(bucketId);
  }

  /**
   * Re-evaluates every bucket that currently has stories. Useful on
   * orchestrator startup to rebuild the engaged-set after a restart.
   */
  checkAll(): BackpressureSnapshot[] {
    const distinct = this.db
      .selectDistinct({ bucketId: stories.bucketId })
      .from(stories)
      .where(and(eq(stories.status, 'pending'), isNull(stories.assignedWorkerId)))
      .all()
      .map((r) => r.bucketId)
      .filter((b): b is string => !!b);
    return distinct.map((b) => this.checkBucket(b));
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private emit(type: string, payload: Record<string, unknown>): void {
    if (this.silent) return;
    eventBus.publish({
      type: type as never,
      actor: 'task-scheduler',
      entity_type: 'bucket',
      entity_id: payload.bucketId as string,
      payload,
    });
  }
}
