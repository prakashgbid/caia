/**
 * wirePhase2 — CODING-007 (Phase 2C).
 *
 * Single bootstrap helper that brings every Phase 2 task-manager
 * subsystem (TASKMGR-002..005) online + subscribes to the events that
 * drive worker assignment. Without this glue the registry / consumer /
 * monitor / emitter exist as standalone classes but aren't connected to
 * the bus, and external workers (the CODING-007 IPC server) can never
 * receive assignments.
 *
 * What it does:
 *   1. Constructs the `WorkerPoolRegistry`, `BackpressureMonitor`,
 *      `HealthMetricsEmitter`, and `ReadyPoolConsumer`.
 *   2. Subscribes the consumer to the three pump-trigger events:
 *        - ticket.bucket_placed
 *        - task.completed
 *        - task.tested_and_done
 *   3. Subscribes the BackpressureMonitor to the same set so engaged
 *      buckets transition cleanly.
 *   4. Starts the HealthMetricsEmitter timer (60s by default) +
 *      the registry's stale-detector timer (30s).
 *   5. Returns the four objects + a single `stopAll()` that unsubscribes
 *      bus handlers and stops both timers. Callers that want partial
 *      control (e.g. tests) can stash the individual instances.
 *
 * Idempotency: callers must NOT invoke wirePhase2 twice on the same db.
 * Subscribers would double-fire.
 *
 * @owner task-manager (Phase 2 worker-pool track)
 */

import type { Db } from '../db/connection';
import { eventBus } from '../events/bus-adapter';
import { WorkerPoolRegistry } from './worker-pool-registry';
import { BackpressureMonitor } from './backpressure-monitor';
import { HealthMetricsEmitter } from './health-metrics-emitter';
import { ReadyPoolConsumer } from './ready-pool-consumer';

export interface WirePhase2Options {
  /** Stale-worker detector tick interval. Default 30_000 ms. */
  staleDetectorIntervalMs?: number;
  /** Health emitter tick interval. Default 60_000 ms. */
  healthEmitterIntervalMs?: number;
  /** Backpressure ceiling. Default 25. */
  backpressureCeiling?: number;
  /** Backpressure hysteresis. Default 5. */
  backpressureHysteresis?: number;
  /** Registry stale heartbeat threshold. Default 60_000 ms. */
  workerStaleThresholdMs?: number;
  /** Skip event emission entirely (unit tests that don't wire bus). */
  silent?: boolean;
  /** Test injection: skip starting timers (only the consumer subscriptions). */
  skipTimers?: boolean;
}

export interface Phase2Context {
  registry: WorkerPoolRegistry;
  consumer: ReadyPoolConsumer;
  monitor: BackpressureMonitor;
  emitter: HealthMetricsEmitter;
  /** Tear down all subscriptions + timers. Idempotent. */
  stopAll(): void;
}

const PUMP_EVENTS = [
  'ticket.bucket_placed',
  'task.completed',
  'task.tested_and_done',
] as const;

/**
 * Boot the Phase 2 task-manager subsystem on the given db. See module
 * docblock for the contract.
 */
export function wirePhase2(db: Db, opts: WirePhase2Options = {}): Phase2Context {
  const registry = new WorkerPoolRegistry(db, {
    staleThresholdMs: opts.workerStaleThresholdMs,
    silent: opts.silent,
  });
  const monitor = new BackpressureMonitor(db, {
    ceiling: opts.backpressureCeiling,
    hysteresis: opts.backpressureHysteresis,
    silent: opts.silent,
  });
  const emitter = new HealthMetricsEmitter(db, {
    intervalMs: opts.healthEmitterIntervalMs,
    backpressureMonitor: monitor,
    silent: opts.silent,
  });
  const consumer = new ReadyPoolConsumer(db, registry, { silent: opts.silent });

  // Subscribe consumer + monitor to the pump-trigger events. The bus
  // signature is sync (handler returns void); we fire-and-forget the
  // async pump because the next event is what re-triggers it on
  // failure, and we don't want to back-pressure the publisher.
  const unsubs: Array<() => void> = [];
  for (const evt of PUMP_EVENTS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    unsubs.push(eventBus.subscribe(evt, (ev: any) => {
      const payload = (ev?.payload ?? {}) as { storyId?: string; bucketId?: string };
      if (evt === 'ticket.bucket_placed' && payload.storyId && payload.bucketId) {
        consumer.onBucketPlaced({
          storyId: payload.storyId,
          bucketId: payload.bucketId,
        }).catch(() => {});
      } else if (payload.storyId) {
        consumer.onTaskCompleted({ storyId: payload.storyId }).catch(() => {});
      } else {
        consumer.pump().catch(() => {});
      }
      try {
        if (payload.bucketId) {
          monitor.checkBucket(payload.bucketId);
        } else {
          monitor.checkAll();
        }
      } catch {
        // never crash the bus on a backpressure check
      }
    }));
  }

  // Initial state rebuild on boot — pick up any backpressure that was
  // engaged before a previous restart.
  try { monitor.checkAll(); } catch { /* ignore */ }

  // Timers (stale detector + health emitter). Tests can opt out.
  let staleTimer: ReturnType<typeof setInterval> | null = null;
  if (!opts.skipTimers) {
    const staleMs = opts.staleDetectorIntervalMs ?? 30_000;
    staleTimer = setInterval(() => {
      try { registry.detectStale(); } catch { /* never crash the host on a sweep */ }
    }, staleMs);
    staleTimer.unref?.();
    emitter.start();
  }

  let stopped = false;
  const stopAll = (): void => {
    if (stopped) return;
    stopped = true;
    for (const u of unsubs) {
      try { u(); } catch { /* ignore */ }
    }
    if (staleTimer) clearInterval(staleTimer);
    emitter.stop();
  };

  return { registry, consumer, monitor, emitter, stopAll };
}
