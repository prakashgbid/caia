/**
 * @caia/pipeline-conductor — api.ts
 * ConductorClient — public API surface. Spec §6.
 */

import type { Pool } from 'pg';
import { eventBus } from '@chiefaia/event-bus-internal';
import type { StateMachine } from '@caia/state-machine';

import { Forecaster } from './forecaster.js';
import { Projector } from './projector.js';
import { isStageName, STAGE_NAMES } from './types.js';
import type {
  EscalationResolution,
  EscalationResult,
  FailureEvent,
  OperatorProjectStatus,
  OpenEscalation,
  PipelineHealth,
  StageHealth,
  StageHistoryEntry,
  StageName,
  StateTransition,
  StuckProject,
  AgentActivity,
} from './types.js';

export interface ConductorClientOptions {
  db: Pool;
  bus?: typeof eventBus;
  stateMachine?: StateMachine;
  forecaster?: Forecaster;
  projector?: Projector;
  healthCacheMs?: number;
}

interface CachedHealth {
  computedAt: number;
  value: PipelineHealth;
}

export class ConductorClient {
  private readonly db: Pool;
  private readonly bus: typeof eventBus;
  private readonly stateMachine: StateMachine | null;
  private readonly forecaster: Forecaster;
  public readonly projector: Projector;
  private readonly healthCacheMs: number;
  private healthCache: Map<string, CachedHealth> = new Map();

  constructor(opts: ConductorClientOptions) {
    this.db = opts.db;
    this.bus = opts.bus ?? eventBus;
    this.stateMachine = opts.stateMachine ?? null;
    this.forecaster = opts.forecaster ?? new Forecaster(opts.db);
    this.projector = opts.projector ??
      new Projector({ pool: opts.db, bus: this.bus, disableWatchdog: true });
    this.healthCacheMs = opts.healthCacheMs ?? 30_000;
  }

  async getProjectStatus(projectId: string): Promise<OperatorProjectStatus | null> {
    const projectRow = await this.db.query<{
      project_id: string;
      tenant_id: string;
      slug: string;
      display_name: string;
      status: string;
      paused: boolean;
      paused_at: Date | null;
      last_transitioned_at: Date;
      seconds_in_state: number;
      active_agent_run_id: string | null;
      active_agent: string | null;
      active_agent_claimed_at: Date | null;
      active_agent_heartbeat_at: Date | null;
      seconds_since_heartbeat: number | null;
      refreshed_at: Date;
    }>(
      `SELECT project_id, tenant_id, slug, display_name, status, paused, paused_at,
              last_transitioned_at, seconds_in_state,
              active_agent_run_id, active_agent, active_agent_claimed_at,
              active_agent_heartbeat_at, seconds_since_heartbeat, refreshed_at
         FROM caia_meta.mv_pipeline_status
        WHERE project_id = $1`,
      [projectId],
    );
    const row = projectRow.rows[0];
    if (!row) return null;

    const [escalations, recentTransitions, recentFailures] = await Promise.all([
      this.queryOpenEscalations(projectId),
      this.queryRecentTransitions(projectId, 10),
      this.queryRecentFailures(projectId, 5),
    ]);

    const stage = isStageName(row.status) ? (row.status as StageName) : null;
    const forecast = stage
      ? await this.forecaster.forecastProject({ tenantId: row.tenant_id, currentStage: stage })
      : { p50At: null, p90At: null, sampleSize: 0, source: 'insufficient-data' as const };

    const activeAgents: AgentActivity[] = row.active_agent_run_id
      ? [
          {
            agentRunId: row.active_agent_run_id,
            agent: row.active_agent ?? 'unknown',
            claimedAt: (row.active_agent_claimed_at ?? row.last_transitioned_at).toISOString(),
            heartbeatAt: (row.active_agent_heartbeat_at ?? row.last_transitioned_at).toISOString(),
            secondsSinceHeartbeat: row.seconds_since_heartbeat ?? 0,
          },
        ]
      : [];

    return {
      projectId: row.project_id,
      tenantId: row.tenant_id,
      slug: row.slug,
      displayName: row.display_name,
      status: row.status as OperatorProjectStatus['status'],
      paused: row.paused,
      pausedSince: row.paused_at ? row.paused_at.toISOString() : null,
      currentStage: stage,
      currentStageEnteredAt: row.last_transitioned_at.toISOString(),
      secondsInState: row.seconds_in_state,
      activeAgents,
      forecast,
      escalations,
      recentTransitions,
      recentFailures,
      bottleneckIndicators: [],
      refreshedAt: row.refreshed_at.toISOString(),
    };
  }

  async subscribeToProject(
    projectId: string,
    handler: (status: OperatorProjectStatus) => void,
  ): Promise<() => Promise<void>> {
    if (!this.stateMachine) {
      throw new Error(
        'subscribeToProject requires a StateMachine — pass { stateMachine } to ConductorClient',
      );
    }
    const onTransition = async (): Promise<void> => {
      const status = await this.getProjectStatus(projectId);
      if (status) handler(status);
    };
    const unsub = await this.stateMachine.subscribeToProject(projectId, () => {
      void onTransition();
    });
    await onTransition();
    return unsub as () => Promise<void>;
  }

