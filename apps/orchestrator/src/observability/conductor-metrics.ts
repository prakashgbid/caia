import { Counter, Histogram, Gauge, Registry } from 'prom-client';
import type { SpawnedBy, TaskStatus } from '../core/types';

const DURATION_BUCKETS_MS = [100, 500, 1000, 5000, 15000, 60000, 300000, 900000];
const QUEUE_AGE_BUCKETS_MS = [1000, 5000, 15000, 60000, 300000, 900000, 1800000, 3600000];

export type PumpOutcome = 'picked' | 'no_candidates' | 'file_conflict';

type LabelMap = Record<string, string>;

function key(labels: LabelMap = {}): string {
  return JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
}

export class ConductorMetrics {
  private readonly registry: Registry;

  // prom-client instruments for Prometheus text export
  private readonly _tasksTotal: Counter;
  private readonly _eventsTotal: Counter;
  private readonly _taskDurationMs: Histogram;
  private readonly _taskQueueAgeMs: Histogram;
  private readonly _tasksActive: Gauge;
  private readonly _pumpTicksTotal: Counter;
  private readonly _pumpPickedTotal: Counter;
  private readonly _pumpOutcomeTotal: Counter;

  // Reconcile & expiry & conflict instruments
  private readonly _reconcileDriftedTotal: Counter;
  private readonly _tasksTtlExpiredTotal: Counter;
  private readonly _lockConflictsTotal: Counter;

  // WebSocket connection lifecycle instruments
  private readonly _wsConnectionsTotal: Counter;
  private readonly _wsConnectionsActive: Gauge;
  private readonly _wsConnectionDurationMs: Histogram;
  private readonly _wsMessagesSentTotal: Counter;

  // Internal synchronous mirrors (label-key → value) for unit-testable reads
  private readonly counts = new Map<string, number>();
  private readonly activeGauges = new Map<string, number>();
  private readonly durationSums = new Map<string, number>();
  private readonly durationCounts = new Map<string, number>();
  private readonly queueAgeSums = new Map<string, number>();
  private readonly queueAgeCounts = new Map<string, number>();

