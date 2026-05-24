/**
 * @caia/pipeline-conductor — projector.ts
 * Subscribes to the events bus, projects relevant events into mv_pipeline_status,
 * and runs the watchdog loop that opens escalations. Spec §3 + §5 + §8.
 */

import type { Pool } from 'pg';
import { eventBus } from '@chiefaia/event-bus-internal';
import type { ConductorEvent } from '@chiefaia/event-bus-internal';

import {
  DEFAULT_STAGE_THRESHOLDS,
  REPEATED_FAILURE_POLICY,
  WATCHDOG_TICK_SECONDS,
  checkStuck,
  type EscalationPolicyMap,
} from './escalation-policies.js';
import { isStageName } from './types.js';
import type { StageName } from './types.js';

export interface ProjectorOptions {
  pool: Pool;
  bus?: typeof eventBus;
  policy?: EscalationPolicyMap;
  disableWatchdog?: boolean;
  watchdogTickSeconds?: number;
  refreshDebounceMs?: number;
  now?: () => Date;
}

interface MvRow {
  project_id: string;
  tenant_id: string;
  status: string;
  paused: boolean;
  seconds_in_state: number;
  active_agent_run_id: string | null;
  seconds_since_heartbeat: number | null;
}

export class Projector {
  private readonly pool: Pool;
  private readonly bus: typeof eventBus;
  private readonly policy: EscalationPolicyMap;
  private readonly watchdogTickMs: number;
  private readonly refreshDebounceMs: number;
  private readonly now: () => Date;

  private unsubscribe: (() => void) | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private lastRefreshMs = 0;
  private pendingRefresh: NodeJS.Timeout | null = null;

  public eventsObserved = 0;
  public refreshCount = 0;
  public escalationsOpened = 0;
  public escalationsClosed = 0;
  public forecastsEmitted = 0;
  public stageDurationsRecorded = 0;

  constructor(opts: ProjectorOptions) {
    this.pool = opts.pool;
    this.bus = opts.bus ?? eventBus;
    this.policy = opts.policy ?? { ...DEFAULT_STAGE_THRESHOLDS };
    this.watchdogTickMs = (opts.watchdogTickSeconds ?? WATCHDOG_TICK_SECONDS) * 1000;
    this.refreshDebounceMs = opts.refreshDebounceMs ?? 1000;
    this.now = opts.now ?? (() => new Date());
    void opts.disableWatchdog;
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.bus.subscribe('*', (event: ConductorEvent) => {
      this.handleEvent(event).catch((err) =>
        console.error('[projector] handleEvent failed', err),
      );
    });
    if (!this.watchdogTimer) {
      this.watchdogTimer = setInterval(
        () => this.runWatchdog().catch((err) =>
          console.error('[projector] watchdog failed', err),
        ),
        this.watchdogTickMs,
      );
    }
  }

  stop(): void {
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
    if (this.pendingRefresh) { clearTimeout(this.pendingRefresh); this.pendingRefresh = null; }
  }

  async handleEvent(event: ConductorEvent): Promise<void> {
    this.eventsObserved += 1;
    try {
      switch (event.type) {
        case 'task.started':
        case 'task.assigned':
        case 'worker.spawned':
          await this.onClaim(event); break;
        case 'worker.heartbeat':
        case 'executor.heartbeat':
          await this.onHeartbeat(event); break;
        case 'task.completed':
        case 'worker.completed':
          await this.onCompleted(event); break;
        case 'task.failed':
        case 'worker.failed':
        case 'executor.task.failed':
          await this.onFailed(event); break;
        case 'pipeline.stage.advanced':
        case 'requirement.state.transitioned':
          await this.onStateTransitionLike(event); break;
      }
    } finally {
      await this.persistCursor(event.id);
      this.scheduleMvRefresh();
    }
  }

