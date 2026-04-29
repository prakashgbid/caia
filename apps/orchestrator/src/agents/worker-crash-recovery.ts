import { eq } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { stories } from '../db/schema';
import { eventBus } from '../events/bus-adapter';
import type { ReadyPoolConsumer } from './ready-pool-consumer';

export interface WorkerCrashedPayload {
  workerId: string;
  lastStoryId: string | null;
  error: string;
  lastHeartbeatAt: number;
  ts: number;
}

export interface WorkerCrashRecoveryOptions {
  maxCodingAttempts?: number;
  pump?: () => Promise<unknown> | unknown;
  silent?: boolean;
  now?: () => number;
}

export interface RecoveryResult {
  storyId: string | null;
  outcome: 'requeued' | 'escalated' | 'no_story' | 'already_clean' | 'not_found';
  attemptNumber: number | null;
}

/**
 * WorkerCrashRecovery — HARDEN-001 (Production hardening).
 *
 * Closes the gap between WorkerPoolRegistry.detectStale() and the
 * ReadyPoolConsumer. The registry flips a stale worker to `crashed`
 * and emits `worker.crashed`, but until this subscriber existed nothing
 * ever cleared the story's assignedWorkerId / phase2Status, so the
 * story stayed stuck in `coding_in_progress` forever and was never
 * picked up by another worker. The schema docstring even claimed
 * "the assigned story is requeued" — this module is what makes that true.
 *
 * Behaviour on `worker.crashed` (with non-null lastStoryId):
 *   1. Atomic rollback in a transaction:
 *      - assignedWorkerId   -> null
 *      - codingSessionId    -> null   (session can't be resumed)
 *      - codingAttempts++   (visible in /workers + dashboard)
 *      - phase2Status       -> null (so ReadyPoolConsumer re-picks)
 *   2. If codingAttempts >= maxAttempts:
 *      - phase2Status -> 'escalated'
 *      - emit `phase2.escalated` (operator must intervene)
 *   3. Otherwise emit `task.requeued` with the new attemptNumber.
 *   4. Trigger one ReadyPoolConsumer.pump() so a different idle
 *      worker picks the story up immediately.
 *
 * The recovery is idempotent: a duplicate `worker.crashed` for the
 * same workerId is safe — if the story is already unassigned the
 * transaction reads `assignedWorkerId IS NULL` and exits cleanly.
 *
 * @owner task-manager (Phase 2 worker-pool track / production hardening)
 */
export class WorkerCrashRecovery {
  private readonly db: Db;
  private readonly maxAttempts: number;
  private readonly pump?: () => Promise<unknown> | unknown;
  private readonly silent: boolean;
  private readonly now: () => number;

  constructor(db: Db, opts: WorkerCrashRecoveryOptions = {}) {
    this.db = db;
    this.maxAttempts = opts.maxCodingAttempts ?? 3;
    this.pump = opts.pump;
    this.silent = opts.silent ?? false;
    this.now = opts.now ?? Date.now;
    if (this.maxAttempts < 1) {
      throw new Error(
        `WorkerCrashRecovery: maxCodingAttempts must be >= 1 (got ${this.maxAttempts})`,
      );
    }
  }

  /**
   * Handles a single `worker.crashed` event. Public so unit tests can
   * call it directly without driving the bus.
   */
  async handleCrash(payload: WorkerCrashedPayload): Promise<RecoveryResult> {
    const storyId = payload.lastStoryId;
    if (!storyId) {
      return { storyId: null, outcome: 'no_story', attemptNumber: null };
    }

    const decision = this.db.transaction((trx) => {
      const story = trx
        .select()
        .from(stories)
        .where(eq(stories.id, storyId))
        .get();

      if (!story) {
        return { kind: 'not_found' as const, attemptNumber: null };
      }
      if (story.assignedWorkerId !== payload.workerId) {
        return { kind: 'already_clean' as const, attemptNumber: story.codingAttempts };
      }

      const nextAttempts = (story.codingAttempts ?? 0) + 1;
      const escalate = nextAttempts >= this.maxAttempts;

      trx
        .update(stories)
        .set({
          assignedWorkerId: null,
          codingSessionId: null,
          codingAttempts: nextAttempts,
          phase2Status: escalate ? 'escalated' : null,
        })
        .where(eq(stories.id, storyId))
        .run();

      return {
        kind: escalate ? ('escalated' as const) : ('requeued' as const),
        attemptNumber: nextAttempts,
      };
    });

    if (decision.kind === 'not_found') {
      return { storyId, outcome: 'not_found', attemptNumber: null };
    }
    if (decision.kind === 'already_clean') {
      return { storyId, outcome: 'already_clean', attemptNumber: decision.attemptNumber };
    }

    if (decision.kind === 'escalated') {
      this.emit('phase2.escalated', {
        storyId,
        workerId: payload.workerId,
        attemptNumber: decision.attemptNumber,
        reason: 'max_coding_attempts_exceeded',
        ts: this.now(),
      });
    } else {
      this.emit('task.requeued', {
        storyId,
        workerId: payload.workerId,
        attemptNumber: decision.attemptNumber,
        reason: 'worker_crashed',
        ts: this.now(),
      });
    }

    if (this.pump && decision.kind === 'requeued') {
      try {
        await this.pump();
      } catch {
        /* pumping is best-effort; next event-driven pump retries */
      }
    }

    return {
      storyId,
      outcome: decision.kind === 'escalated' ? 'escalated' : 'requeued',
      attemptNumber: decision.attemptNumber,
    };
  }

  /**
   * Subscribes the recovery handler to the in-process bus and returns
   * the unsubscribe function.
   */
  subscribe(): () => void {
    return eventBus.subscribe('worker.crashed', (ev) => {
      const p = (ev as { payload?: unknown }).payload;
      if (!p || typeof p !== 'object') return;
      void this.handleCrash(p as WorkerCrashedPayload).catch(() => { /* swallow */ });
    });
  }

  private emit(type: 'task.requeued' | 'phase2.escalated', payload: Record<string, unknown>): void {
    if (this.silent) return;
    eventBus.publish({
      type: type as never,
      actor: 'task-scheduler',
      entity_type: 'story',
      entity_id: payload.storyId as string,
      severity: type === 'phase2.escalated' ? 'error' : 'warning',
      payload,
    });
  }
}

export function registerWorkerCrashRecovery(
  db: Db,
  opts: WorkerCrashRecoveryOptions = {},
): { recovery: WorkerCrashRecovery; unsubscribe: () => void } {
  const recovery = new WorkerCrashRecovery(db, opts);
  const unsubscribe = recovery.subscribe();
  return { recovery, unsubscribe };
}

export function registerWorkerCrashRecoveryWithPump(
  db: Db,
  consumer: ReadyPoolConsumer,
  opts: Omit<WorkerCrashRecoveryOptions, 'pump'> = {},
): { recovery: WorkerCrashRecovery; unsubscribe: () => void } {
  return registerWorkerCrashRecovery(db, {
    ...opts,
    pump: () => consumer.pump(),
  });
}
