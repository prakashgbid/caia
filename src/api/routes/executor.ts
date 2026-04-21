import type { Hono } from 'hono';
import { eq, and, desc, inArray, asc } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { getSqliteRaw } from '../../db/connection';
import {
  tasks,
  executorRuns,
  executorConfig,
  taskAttempts,
  timelineEvents,
  blockers,
} from '../../db/schema';
import { bus } from '../../ws/bus';
import { nanoid } from 'nanoid';
import { eventBus } from '../../events/bus-adapter';

function now(): string {
  return new Date().toISOString();
}

export function registerExecutorRoutes(app: Hono, db: Db): void {

  // ── Individual task GET/PATCH (needed by completion hook) ───────────────────

  app.get('/tasks/:id', (c) => {
    const { id } = c.req.param();
    const row = db.select().from(tasks).where(eq(tasks.id, id)).all()[0];
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json(row);
  });

  app.patch('/tasks/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<Record<string, unknown>>();
    const before = db.select().from(tasks).where(eq(tasks.id, id)).get();
    const update: Record<string, unknown> = {};
    if (body['status'] !== undefined) update['status'] = body['status'];
    if (body['session_id'] !== undefined) update['sessionId'] = body['session_id'];
    if (body['actual_files'] !== undefined) update['actualFiles'] = body['actual_files'];
    if (body['completed_at'] !== undefined) update['completedAt'] = body['completed_at'];
    if (body['attempt_count'] !== undefined) update['attemptCount'] = Number(body['attempt_count']);
    if (body['paused'] !== undefined) update['paused'] = Boolean(body['paused']);
    if (body['pause_reason'] !== undefined) update['pauseReason'] = body['pause_reason'];
    if (Object.keys(update).length === 0) return c.json({ error: 'no fields to update' }, 400);
    db.update(tasks).set(update as Partial<typeof tasks.$inferInsert>).where(eq(tasks.id, id)).run();
    const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (!row) return c.json({ error: 'not found' }, 404);
    // Emit status change event when status transitions
    if (update['status'] && before && before.status !== update['status']) {
      eventBus.publish({
        type: 'task.status_changed',
        actor: 'executor',
        entity_type: 'task',
        entity_id: id,
        payload: { task_id: id, from_status: before.status, to_status: update['status'] as string },
      });
    }
    if (update['paused'] && !before?.paused) {
      eventBus.publish({
        type: 'task.paused',
        actor: 'executor',
        entity_type: 'task',
        entity_id: id,
        payload: { task_id: id, pause_reason: (update['pauseReason'] as string) ?? '' },
      });
    }
    return c.json(row);
  });

  // ── Config ──────────────────────────────────────────────────────────────────

  app.get('/executor/config', (c) => {
    const cfg = db.select().from(executorConfig).all()[0];
    if (!cfg) return c.json({ error: 'executor_config not seeded' }, 500);
    return c.json(cfg);
  });

  app.patch('/executor/config', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const cfg = db.select().from(executorConfig).all()[0];
    if (!cfg) return c.json({ error: 'executor_config not seeded' }, 500);

    const update: Record<string, unknown> = { updatedAt: now() };
    if (body['enabled'] !== undefined) update['enabled'] = Boolean(body['enabled']);
    if (body['max_concurrent'] !== undefined) update['maxConcurrent'] = Number(body['max_concurrent']);
    if (body['max_per_domain_concurrent'] !== undefined) update['maxPerDomainConcurrent'] = Number(body['max_per_domain_concurrent']);
    if (body['circuit_breaker_threshold'] !== undefined) update['circuitBreakerThreshold'] = Number(body['circuit_breaker_threshold']);
    if (body['poll_interval_ms'] !== undefined) update['pollIntervalMs'] = Number(body['poll_interval_ms']);
    if (body['monitor_interval_ms'] !== undefined) update['monitorIntervalMs'] = Number(body['monitor_interval_ms']);
    if (body['max_turns'] !== undefined) update['maxTurns'] = Number(body['max_turns']);
    if (body['permission_mode'] !== undefined) update['permissionMode'] = String(body['permission_mode']);

    db.update(executorConfig)
      .set(update as Parameters<ReturnType<typeof db.update>['set']>[0])
      .where(eq(executorConfig.id, cfg.id))
      .run();

    const changedFields = Object.keys(body).filter(k => k !== 'updated_at');
    if (changedFields.length > 0) {
      eventBus.publish({
        type: 'executor.config_changed',
        actor: 'api',
        payload: { fields_changed: changedFields },
      });
    }

    return c.json(db.select().from(executorConfig).all()[0]);
  });

  // ── Status ───────────────────────────────────────────────────────────────────

  app.get('/executor/status', (c) => {
    const cfg = db.select().from(executorConfig).all()[0];
    const runningRuns = db.select().from(executorRuns)
      .where(eq(executorRuns.status, 'running'))
      .all();
    const queuedTasks = db.select().from(tasks)
      .where(and(eq(tasks.status, 'queued'), eq(tasks.paused, false)))
      .all();
    const pausedTasks = db.select().from(tasks)
      .where(eq(tasks.paused, true))
      .all();
    const recentRuns = db.select().from(executorRuns)
      .orderBy(desc(executorRuns.startedAt))
      .limit(20)
      .all();

    // Throughput: completions in last 24h
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const completedToday = db.select().from(executorRuns)
      .where(eq(executorRuns.status, 'done'))
      .all()
      .filter(r => (r.startedAt ?? '') >= cutoff);

    // Read heartbeat file
    let heartbeat: { at: string; pid: number; running: number; queued: number } | null = null;
    try {
      const { readFileSync } = require('fs') as typeof import('fs');
      const { join } = require('path') as typeof import('path');
      const { homedir } = require('os') as typeof import('os');
      const hbPath = join(homedir(), '.conductor', 'executor.heartbeat');
      heartbeat = JSON.parse(readFileSync(hbPath, 'utf8')) as { at: string; pid: number; running: number; queued: number };
    } catch { /* daemon not running */ }

    return c.json({
      enabled: cfg?.enabled ?? false,
      daemon_alive: heartbeat !== null,
      daemon_pid: heartbeat?.pid ?? null,
      last_heartbeat_at: heartbeat?.at ?? null,
      running: runningRuns.length,
      queued: queuedTasks.length,
      paused: pausedTasks.length,
      completed_24h: completedToday.length,
      config: cfg,
      recent_runs: recentRuns,
    });
  });

  // ── Executor controls ───────────────────────────────────────────────────────

  app.post('/executor/pause', async (c) => {
    db.update(executorConfig)
      .set({ enabled: false, updatedAt: now() })
      .run();
    return c.json({ ok: true, enabled: false });
  });

  app.post('/executor/resume', async (c) => {
    db.update(executorConfig)
      .set({ enabled: true, updatedAt: now() })
      .run();
    return c.json({ ok: true, enabled: true });
  });

  app.post('/executor/drain', async (c) => {
    // Disable and kill all running workers (workers detect via config.enabled=false)
    db.update(executorConfig)
      .set({ enabled: false, updatedAt: now() })
      .run();

    // Mark all running executor_runs as killed
    db.update(executorRuns)
      .set({ status: 'killed', endedAt: now(), failureReason: 'Manual drain' })
      .where(eq(executorRuns.status, 'running'))
      .run();

    return c.json({ ok: true, drained: true });
  });

  // ── Priority-aware next-task selection ──────────────────────────────────────
  // Returns the highest-priority eligible queued task (not paused, deps satisfied).
  // Reads priority_bucket + position_ordinal first (migration 0012).
  app.get('/executor/tasks/next', (c) => {
    const q = c.req.query() as Record<string, string>;
    const domainCap = q['domain_slug'] ?? null;

    // Load all queued, unpaused tasks ordered by bucket → ordinal
    const sqlite = getSqliteRaw();
    let candidates = db.select().from(tasks)
      .where(and(eq(tasks.status, 'queued'), eq(tasks.paused, false)))
      .orderBy(asc(tasks.priorityBucket), asc(tasks.positionOrdinal))
      .all();

    if (domainCap) candidates = candidates.filter(t => t.domainSlug === domainCap);

    // Dep-aware: skip tasks whose deps are not done/completed
    const runningIds = db.select({ id: tasks.id }).from(tasks)
      .where(eq(tasks.status, 'running'))
      .all()
      .map(r => r.id);

    const eligible = candidates.find(task => {
      const depIds = JSON.parse(task.dependsOn) as string[];
      if (depIds.length === 0) return true;
      // All deps must be completed/done
      const depRows = sqlite.prepare(
        `SELECT id, status FROM tasks WHERE id IN (${depIds.map(() => '?').join(',')})`
      ).all(...depIds) as Array<{ id: string; status: string }>;
      return depRows.every(d => ['done', 'completed'].includes(d.status));
    });

    if (!eligible) return c.json({ task: null, message: 'No eligible tasks queued' });
    return c.json({ task: eligible });
  });

  // ── Task-level pause/unpause ─────────────────────────────────────────────────

  app.post('/executor/tasks/:id/pause', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    db.update(tasks)
      .set({ paused: true, pauseReason: (body['reason'] as string | undefined) ?? 'Manual pause' })
      .where(eq(tasks.id, id))
      .run();
    bus.push({ kind: 'task.paused', id, payload: { reason: body['reason'] }, ts: now() });
    return c.json({ ok: true });
  });

  app.post('/executor/tasks/:id/unpause', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    const update: Record<string, unknown> = { paused: false, pauseReason: null };
    if (body['reset_attempts']) update['attemptCount'] = 0;
    db.update(tasks)
      .set(update as Parameters<ReturnType<typeof db.update>['set']>[0])
      .where(eq(tasks.id, id))
      .run();
    bus.push({ kind: 'task.unpaused', id, payload: {}, ts: now() });
    return c.json({ ok: true });
  });

  app.post('/executor/tasks/:id/running', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
    db.update(tasks)
      .set({ status: 'running', startedAt: (body['started_at'] as string | undefined) ?? now() })
      .where(eq(tasks.id, id))
      .run();
    return c.json({ ok: true });
  });

  // ── Executor runs CRUD ───────────────────────────────────────────────────────

  app.get('/executor/runs', (c) => {
    const q = c.req.query() as Record<string, string>;
    let rows = db.select().from(executorRuns).orderBy(desc(executorRuns.startedAt)).all();
    if (q['status']) {
      const statuses = q['status'].split(',');
      rows = rows.filter(r => statuses.includes(r.status));
    }
    if (q['task_id']) rows = rows.filter(r => r.taskId === q['task_id']);
    return c.json(rows.slice(0, 100));
  });

  app.post('/executor/runs', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const row = {
      taskId: body['task_id'] as string,
      attemptN: Number(body['attempt_n'] ?? 1),
      pid: body['pid'] ? Number(body['pid']) : undefined,
      workerKind: (body['worker_kind'] as string) ?? 'claude-p',
      worktreePath: body['worktree_path'] as string | undefined,
      startedAt: (body['started_at'] as string) ?? now(),
      status: 'running',
    };
    db.insert(executorRuns).values(row as typeof executorRuns.$inferInsert).run();
    const inserted = db.select().from(executorRuns)
      .where(and(eq(executorRuns.taskId, row.taskId), eq(executorRuns.startedAt, row.startedAt)))
      .orderBy(desc(executorRuns.id))
      .all()[0];
    return c.json(inserted, 201);
  });

  app.patch('/executor/runs/:id', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const body = await c.req.json<Record<string, unknown>>();
    const update: Record<string, unknown> = {};
    if (body['session_id'] !== undefined) update['sessionId'] = body['session_id'];
    if (body['status'] !== undefined) update['status'] = body['status'];
    if (body['result_summary'] !== undefined) update['resultSummary'] = body['result_summary'];
    if (body['failure_reason'] !== undefined) update['failureReason'] = body['failure_reason'];
    if (body['cost_usd'] !== undefined) update['costUsd'] = body['cost_usd'];
    if (body['turn_count_at_end'] !== undefined) update['turnCountAtEnd'] = body['turn_count_at_end'];
    if (body['ended_at'] !== undefined) update['endedAt'] = body['ended_at'];
    if (body['pid'] !== undefined) update['pid'] = body['pid'];
    db.update(executorRuns)
      .set(update as Parameters<ReturnType<typeof db.update>['set']>[0])
      .where(eq(executorRuns.id, id))
      .run();
    return c.json({ ok: true });
  });

  // ── Task attempts ────────────────────────────────────────────────────────────

  app.get('/tasks/:id/attempts', (c) => {
    const { id } = c.req.param();
    const rows = db.select().from(taskAttempts)
      .where(eq(taskAttempts.taskId, id))
      .orderBy(desc(taskAttempts.attemptN))
      .all();
    return c.json(rows);
  });

  // ── Manual task nudge ────────────────────────────────────────────────────────

  app.post('/executor/tasks/:id/run-now', async (c) => {
    const { id } = c.req.param();
    const task = db.select().from(tasks).where(eq(tasks.id, id)).all()[0];
    if (!task) return c.json({ error: 'Task not found' }, 404);
    if (task.status !== 'queued') return c.json({ error: `Task is ${task.status}, not queued` }, 400);

    // Unpause if paused, then the next daemon tick picks it up
    if (task.paused) {
      db.update(tasks).set({ paused: false, pauseReason: null }).where(eq(tasks.id, id)).run();
    }

    bus.push({ kind: 'task.nudged', id, payload: { manual: true }, ts: now() });
    return c.json({ ok: true, message: 'Task will be picked up on next executor tick' });
  });
}