  private async persistCursor(eventId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO caia_meta.conductor_projector_cursor (id, last_event_id, updated_at)
       VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET last_event_id = EXCLUDED.last_event_id,
                                      updated_at = now()
       WHERE EXCLUDED.last_event_id > caia_meta.conductor_projector_cursor.last_event_id`,
      [eventId],
    ).catch((err) => console.error('[projector] cursor persist failed', err));
  }

  async getCursor(): Promise<string | null> {
    const res = await this.pool.query<{ last_event_id: string }>(
      `SELECT last_event_id FROM caia_meta.conductor_projector_cursor WHERE id = 1`,
    );
    const row = res.rows[0];
    return row && row.last_event_id ? row.last_event_id : null;
  }

  scheduleMvRefresh(): void {
    if (this.pendingRefresh) return;
    const now = Date.now();
    const wait = Math.max(0, this.refreshDebounceMs - (now - this.lastRefreshMs));
    this.pendingRefresh = setTimeout(async () => {
      this.pendingRefresh = null;
      this.lastRefreshMs = Date.now();
      this.refreshCount += 1;
      try {
        await this.pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY caia_meta.mv_pipeline_status`);
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('CONCURRENTLY')) {
          await this.pool.query(`REFRESH MATERIALIZED VIEW caia_meta.mv_pipeline_status`).catch(() => undefined);
        }
      }
    }, wait);
  }

  private async onClaim(event: ConductorEvent): Promise<void> {
    const projectId = pickProjectId(event);
    const agent = pickAgent(event);
    if (!projectId || !agent) return;
    await this.pool.query(
      `INSERT INTO caia_meta.agent_runs (project_id, agent, status, claimed_at, heartbeat_at)
       VALUES ($1, $2, 'running', now(), now())`,
      [projectId, agent],
    );
  }

  private async onHeartbeat(event: ConductorEvent): Promise<void> {
    const projectId = pickProjectId(event);
    if (!projectId) return;
    await this.pool.query(
      `UPDATE caia_meta.agent_runs SET heartbeat_at = now()
        WHERE project_id = $1 AND status = 'running'`,
      [projectId],
    );
  }

  private async onCompleted(event: ConductorEvent): Promise<void> {
    const projectId = pickProjectId(event);
    if (!projectId) return;
    const stage = await this.resolveStage(projectId);
    if (stage && isStageName(stage)) {
      const tenantId = await this.resolveTenantId(projectId);
      if (tenantId) await this.recordStageDuration(tenantId, projectId, stage, 'succeeded');
    }
    await this.pool.query(
      `UPDATE caia_meta.agent_runs SET status = 'succeeded', completed_at = now()
        WHERE project_id = $1 AND status = 'running'`,
      [projectId],
    );
    if (stage) await this.autoCloseEscalations(projectId, stage as StageName, 'completed');
  }

  private async onFailed(event: ConductorEvent): Promise<void> {
    const projectId = pickProjectId(event);
    if (!projectId) return;
    await this.pool.query(
      `UPDATE caia_meta.agent_runs SET status = 'failed', completed_at = now(),
              error_message = $2
        WHERE project_id = $1 AND status = 'running'`,
      [projectId, JSON.stringify(event.payload).slice(0, 1000)],
    );
    const stage = await this.resolveStage(projectId);
    if (stage && isStageName(stage)) {
      const recentFailures = await this.countRecentFailures(projectId, REPEATED_FAILURE_POLICY.windowSeconds);
      if (recentFailures >= REPEATED_FAILURE_POLICY.threshold) {
        await this.openEscalation({
          projectId, stage, reason: 'repeated-failures',
          thresholdSeconds: REPEATED_FAILURE_POLICY.windowSeconds,
          elapsedSeconds: recentFailures, lastEventId: event.id,
        });
      }
    }
  }

  private async onStateTransitionLike(_event: ConductorEvent): Promise<void> { return Promise.resolve(); }

  async runWatchdog(): Promise<void> {
    const res = await this.pool.query<MvRow>(
      `SELECT project_id, tenant_id, status, paused, seconds_in_state,
              active_agent_run_id, seconds_since_heartbeat
         FROM caia_meta.mv_pipeline_status
        WHERE paused = false`,
    );
    for (const row of res.rows) {
      if (!isStageName(row.status)) continue;
      const result = checkStuck(this.policy, {
        stage: row.status, paused: row.paused,
        secondsInState: row.seconds_in_state,
        secondsSinceHeartbeat: row.seconds_since_heartbeat,
        hasActiveAgent: row.active_agent_run_id !== null,
      });
      if (result.stuck && result.reason) {
        await this.openEscalation({
          projectId: row.project_id, stage: row.status,
          reason: result.reason === 'heartbeat' ? 'no-heartbeat' : 'dwell-exceeded',
          thresholdSeconds: result.thresholdSeconds,
          elapsedSeconds: result.elapsedSeconds, lastEventId: null,
        });
      }
    }
  }

  async openEscalation(input: {
    projectId: string;
    stage: StageName;
    reason: string;
    thresholdSeconds: number;
    elapsedSeconds: number;
    lastEventId: string | null;
    notes?: string;
  }): Promise<{ escalationId: string | null; alreadyOpen: boolean }> {
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO caia_meta.conductor_escalations
         (project_id, stage, reason, threshold_seconds, elapsed_seconds, last_event_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, stage, reason) WHERE closed_at IS NULL
       DO NOTHING
       RETURNING id`,
      [input.projectId, input.stage, input.reason, input.thresholdSeconds,
       input.elapsedSeconds, input.lastEventId, input.notes ?? null],
    );
    const row = res.rows[0];
    if (!row) return { escalationId: null, alreadyOpen: true };
    this.escalationsOpened += 1;
    this.bus.publish({
      type: 'conductor.escalation.opened',
      actor: 'pipeline-conductor',
      entity_type: 'project',
      entity_id: input.projectId,
      payload: {
        project_id: input.projectId, stage: input.stage, reason: input.reason,
        threshold_seconds: input.thresholdSeconds,
        elapsed_seconds: input.elapsedSeconds, last_event_id: input.lastEventId,
      },
    });
    return { escalationId: row.id, alreadyOpen: false };
  }

  async closeEscalation(
    escalationId: string,
    resolution: 'resumed' | 'completed' | 'abandoned' | 'escalated-to-operator',
  ): Promise<boolean> {
    const res = await this.pool.query<{ project_id: string }>(
      `UPDATE caia_meta.conductor_escalations
          SET closed_at = now(), resolution = $2
        WHERE id = $1 AND closed_at IS NULL
       RETURNING project_id`,
      [escalationId, resolution],
    );
    const row = res.rows[0];
    if (!row) return false;
    this.escalationsClosed += 1;
    this.bus.publish({
      type: 'conductor.escalation.closed',
      actor: 'pipeline-conductor',
      entity_type: 'project',
      entity_id: row.project_id,
      payload: { escalation_id: escalationId, project_id: row.project_id, resolution },
    });
    return true;
  }

  private async autoCloseEscalations(
    projectId: string, stage: StageName,
    resolution: 'resumed' | 'completed' | 'abandoned' | 'escalated-to-operator',
  ): Promise<void> {
    const res = await this.pool.query<{ id: string }>(
      `SELECT id FROM caia_meta.conductor_escalations
        WHERE project_id = $1 AND stage = $2 AND closed_at IS NULL`,
      [projectId, stage],
    );
    for (const row of res.rows) await this.closeEscalation(row.id, resolution);
  }

  private async recordStageDuration(
    tenantId: string, projectId: string, stage: StageName,
    exitReason: 'succeeded' | 'failed-recovered' | 'abandoned',
  ): Promise<void> {
    const res = await this.pool.query<{ entered_at: Date }>(
      `SELECT at AS entered_at FROM caia_meta.state_history
        WHERE project_id = $1 AND to_state = $2
        ORDER BY id DESC LIMIT 1`,
      [projectId, stage],
    );
    const row = res.rows[0];
    if (!row) return;
    const enteredAt = row.entered_at;
    const exitedAt = this.now();
    const durationSec = Math.max(0, Math.floor((exitedAt.getTime() - enteredAt.getTime()) / 1000));
    await this.pool.query(
      `INSERT INTO caia_meta.conductor_stage_durations
         (tenant_id, project_id, stage, entered_at, exited_at, duration_seconds, exit_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tenantId, projectId, stage, enteredAt, exitedAt, durationSec, exitReason],
    );
    this.stageDurationsRecorded += 1;
  }

  private async resolveStage(projectId: string): Promise<string | null> {
    const res = await this.pool.query<{ status: string }>(
      `SELECT status FROM caia_meta.tenant_projects WHERE id = $1`,
      [projectId],
    );
    return res.rows[0]?.status ?? null;
  }

  private async resolveTenantId(projectId: string): Promise<string | null> {
    const res = await this.pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM caia_meta.tenant_projects WHERE id = $1`,
      [projectId],
    );
    return res.rows[0]?.tenant_id ?? null;
  }

  private async countRecentFailures(projectId: string, windowSeconds: number): Promise<number> {
    const res = await this.pool.query<{ n: string }>(
      `SELECT count(*)::TEXT AS n FROM caia_meta.agent_runs
        WHERE project_id = $1 AND status = 'failed'
          AND completed_at > now() - ($2::text || ' seconds')::interval`,
      [projectId, String(windowSeconds)],
    );
    return Number(res.rows[0]?.n ?? '0');
  }
}

function pickProjectId(event: ConductorEvent): string | null {
  const p = event.payload as Record<string, unknown>;
  const candidates = [p?.project_id, p?.projectId,
    event.entity_type === 'project' ? event.entity_id : undefined];
  for (const c of candidates) if (typeof c === 'string' && c.length > 0) return c;
  return null;
}

function pickAgent(event: ConductorEvent): string | null {
  const p = event.payload as Record<string, unknown>;
  const candidates = [p?.agent, p?.worker_id, p?.workerId, event.actor];
  for (const c of candidates) if (typeof c === 'string' && c.length > 0) return c;
  return null;
}
