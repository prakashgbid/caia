/**
 * Prometheus metrics for Phase 2C coding-agent lifecycle (CODING-007).
 *
 * Counters (event-driven, monotonically increasing):
 *   coding_worker_registered_total{kind}    — worker.registered events
 *   coding_worker_crashed_total              — worker.crashed (stale heartbeat)
 *   coding_worker_released_total{reason}     — worker.released events
 *   coding_assignment_dispatched_total       — task.assigned events
 *
 * Gauge (live snapshot queried on each Prometheus scrape):
 *   coding_worker_pool_active{status}        — idle/busy/crashed pool sizes
 *
 * Call wireWorkerMetrics(registry) once at Phase 2 boot (done by wirePhase2).
 * The returned teardown removes event listeners and deregisters the Gauge so
 * a subsequent wirePhase2 call (e.g. in tests) can re-register cleanly.
 */

import { Counter, Gauge } from 'prom-client';
import { promRegistry } from './prometheus';
import { eventBus } from '../events/bus-adapter';
import type { WorkerPoolRegistry } from '../agents/worker-pool-registry';

// ─── Event counters ───────────────────────────────────────────────────────────
// Module-level: created once via Node module cache; always present at /prom-metrics.

export const codingWorkerRegisteredTotal = new Counter({
  name: 'coding_worker_registered_total',
  help: 'Total coding/fix-it worker registrations',
  labelNames: ['kind'],
  registers: [promRegistry],
});

export const codingWorkerCrashedTotal = new Counter({
  name: 'coding_worker_crashed_total',
  help: 'Total workers evicted due to missed heartbeats (stale detector)',
  registers: [promRegistry],
});

export const codingWorkerReleasedTotal = new Counter({
  name: 'coding_worker_released_total',
  help: 'Total graceful worker releases by shutdown reason',
  labelNames: ['reason'],
  registers: [promRegistry],
});

export const codingAssignmentDispatchedTotal = new Counter({
  name: 'coding_assignment_dispatched_total',
  help: 'Total story-to-worker assignments dispatched (task.assigned events)',
  registers: [promRegistry],
});

// ─── Live pool gauge + event subscriptions ────────────────────────────────────

/**
 * Create the pool-size Gauge and subscribe to worker.* / task.assigned events.
 * The Gauge uses a collect() callback so it reflects the live DB state on each
 * Prometheus scrape rather than relying on in-flight counter math.
 *
 * Returns a teardown function for wirePhase2's stopAll().
 */
export function wireWorkerMetrics(registry: WorkerPoolRegistry): () => void {
  // Self-registers with promRegistry; queried by collect() on each scrape.
  // prom-client holds the reference so no variable needed.
  new Gauge({
    name: 'coding_worker_pool_active',
    help: 'Live coding/fix-it worker count by lifecycle status (idle|busy|crashed)',
    labelNames: ['status'],
    registers: [promRegistry],
    collect() {
      this.reset();
      const counts = registry.countByStatus();
      this.set({ status: 'idle' }, counts.idle);
      this.set({ status: 'busy' }, counts.busy);
      this.set({ status: 'crashed' }, counts.crashed);
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unsubRegistered = eventBus.subscribe('worker.registered' as never, (ev: any) => {
    const p = (ev?.payload ?? {}) as Record<string, string>;
    codingWorkerRegisteredTotal.inc({ kind: p['kind'] ?? 'coding' });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unsubCrashed = eventBus.subscribe('worker.crashed' as never, (_ev: any) => {
    codingWorkerCrashedTotal.inc();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unsubReleased = eventBus.subscribe('worker.released' as never, (ev: any) => {
    const p = (ev?.payload ?? {}) as Record<string, string>;
    codingWorkerReleasedTotal.inc({ reason: p['reason'] ?? 'manual-shutdown' });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unsubAssigned = eventBus.subscribe('task.assigned' as never, (_ev: any) => {
    codingAssignmentDispatchedTotal.inc();
  });

  return () => {
    unsubRegistered();
    unsubCrashed();
    unsubReleased();
    unsubAssigned();
    // Remove the Gauge so a re-boot (e.g. in tests) can re-register it.
    promRegistry.removeSingleMetric('coding_worker_pool_active');
  };
}