  async listStuckProjects(opts: {
    thresholdMinutes: number;
    scope?: { tenantId: string } | 'all-tenants';
  }): Promise<StuckProject[]> {
    const thresholdSec = opts.thresholdMinutes * 60;
    const params: unknown[] = [thresholdSec];
    let where = `paused = false AND seconds_in_state > $1`;
    if (opts.scope && opts.scope !== 'all-tenants') {
      params.push(opts.scope.tenantId);
      where += ` AND tenant_id = $${params.length}`;
    }
    const res = await this.db.query<{
      project_id: string;
      tenant_id: string;
      slug: string;
      status: string;
      seconds_in_state: number;
      active_agent_heartbeat_at: Date | null;
      open_escalations: number;
    }>(
      `SELECT project_id, tenant_id, slug, status, seconds_in_state,
              active_agent_heartbeat_at, open_escalations
         FROM caia_meta.mv_pipeline_status
        WHERE ${where}
        ORDER BY seconds_in_state DESC`,
      params,
    );
    return res.rows.map((r) => ({
      projectId: r.project_id,
      tenantId: r.tenant_id,
      slug: r.slug,
      status: r.status as StuckProject['status'],
      currentStage: isStageName(r.status) ? (r.status as StageName) : null,
      secondsInState: r.seconds_in_state,
      lastHeartbeatAt: r.active_agent_heartbeat_at?.toISOString() ?? null,
      openEscalations: Number(r.open_escalations),
    }));
  }

