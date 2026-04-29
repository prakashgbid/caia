/**
 * HealthMetricsEmitter — TASKMGR-005 (Phase 2)
 *
 * Periodically (default every 60 s) computes per-bucket health metrics
 * and writes them to `bucket_health_history` (migration 0034) so the
 * `/workers` dashboard can render sparklines + per-bucket cards. Also
 * emits `task-scheduler.bucket.health` for in-process subscribers (e.g.
 * the WS gateway) that want a real-time push.
 *
 * Metrics per bucket:
 *   queueDepth           — count of stories where bucket_id=X AND
 *                          status='pending' AND assigned_worker_id IS NULL.
 *   throughputPerHour    — count of `task.tested_and_done` events whose
 *                          payload.storyId belongs to bucket X over the
 *                          last hour, projected to /hr.
 *   oldestReadyAgeS      — age in seconds of the oldest unassigned ready
 *                          story in this bucket (NULL if no ready stories).
 *   workersAssigned      — count of workers whose currentStoryId points at
 *                          a story in this bucket.
 *   engaged              — boolean, mirrors BackpressureMonitor state.
 *
 * The emitter is start/stop-controlled (start the interval, stop on
 * shutdown). Tests use the `emitOnce()` entry point to skip the timer.
 *
 * @owner task-manager (Phase 2 worker-pool track)
 */

