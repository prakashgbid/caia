/**
 * ReadyPoolConsumer — TASKMGR-003 (Phase 2)
 *
 * Bridges the static `ready-pool` recompute (BUCKET-009) to the worker
 * pool registered by TASKMGR-002. On every event that could change the
 * ready set (`ticket.bucket_placed`, `task.completed`,
 * `task.tested_and_done`), the consumer:
 *
 *   1. Snapshots the current `stories` table.
 *   2. Calls `recompute(stories)` to get the ready / deferred / inFlight
 *      partition.
 *   3. For each ready story (sorted by priorityBucket then story id),
 *      finds an idle Coding Agent worker that accepts the story's
 *      `bucketId` (or any bucket if the worker's capabilities is `[]`).
 *   4. Atomically: flips worker.status idle→busy AND writes
 *      `assignedWorkerId` + `phase2Status='coding_in_progress'` on the
 *      story. SQLite's `BEGIN IMMEDIATE` guarantees no other consumer
 *      racing the same recompute can double-assign.
 *   5. Emits `task.assigned`.
 *
 * The atomic guarantee is the central correctness property; everything
 * else is just plumbing.
 *
 * @owner task-manager (Phase 2 worker-pool track)
 */

import { eq, and, isNull, ne } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { stories, workerPool } from '../db/schema';
import { eventBus } from '../events/bus-adapter';
import { recompute, snapshotStory, type StorySnapshot } from '../scheduling/ready-pool';
// RUN-MODES (migration 0038) — the plan-only gate is enforced inline
// in pump()'s SELECT clause; no run-modes helper imports needed here
// because the 'plan-only' string literal is the only mode we reject.
// (See run-modes/index.ts for the canonical mode list.)
import { WorkerPoolRegistry, type WorkerKind } from './worker-pool-registry';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AssignmentRecord {
  storyId: string;
  workerId: string;
  bucketId: string | null;
  assignedAt: number;
}

export interface PumpResult {
  assignmentsMade: AssignmentRecord[];
  /** Stories that were ready but no worker available. */
  readyButUnassigned: string[];
  /** Total ready stories at start of pump. */
  readyTotal: number;
}

export interface ConsumerOptions {
  /** Max workers to pop per single pump call. Defaults to all idle. */
  maxAssignmentsPerPump?: number;
  /** Skip event emission entirely (unit tests that don't wire bus). */
  silent?: boolean;
  /** Override for Date.now() in tests. */
  now?: () => number;
  /** Worker kind to assign (default 'coding'). Fix-It workers are not
   *  scheduled this way — they are spawned in-session by the Coding Agent. */
  workerKind?: WorkerKind;
}

// ─── Class ──────────────────────────────────────────────────────────────────

export class ReadyPoolConsumer {
  private readonly db: Db;
  private readonly registry: WorkerPoolRegistry;
  private readonly silent: boolean;
  private readonly now: () => number;
  private readonly workerKind: WorkerKind;
  private readonly maxAssignmentsPerPump: number;

  constructor(db: Db, registry: WorkerPoolRegistry, opts: ConsumerOptions = {}) {
    this.db = db;
    this.registry = registry;
    this.silent = opts.silent ?? false;
    this.now = opts.now ?? Date.now;
    this.workerKind = opts.workerKind ?? 'coding';
    this.maxAssignmentsPerPump = opts.maxAssignmentsPerPump ?? Infinity;
  }

  // ─── Event hooks ──────────────────────────────────────────────────────────

  /** Hooked from `ticket.bucket_placed`. */
  async onBucketPlaced(_payload: { storyId: string; bucketId: string }): Promise<PumpResult> {
    return this.pump();
  }

  /** Hooked from `task.completed` / `task.tested_and_done`. */
  async onTaskCompleted(_payload: { storyId: string }): Promise<PumpResult> {
    return this.pump();
  }

  // ─── Core ─────────────────────────────────────────────────────────────────