  async getStageHistory(
    projectId: string,
    opts: { stage?: StageName; limit?: number } = {},
  ): Promise<StageHistoryEntry[]> {
    const params: unknown[] = [projectId];
    let where = `project_id = $1`;
    if (opts.stage) {
      params.push(opts.stage);
      where += ` AND stage = $${params.length}`;
    }
    const limit = Math.min(opts.limit ?? 50, 500);
    params.push(limit);
    const res = await this.db.query<{
      stage: string;
      entered_at: Date;
      exited_at: Date;
      duration_seconds: number;
      exit_reason: string;
      retry_count: number;
    }>(
      `SELECT stage, entered_at, exited_at, duration_seconds, exit_reason, retry_count
         FROM caia_meta.conductor_stage_durations
        WHERE ${where}
        ORDER BY entered_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return res.rows.map((r) => ({
      stage: r.stage,
      enteredAt: r.entered_at.toISOString(),
      exitedAt: r.exited_at.toISOString(),
      durationSeconds: r.duration_seconds,
      exitReason: r.exit_reason as StageHistoryEntry['exitReason'],
      retryCount: r.retry_count,
    }));
  }

  async getPipelineHealth(
    opts: { windowMinutes: number; tenantId?: string } = { windowMinutes: 60 },
  ): Promise<PipelineHealth> {
    const cacheKey = `${opts.tenantId ?? '_all_'}:${opts.windowMinutes}`;
    const cached = this.healthCache.get(cacheKey);
    if (cached && Date.now() - cached.computedAt < this.healthCacheMs) {
      return cached.value;
    }

    const params: unknown[] = [];
    let tenantClause = '';
    if (opts.tenantId) {
      params.push(opts.tenantId);
      tenantClause = ` AND tenant_id = $${params.length}`;
    }

    const [stageRollup, escalations, failures] = await Promise.all([
      this.db.query<{
        status: string;
        count: string;
        p50_dwell: string;
        p90_dwell: string;
        stuck: string;
      }>(
        `SELECT status,
                count(*)::TEXT AS count,
                coalesce(percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds_in_state), 0)::TEXT AS p50_dwell,
                coalesce(percentile_cont(0.9) WITHIN GROUP (ORDER BY seconds_in_state), 0)::TEXT AS p90_dwell,
                sum(CASE WHEN open_escalations > 0 THEN 1 ELSE 0 END)::TEXT AS stuck
           FROM caia_meta.mv_pipeline_status
          WHERE paused = false ${tenantClause}
          GROUP BY status`,
        params,
      ),
      this.db.query<{ n: string }>(
        `SELECT count(*)::TEXT AS n
           FROM caia_meta.conductor_escalations e
           JOIN caia_meta.tenant_projects p ON p.id = e.project_id
          WHERE e.closed_at IS NULL ${opts.tenantId ? `AND p.tenant_id = $1` : ''}`,
        opts.tenantId ? [opts.tenantId] : [],
      ),
      this.db.query<{ n: string }>(
        `SELECT count(*)::TEXT AS n
           FROM caia_meta.agent_runs ar
           JOIN caia_meta.tenant_projects p ON p.id = ar.project_id
          WHERE ar.status = 'failed'
            AND ar.completed_at > now() - ($${opts.tenantId ? 2 : 1}::text || ' minutes')::interval
            ${opts.tenantId ? `AND p.tenant_id = $1` : ''}`,
        opts.tenantId ? [opts.tenantId, String(opts.windowMinutes)] : [String(opts.windowMinutes)],
      ),
    ]);

    const byStage: Record<string, StageHealth> = {};
    let activeProjects = 0;
    for (const row of stageRollup.rows) {
      const count = Number(row.count);
      activeProjects += count;
      byStage[row.status] = {
        count,
        p50DwellSec: Math.round(Number(row.p50_dwell)),
        p90DwellSec: Math.round(Number(row.p90_dwell)),
        stuck: Number(row.stuck),
      };
    }

    const bottlenecks: PipelineHealth['bottlenecks'] = [];
    for (const [stage, h] of Object.entries(byStage)) {
      if (h.stuck > 0 && h.stuck / Math.max(h.count, 1) >= 0.5) {
        bottlenecks.push({ stage, severity: 'critical' });
      } else if (h.stuck > 0) {
        bottlenecks.push({ stage, severity: 'warn' });
      }
    }

    const value: PipelineHealth = {
      activeProjects,
      byStage,
      openEscalations: Number(escalations.rows[0]?.n ?? '0'),
      recentFailures: Number(failures.rows[0]?.n ?? '0'),
      bottlenecks,
      lastDeployAt: null,
      computedAt: new Date().toISOString(),
    };

    this.healthCache.set(cacheKey, { computedAt: Date.now(), value });
    return value;
  }

  async escalate(input: {
    projectId: string;
    stage: StageName;
    reason: string;
    notes?: string;
  }): Promise<EscalationResult> {
    const row = await this.db.query<{ seconds_in_state: number }>(
      `SELECT seconds_in_state FROM caia_meta.mv_pipeline_status WHERE project_id = $1`,
      [input.projectId],
    );
    const elapsed = row.rows[0]?.seconds_in_state ?? 0;
    const result = await this.projector.openEscalation({
      projectId: input.projectId,
      stage: input.stage,
      reason: input.reason,
      thresholdSeconds: 0,
      elapsedSeconds: elapsed,
      lastEventId: null,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });
    return {
      escalationId: result.escalationId ?? '',
      alreadyOpen: result.alreadyOpen,
    };
  }

  async closeEscalation(
    escalationId: string,
    opts: { resolution: EscalationResolution },
  ): Promise<{ ok: boolean }> {
    const ok = await this.projector.closeEscalation(escalationId, opts.resolution);
    return { ok };
  }

  clearHealthCache(): void {
    this.healthCache.clear();
  }

  private async queryOpenEscalations(projectId: string): Promise<OpenEscalation[]> {
    const res = await this.db.query<{
      id: string;
      stage: string;
      reason: string;
      threshold_seconds: number;
      elapsed_seconds: number;
      opened_at: Date;
      notes: string | null;
    }>(
      `SELECT id, stage, reason, threshold_seconds, elapsed_seconds, opened_at, notes
         FROM caia_meta.conductor_escalations
        WHERE project_id = $1 AND closed_at IS NULL
        ORDER BY opened_at DESC`,
      [projectId],
    );
    return res.rows.map((r) => ({
      id: r.id,
      stage: r.stage as StageName,
      reason: r.reason,
      thresholdSeconds: r.threshold_seconds,
      elapsedSeconds: r.elapsed_seconds,
      openedAt: r.opened_at.toISOString(),
      notes: r.notes,
    }));
  }

  private async queryRecentTransitions(
    projectId: string,
    limit: number,
  ): Promise<StateTransition[]> {
    const res = await this.db.query<{
      from_state: string | null;
      to_state: string;
      reason: string;
      actor_kind: 'system' | 'operator' | 'agent';
      actor_id: string;
      at: Date;
    }>(
      `SELECT from_state, to_state, reason, actor_kind, actor_id, at
         FROM caia_meta.state_history
        WHERE project_id = $1
        ORDER BY id DESC
        LIMIT $2`,
      [projectId, limit],
    );
    return res.rows.map((r) => ({
      fromState: r.from_state as StateTransition['fromState'],
      toState: r.to_state as StateTransition['toState'],
      reason: r.reason,
      actorKind: r.actor_kind,
      actorId: r.actor_id,
      at: r.at.toISOString(),
    }));
  }

  private async queryRecentFailures(
    projectId: string,
    limit: number,
  ): Promise<FailureEvent[]> {
    const res = await this.db.query<{
      completed_at: Date;
      agent: string;
      error_message: string | null;
    }>(
      `SELECT completed_at, agent, error_message
         FROM caia_meta.agent_runs
        WHERE project_id = $1 AND status = 'failed'
        ORDER BY completed_at DESC
        LIMIT $2`,
      [projectId, limit],
    );
    const stage = (await this.queryCurrentStage(projectId)) ?? STAGE_NAMES[0]!;
    return res.rows.map((r) => ({
      at: r.completed_at.toISOString(),
      stage,
      agent: r.agent,
      errorMessage: r.error_message ?? 'unknown',
    }));
  }

  private async queryCurrentStage(projectId: string): Promise<StageName | null> {
    const res = await this.db.query<{ status: string }>(
      `SELECT status FROM caia_meta.tenant_projects WHERE id = $1`,
      [projectId],
    );
    const status = res.rows[0]?.status;
    return status && isStageName(status) ? (status as StageName) : null;
  }
}
