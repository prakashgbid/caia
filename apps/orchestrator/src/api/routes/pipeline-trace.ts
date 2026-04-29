/**
 * Pipeline-run trace API — HARDEN-006 (Production hardening).
 *
 * Aggregates everything the orchestrator knows about a single
 * pipeline-run (a prompt) into one queryable trace:
 *
 *   GET /api/pipelines/:promptId/trace
 *     {
 *       prompt:   { id, body, status, correlationId, receivedAt },
 *       stages:   [ { stage, enteredAt, durationMs } ... ],
 *       events:   [ { id, type, occurred_at, actor, severity, payload } ... ],
 *       cost:     { totalCostUsd, baselineCostUsd, perAgent, ... } | null,
 *       summary:  { firstEventAt, lastEventAt, durationMs, eventCount, errorCount }
 *     }
 *
 * The events list is ordered by occurred_at asc and bounded at 1000
 * (configurable via ?limit) so a runaway pipeline doesn't OOM the API.
 *
 * The dashboard /prompts/[id]/journey page reads this single endpoint
 * to render the timeline + cost panel + stage flow.
 */

import type { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { prompts, promptPipelineStages } from '../../db/schema';
import { eventBus } from '../../events/bus-adapter';
// HARDEN-006: cost field is wired in a follow-up once HARDEN-002 (cost
// tracker) lands. For now the trace returns cost=null and the dashboard
// renders its existing /metrics aggregate.

interface PromptOut {
  id: string;
  body: string;
  status: string;
  correlationId: string;
  receivedAt: string;
}

interface StageOut {
  stage: string;
  enteredAt: number;
  durationMs: number | null;
}

interface EventOut {
  id: string;
  type: string;
  occurredAt: string;
  actor: string;
  severity: string;
  entityId: string | null;
  entityType: string | null;
  payload: Record<string, unknown>;
}

interface TraceSummary {
  firstEventAt: string | null;
  lastEventAt: string | null;
  durationMs: number | null;
  eventCount: number;
  errorCount: number;
  warningCount: number;
}

export function registerPipelineTraceRoutes(app: Hono, db: Db): void {
  // GET /api/pipelines/:promptId/trace
  app.get('/api/pipelines/:promptId/trace', (c) => {
    const promptId = c.req.param('promptId');
    const limit = Math.min(
      Math.max(parseInt(c.req.query('limit') ?? '1000', 10) || 1000, 1),
      5000,
    );

    const prompt = db.select().from(prompts).where(eq(prompts.id, promptId)).get();
    if (!prompt) return c.json({ error: 'prompt not found' }, 404);

    const promptOut: PromptOut = {
      id: prompt.id,
      body: prompt.body,
      status: prompt.status ?? 'unknown',
      correlationId: prompt.correlationId,
      receivedAt: prompt.receivedAt,
    };

    // Stages — already promptId-keyed; sort ascending so the dashboard
    // can render a forward timeline.
    const stageRows = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, promptId))
      .all()
      .sort((a, b) => a.enteredAt - b.enteredAt);
    const stagesOut: StageOut[] = stageRows.map((r) => ({
      stage: r.stage,
      enteredAt: r.enteredAt,
      durationMs: r.durationMs ?? null,
    }));

    // Events — replay() sorts desc, but we want asc for trace rendering
    // so we re-sort after fetching `limit` rows.
    const eventRows = eventBus.replay({
      correlationId: prompt.correlationId,
      limit,
    });
    const eventsOut: EventOut[] = eventRows
      .slice()
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
      .map((e) => ({
        id: e.id,
        type: e.type,
        occurredAt: e.occurred_at,
        actor: e.actor,
        severity: e.severity,
        entityId: e.entity_id ?? null,
        entityType: e.entity_type ?? null,
        payload: e.payload,
      }));

    // Cost field — null until HARDEN-002 lands; the dashboard handles
    // null gracefully and falls back to the global /metrics aggregate.
    const cost = null;

    // Summary — compute from events (single source of truth).
    let firstEventAt: string | null = null;
    let lastEventAt: string | null = null;
    let durationMs: number | null = null;
    let errorCount = 0;
    let warningCount = 0;
    for (const e of eventsOut) {
      if (firstEventAt === null) firstEventAt = e.occurredAt;
      lastEventAt = e.occurredAt;
      if (e.severity === 'error') errorCount++;
      else if (e.severity === 'warning') warningCount++;
    }
    if (firstEventAt && lastEventAt) {
      const dur = Date.parse(lastEventAt) - Date.parse(firstEventAt);
      durationMs = Number.isFinite(dur) ? dur : null;
    }
    const summary: TraceSummary = {
      firstEventAt,
      lastEventAt,
      durationMs,
      eventCount: eventsOut.length,
      errorCount,
      warningCount,
    };

    return c.json({
      prompt: promptOut,
      stages: stagesOut,
      events: eventsOut,
      cost,
      summary,
    });
  });

  // GET /api/pipelines/recent — N most-recent prompts ordered by
  // receivedAt desc. Lightweight payload (no events) so the dashboard
  // landing page can list pipelines without per-prompt round-trips.
  app.get('/api/pipelines/recent', (c) => {
    const limit = Math.min(
      Math.max(parseInt(c.req.query('limit') ?? '25', 10) || 25, 1),
      200,
    );
    const rows = db
      .select()
      .from(prompts)
      .orderBy(desc(prompts.receivedAt))
      .limit(limit)
      .all();
    const out = rows.map((r) => ({
      id: r.id,
      correlationId: r.correlationId,
      status: r.status ?? 'unknown',
      receivedAt: r.receivedAt,
      bodyExcerpt: r.body.slice(0, 120),
      cost: null,
    }));
    return c.json({ pipelines: out });
  });
}