  /**
   * Reads stories, recomputes the pool, and tries to assign every ready
   * story to an idle worker. Returns the assignments made + unassigned tail.
   */
  async pump(): Promise<PumpResult> {
    // 1. Snapshot stories. Phase 2 only consumes stories that have reached
    //    `ready_for_pickup` (per the canonical pipeline) — those are
    //    represented by phase2_status IS NULL AND status='pending' once
    //    bucket-placer has run. We additionally require bucket_id IS NOT NULL.
    // RUN-MODES (migration 0038): plan-only runs reach `bucket_placed` /
    // `ready_for_pickup` but are NEVER assigned to a worker. The story's
    // `run_mode` column is denormalised from the parent prompt at story
    // creation time so this gate is a single-table read with no join.
    // 'full' and 'test-only' both pass through; 'test-only' is the
    // capability-broker's job downstream (the worker still gets the
    // assignment).
    const rows = this.db
      .select()
      .from(stories)
      .where(and(
        eq(stories.status, 'pending'),
        isNull(stories.assignedWorkerId),
        ne(stories.runMode, 'plan-only'),
      ))
      .all();

    const snapshots: StorySnapshot[] = rows.map((r) => snapshotStory(r));
    const result = recompute(snapshots);
    const ready = result.ready;

    // 2. Sort ready by priorityBucket (P0 first) then storyId for stable
    //    order. recompute already does priorityBucket ordering but we
    //    re-stabilise here in case future versions change.
    const sorted = [...ready].sort((a, b) => {
      const pa = priorityIndex(a.priorityBucket);
      const pb = priorityIndex(b.priorityBucket);
      if (pa !== pb) return pa - pb;
      return a.storyId.localeCompare(b.storyId);
    });

    // 3. Assign one worker per ready story until we hit either the
    //    per-pump cap or run out of compatible idle workers.
    const made: AssignmentRecord[] = [];
    const unassigned: string[] = [];

    for (const entry of sorted) {
      if (made.length >= this.maxAssignmentsPerPump) {
        unassigned.push(entry.storyId);
        continue;
      }
      // Find an idle worker accepting this bucket.
      const workers = this.registry.listIdle({
        kind: this.workerKind,
        bucket: entry.bucketId ?? undefined,
      });
      if (workers.length === 0) {
        unassigned.push(entry.storyId);
        continue;
      }
      const worker = workers[0]!;
      try {
        const assigned = this.atomicAssign(entry.storyId, worker.id, entry.bucketId);
        made.push(assigned);
        this.emit('task.assigned', {
          storyId: assigned.storyId,
          workerId: assigned.workerId,
          bucketId: assigned.bucketId,
          assignedAt: assigned.assignedAt,
        });
      } catch (e) {
        // Race lost — another pump grabbed this worker between listIdle
        // and atomicAssign. Tag the story as unassigned and move on; the
        // next pump (triggered by the winning assignment's task.assigned
        // → no, that doesn't trigger pump; OK, by the next bucket_placed
        // / task.completed) will pick it up.
        unassigned.push(entry.storyId);
      }
    }

    return { assignmentsMade: made, readyButUnassigned: unassigned, readyTotal: ready.length };
  }

  /**
   * Atomic assign — wraps the worker.status flip + story.assignedWorkerId
   * write in a single SQLite transaction. better-sqlite3 transactions are
   * synchronous and use BEGIN IMMEDIATE under the hood when
   * `db.transaction(...)` is used.
   *
   * Throws if either the story already has an assignedWorkerId (race lost)
   * or the worker is no longer idle (race lost).
   */
  private atomicAssign(storyId: string, workerId: string, bucketId: string | null): AssignmentRecord {
    const ts = this.now();
    // Drizzle's transaction callback runs synchronously under
    // better-sqlite3; the callback's return value bubbles up. We do all
    // state mutation inside it; if any check throws, the tx aborts.
    this.db.transaction((trx) => {
      // 1. Re-check worker is still idle (refuse if it raced into busy).
      const worker = trx
        .select()
        .from(workerPool)
        .where(eq(workerPool.id, workerId))
        .get();
      if (!worker || worker.status !== 'idle') {
        throw new Error(`worker ${workerId} no longer idle (status=${worker?.status})`);
      }
      // 2. Re-check story is still unassigned.
      const story = trx
        .select()
        .from(stories)
        .where(eq(stories.id, storyId))
        .get();
      if (!story || story.assignedWorkerId) {
        throw new Error(`story ${storyId} already assigned (assignedWorkerId=${story?.assignedWorkerId})`);
      }
      // 3. Flip worker.
      trx
        .update(workerPool)
        .set({ status: 'busy', currentStoryId: storyId, lastHeartbeatAt: ts })
        .where(eq(workerPool.id, workerId))
        .run();
      // 4. Mark story.
      trx
        .update(stories)
        .set({
          assignedWorkerId: workerId,
          phase2Status: 'coding_in_progress',
        })
        .where(eq(stories.id, storyId))
        .run();
    });
    return { storyId, workerId, bucketId, assignedAt: ts };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private emit(type: string, payload: Record<string, unknown>): void {
    if (this.silent) return;
    eventBus.publish({
      type: type as never,
      actor: 'task-scheduler',
      entity_type: 'story',
      entity_id: payload.storyId as string,
      payload,
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Lower index = higher priority. Unknown = lowest. */
function priorityIndex(p: string | null): number {
  switch (p) {
    case 'P0':
      return 0;
    case 'P1':
      return 1;
    case 'P2':
      return 2;
    case 'P3':
      return 3;
    default:
      return 99;
  }
}