import { eq, and, isNull, gte, sql, asc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../db/connection';
import { stories, workerPool, bucketHealthHistory, events } from '../db/schema';
import { eventBus } from '../events/bus-adapter';
import type { BackpressureMonitor } from './backpressure-monitor';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HealthMetric {
  bucketId: string;
  queueDepth: number;
  throughputPerHour: number;
  oldestReadyAgeS: number | null;
  workersAssigned: number;
  engaged: boolean;
  ts: number;
}

export interface EmitterOptions {
  /** Tick interval in ms. Default 60_000. */
  intervalMs?: number;
  /** Skip event emission entirely (unit tests that don't wire bus). */
  silent?: boolean;
  /** Override for Date.now() in tests. */
  now?: () => number;
  /** Optional BackpressureMonitor; if provided, `engaged` reflects it. */
  backpressureMonitor?: Pick<BackpressureMonitor, 'listEngaged'>;
}

// ─── Class ──────────────────────────────────────────────────────────────────

export class HealthMetricsEmitter {
  private readonly db: Db;
  private readonly intervalMs: number;
  private readonly silent: boolean;
  private readonly now: () => number;
  private readonly backpressure?: Pick<BackpressureMonitor, 'listEngaged'>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(db: Db, opts: EmitterOptions = {}) {
    this.db = db;
    this.intervalMs = opts.intervalMs ?? 60_000;
    this.silent = opts.silent ?? false;
    this.now = opts.now ?? Date.now;
    this.backpressure = opts.backpressureMonitor;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** Starts the periodic emission timer. Idempotent — calling twice is a no-op. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.emitOnce();
    }, this.intervalMs);
    // Don't keep the event loop alive just for this timer.
    if (this.timer.unref) this.timer.unref();
  }

  /** Stops the periodic emission timer. Idempotent. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  // ─── Core ─────────────────────────────────────────────────────────────────

  /** Computes all bucket metrics, writes one history row per bucket, emits one event per bucket. */
  emitOnce(): HealthMetric[] {
    const buckets = this.discoverBuckets();
    const metrics: HealthMetric[] = [];
    const engagedSet = new Set(this.backpressure?.listEngaged() ?? []);
    const ts = this.now();
    for (const bucketId of buckets) {
      const m = this.computeMetric(bucketId, ts, engagedSet);
      metrics.push(m);
      this.persist(m);
      this.emit(m);
    }
    return metrics;
  }

  // ─── Aggregations ─────────────────────────────────────────────────────────

  private discoverBuckets(): string[] {
    // Buckets that have ANY in-pipeline story (pending or already assigned).
    // Filters out NULL bucket_id rows (legacy / pre-BUCKET-001 stories).
    const rows = this.db
      .selectDistinct({ bucketId: stories.bucketId })
      .from(stories)
      .all();
    return rows
      .map((r) => r.bucketId)
      .filter((b): b is string => !!b);
  }

  private computeMetric(bucketId: string, ts: number, engagedSet: Set<string>): HealthMetric {
    const queueDepth = this.queueDepthFor(bucketId);
    const throughputPerHour = this.throughputPerHourFor(bucketId, ts);
    const oldestReadyAgeS = this.oldestReadyAgeSecFor(bucketId, ts);
    const workersAssigned = this.workersAssignedFor(bucketId);
    return {
      bucketId,
      queueDepth,
      throughputPerHour,
      oldestReadyAgeS,
      workersAssigned,
      engaged: engagedSet.has(bucketId),
      ts,
    };
  }

  private queueDepthFor(bucketId: string): number {
    return this.db
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(
          eq(stories.bucketId, bucketId),
          eq(stories.status, 'pending'),
          isNull(stories.assignedWorkerId),
        ),
      )
      .all().length;
  }

  /**
   * Counts task.tested_and_done events for stories in this bucket over
   * the last hour. We join to the stories table on entity_id (the event
   * payload sets entity_id=storyId per the Phase 2A spec).
   */
  private throughputPerHourFor(bucketId: string, ts: number): number {
    const oneHourAgoIso = new Date(ts - 60 * 60 * 1000).toISOString();
    const rows = this.db
      .select({ storyId: stories.id })
      .from(events)
      .innerJoin(stories, eq(events.entityId, stories.id))
      .where(
        and(
          eq(events.type, 'task.tested_and_done'),
          eq(stories.bucketId, bucketId),
          gte(events.occurredAt, oneHourAgoIso),
        ),
      )
      .all();
    return rows.length;  // already a per-hour count (window is 1h)
  }

  private oldestReadyAgeSecFor(bucketId: string, ts: number): number | null {
    const oldest = this.db
      .select({ createdAt: stories.createdAt })
      .from(stories)
      .where(
        and(
          eq(stories.bucketId, bucketId),
          eq(stories.status, 'pending'),
          isNull(stories.assignedWorkerId),
        ),
      )
      .orderBy(asc(stories.createdAt))
      .limit(1)
      .get();
    if (!oldest) return null;
    const createdMs = Number.parseInt(oldest.createdAt, 10);
    if (!Number.isFinite(createdMs)) {
      // createdAt is sometimes ISO; try parsing.
      const parsed = Date.parse(oldest.createdAt);
      if (Number.isNaN(parsed)) return null;
      return Math.max(0, Math.floor((ts - parsed) / 1000));
    }
    return Math.max(0, Math.floor((ts - createdMs) / 1000));
  }

  private workersAssignedFor(bucketId: string): number {
    // Count workers whose currentStoryId points at a story in this bucket.
    const rows = this.db
      .select({ id: workerPool.id })
      .from(workerPool)
      .innerJoin(stories, eq(workerPool.currentStoryId, stories.id))
      .where(and(eq(workerPool.status, 'busy'), eq(stories.bucketId, bucketId)))
      .all();
    return rows.length;
  }

  // ─── Side effects ─────────────────────────────────────────────────────────

  private persist(m: HealthMetric): void {
    this.db
      .insert(bucketHealthHistory)
      .values({
        id: `bhh_${nanoid(12)}`,
        bucketId: m.bucketId,
        ts: m.ts,
        queueDepth: m.queueDepth,
        throughputPerHour: m.throughputPerHour,
        oldestReadyAgeS: m.oldestReadyAgeS,
        workersAssigned: m.workersAssigned,
        engaged: m.engaged ? 1 : 0,
      })
      .run();
  }

  private emit(m: HealthMetric): void {
    if (this.silent) return;
    eventBus.publish({
      type: 'task-scheduler.bucket.health' as never,
      actor: 'task-scheduler',
      entity_type: 'bucket',
      entity_id: m.bucketId,
      payload: {
        bucketId: m.bucketId,
        queueDepth: m.queueDepth,
        throughputPerHour: m.throughputPerHour,
        oldestReadyAgeS: m.oldestReadyAgeS,
        workersAssigned: m.workersAssigned,
        engaged: m.engaged,
        ts: m.ts,
      },
    });
  }
}