  constructor() {
    this.registry = new Registry();

    this._tasksTotal = new Counter({
      name: 'conductor_tasks_total',
      help: 'Total tasks reaching a terminal state, by status and origin',
      labelNames: ['status', 'spawned_by'],
      registers: [this.registry],
    });

    this._eventsTotal = new Counter({
      name: 'conductor_events_total',
      help: 'Total internal conductor events emitted, by type',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this._taskDurationMs = new Histogram({
      name: 'conductor_task_duration_ms',
      help: 'Task wall-clock duration from start to terminal state in milliseconds',
      labelNames: ['status', 'spawned_by'],
      buckets: DURATION_BUCKETS_MS,
      registers: [this.registry],
    });

    this._tasksActive = new Gauge({
      name: 'conductor_tasks_active',
      help: 'Instantaneous count of tasks by non-terminal status',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this._pumpTicksTotal = new Counter({
      name: 'conductor_pump_ticks_total',
      help: 'Total PumpEngine tick() invocations',
      registers: [this.registry],
    });

    this._pumpPickedTotal = new Counter({
      name: 'conductor_pump_picked_total',
      help: 'Total requirements picked for execution by the pump',
      registers: [this.registry],
    });

    this._pumpOutcomeTotal = new Counter({
      name: 'conductor_pump_outcome_total',
      help: 'Pump tick outcomes: picked, no_candidates, or file_conflict',
      labelNames: ['outcome'],
      registers: [this.registry],
    });

    this._taskQueueAgeMs = new Histogram({
      name: 'conductor_task_queue_age_ms',
      help: 'Time a task spent queued before execution began, in milliseconds',
      labelNames: ['spawned_by'],
      buckets: QUEUE_AGE_BUCKETS_MS,
      registers: [this.registry],
    });

    this._reconcileDriftedTotal = new Counter({
      name: 'conductor_reconcile_drifted_total',
      help: 'Total tasks found drifted (session lost) during reconciliation',
      registers: [this.registry],
    });

    this._tasksTtlExpiredTotal = new Counter({
      name: 'conductor_tasks_ttl_expired_total',
      help: 'Total tasks evicted because they exceeded the stale-task TTL',
      registers: [this.registry],
    });

    this._lockConflictsTotal = new Counter({
      name: 'conductor_lock_conflicts_total',
      help: 'Total file-lock conflicts detected when a task was added',
      registers: [this.registry],
    });

    this._wsConnectionsTotal = new Counter({
      name: 'conductor_ws_connections_total',
      help: 'Total WebSocket connections, by terminal status',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this._wsConnectionsActive = new Gauge({
      name: 'conductor_ws_connections_active',
      help: 'Currently open WebSocket connections',
      registers: [this.registry],
    });

    this._wsConnectionDurationMs = new Histogram({
      name: 'conductor_ws_connection_duration_ms',
      help: 'WebSocket connection lifetime from open to close in milliseconds',
      buckets: [500, 2000, 10000, 60000, 300000, 1800000],
      registers: [this.registry],
    });

    this._wsMessagesSentTotal = new Counter({
      name: 'conductor_ws_messages_sent_total',
      help: 'Total messages pushed to WebSocket clients, by event kind',
      labelNames: ['kind'],
      registers: [this.registry],
    });
  }

  // ── Write methods ─────────────────────────────────────────────────────────

  recordTaskAdded(spawnedBy: SpawnedBy): void {
    this._incActive({ status: 'queued' }, 1);
    this._incCount('event', { type: 'TASK_ADDED' });
    this._eventsTotal.inc({ type: 'TASK_ADDED' });
    this._tasksActive.inc({ status: 'queued' });
  }

  recordTaskStarted(): void {
    this._incActive({ status: 'queued' }, -1);
    this._incActive({ status: 'running' }, 1);
    this._incCount('event', { type: 'TASK_STARTED' });
    this._eventsTotal.inc({ type: 'TASK_STARTED' });
    this._tasksActive.dec({ status: 'queued' });
    this._tasksActive.inc({ status: 'running' });
  }

  recordTaskBlocked(): void {
    this._incActive({ status: 'queued' }, -1);
    this._incActive({ status: 'blocked' }, 1);
    this._incCount('event', { type: 'TASK_BLOCKED' });
    this._eventsTotal.inc({ type: 'TASK_BLOCKED' });
    this._tasksActive.dec({ status: 'queued' });
    this._tasksActive.inc({ status: 'blocked' });
  }

  recordTaskUnblocked(): void {
    this._incActive({ status: 'blocked' }, -1);
    this._incActive({ status: 'queued' }, 1);
    this._incCount('event', { type: 'TASK_UNBLOCKED' });
    this._eventsTotal.inc({ type: 'TASK_UNBLOCKED' });
    this._tasksActive.dec({ status: 'blocked' });
    this._tasksActive.inc({ status: 'queued' });
  }

  recordTaskTerminated(
    terminalStatus: Extract<TaskStatus, 'completed' | 'failed' | 'cancelled'>,
    spawnedBy: SpawnedBy,
    startedAt?: string,
  ): void {
    const eventType = `TASK_${terminalStatus.toUpperCase()}`;
    const taskLabels = { status: terminalStatus, spawned_by: spawnedBy };

    this._incActive({ status: 'running' }, -1);
    this._incCount('task', taskLabels);
    this._incCount('event', { type: eventType });

    this._tasksActive.dec({ status: 'running' });
    this._tasksTotal.inc(taskLabels);
    this._eventsTotal.inc({ type: eventType });

    if (startedAt) {
      const durationMs = Date.now() - new Date(startedAt).getTime();
      if (durationMs >= 0) {
        const k = key(taskLabels);
        this.durationSums.set(k, (this.durationSums.get(k) ?? 0) + durationMs);
        this.durationCounts.set(k, (this.durationCounts.get(k) ?? 0) + 1);
        this._taskDurationMs.observe(taskLabels, durationMs);
      }
    }
  }

  recordPumpTick(picked: boolean): void {
    this.recordPumpOutcome(picked ? 'picked' : 'no_candidates');
  }

  recordPumpOutcome(outcome: PumpOutcome): void {
    this._incCount('tick', {});
    this._incCount('pump_outcome', { outcome });
    this._pumpTicksTotal.inc();
    this._pumpOutcomeTotal.inc({ outcome });
    if (outcome === 'picked') {
      this._incCount('picked', {});
      this._pumpPickedTotal.inc();
    }
  }

  recordTaskQueueAge(spawnedBy: SpawnedBy, queuedAt: string): void {
    const ageMs = Date.now() - new Date(queuedAt).getTime();
    if (ageMs < 0) return;
    const labels = { spawned_by: spawnedBy };
    const k = key(labels);
    this.queueAgeSums.set(k, (this.queueAgeSums.get(k) ?? 0) + ageMs);
    this.queueAgeCounts.set(k, (this.queueAgeCounts.get(k) ?? 0) + 1);
    this._taskQueueAgeMs.observe({ spawned_by: spawnedBy }, ageMs);
  }

  recordReconcileDrift(count: number): void {
    if (count <= 0) return;
    const k = 'reconcile_drifted:' + key({});
    this.counts.set(k, (this.counts.get(k) ?? 0) + count);
    this._reconcileDriftedTotal.inc(count);
  }

  recordTtlExpired(count: number): void {
    if (count <= 0) return;
    const k = 'ttl_expired:' + key({});
    this.counts.set(k, (this.counts.get(k) ?? 0) + count);
    this._tasksTtlExpiredTotal.inc(count);
  }

  recordLockConflict(count: number): void {
    if (count <= 0) return;
    const k = 'lock_conflicts:' + key({});
    this.counts.set(k, (this.counts.get(k) ?? 0) + count);
    this._lockConflictsTotal.inc(count);
  }

  recordWsConnected(): void {
    this._wsConnectionsActive.inc();
    this._wsConnectionsTotal.inc({ status: 'opened' });
    this._incCount('ws', { status: 'opened' });
    this.activeGauges.set('ws_active', (this.activeGauges.get('ws_active') ?? 0) + 1);
  }

  recordWsDisconnected(connectedAt: number, status: 'closed' | 'error' = 'closed'): void {
    this._wsConnectionsActive.dec();
    this._wsConnectionsTotal.inc({ status });
    this._incCount('ws', { status });
    this.activeGauges.set('ws_active', Math.max(0, (this.activeGauges.get('ws_active') ?? 0) - 1));
    const durationMs = Date.now() - connectedAt;
    if (durationMs >= 0) this._wsConnectionDurationMs.observe(durationMs);
  }

  recordWsMessageSent(kind: string): void {
    this._wsMessagesSentTotal.inc({ kind });
    this._incCount('ws_msg', { kind });
  }

  getWsActiveCount(): number {
    return this.activeGauges.get('ws_active') ?? 0;
  }

  getWsTotal(status: string): number {
    return this.counts.get('ws:' + key({ status })) ?? 0;
  }

  getWsMessagesSent(kind: string): number {
    return this.counts.get('ws_msg:' + key({ kind })) ?? 0;
  }

  // ── Synchronous read methods (used by tests) ──────────────────────────────

  getActiveCount(labels: { status: string }): number {
    return this.activeGauges.get(key(labels)) ?? 0;
  }

  getTasksTotal(labels: { status: string; spawned_by: string }): number {
    return this.counts.get('task:' + key(labels)) ?? 0;
  }

  getEventsTotal(labels: { type: string }): number {
    return this.counts.get('event:' + key(labels)) ?? 0;
  }

  getPumpTicks(): number {
    return this.counts.get('tick:' + key({})) ?? 0;
  }

  getPumpPicked(): number {
    return this.counts.get('picked:' + key({})) ?? 0;
  }

  getPumpOutcome(outcome: PumpOutcome): number {
    return this.counts.get('pump_outcome:' + key({ outcome })) ?? 0;
  }

  getQueueAgeCount(labels: { spawned_by: string }): number {
    return this.queueAgeCounts.get(key(labels)) ?? 0;
  }

  getQueueAgeSum(labels: { spawned_by: string }): number {
    return this.queueAgeSums.get(key(labels)) ?? 0;
  }

  getReconcileDriftedTotal(): number {
    return this.counts.get('reconcile_drifted:' + key({})) ?? 0;
  }

  getTasksTtlExpiredTotal(): number {
    return this.counts.get('ttl_expired:' + key({})) ?? 0;
  }

  getLockConflictsTotal(): number {
    return this.counts.get('lock_conflicts:' + key({})) ?? 0;
  }

  getDurationCount(labels: { status: string; spawned_by: string }): number {
    return this.durationCounts.get(key(labels)) ?? 0;
  }

  getDurationSum(labels: { status: string; spawned_by: string }): number {
    return this.durationSums.get(key(labels)) ?? 0;
  }

  // ── Prometheus output ─────────────────────────────────────────────────────

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _incCount(prefix: string, labels: LabelMap): void {
    const k = prefix + ':' + key(labels);
    this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
  }

  private _incActive(labels: LabelMap, delta: number): void {
    const k = key(labels);
    this.activeGauges.set(k, (this.activeGauges.get(k) ?? 0) + delta);
  }
}

export const conductorMetrics = new ConductorMetrics();
