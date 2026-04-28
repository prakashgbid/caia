import type { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { getSqliteRaw } from '../../db/connection';
import { taskRuns, taskSubtasks, taskRunEvents } from '../../db/schema';
import { bus } from '../../ws/bus';

function subtaskProgress(db: Db, taskRunId: number): { done: number; total: number } {
  const sqlite = getSqliteRaw();
  const rows = sqlite.prepare(
    'SELECT status FROM task_subtasks WHERE task_run_id = ?'
  ).all(taskRunId) as Array<{ status: string }>;
  return {
    done: rows.filter(r => r.status === 'done').length,
    total: rows.length,
  };
}

function parseIntParam(s: string | undefined, fallback: number, max: number): number {
  if (!s) return fallback;
  const n = parseInt(s, 10);
  return isNaN(n) ? fallback : Math.min(n, max);
}

// @no-events — route registration wrapper, individual handlers emit events
export function registerTaskRunRoutes(app: Hono, db: Db): void {
  // POST /task-runs — upsert by session_id
  app.post('/task-runs', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const sessionId = body['session_id'] as string;
    if (!sessionId) return c.json({ error: 'session_id required' }, 400);
    if (!body['title']) return c.json({ error: 'title required' }, 400);

    const now = new Date().toISOString();
    const startedAt = (body['started_at'] as string) ?? now;

    const existing = db.select().from(taskRuns).where(eq(taskRuns.sessionId, sessionId)).all()[0];
    if (existing) {
      return c.json({ ...existing, _action: 'existing' });
    }

    const row = {
      sessionId,
      title: body['title'] as string,
      kind: (body['kind'] as string) ?? 'task',
      cwd: body['cwd'] as string | undefined,
      prompt: body['prompt'] as string | undefined,
      status: 'pending' as const,
      projectSlug: body['project_slug'] as string | undefined,
      domainSlugs: JSON.stringify(body['domain_slugs'] ?? []),
      parentSessionId: body['parent_session_id'] as string | undefined,
      respawnOfSessionId: body['respawn_of_session_id'] as string | undefined,
      startedAt,
      lastActivityAt: startedAt,
      turnCount: 0,
    };

    db.insert(taskRuns).values(row).run();
    const inserted = db.select().from(taskRuns).where(eq(taskRuns.sessionId, sessionId)).all()[0];
    if (!inserted) return c.json({ error: 'Insert failed' }, 500);

    bus.push({ kind: 'task_run.upserted', id: sessionId, payload: inserted, ts: now });

    // If this is a respawn, append a respawn event to the original
    if (row.respawnOfSessionId) {
      const original = db.select().from(taskRuns).where(eq(taskRuns.sessionId, row.respawnOfSessionId)).all()[0];
      if (original) {
        db.insert(taskRunEvents).values({
          taskRunId: original.id,
          at: now,
          eventKind: 'respawn',
          excerpt: `Respawned as ${sessionId}`,
          payload: JSON.stringify({ newSessionId: sessionId }),
        }).run();
      }
    }

    return c.json(inserted, 201);
  });

  // PATCH /task-runs/:session_id — update status/fields
  app.patch('/task-runs/:session_id', async (c) => {
    const { session_id } = c.req.param();
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();

    const existing = db.select().from(taskRuns).where(eq(taskRuns.sessionId, session_id)).all()[0];
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const update: Record<string, unknown> = {};

    if (body['status'] !== undefined) update['status'] = body['status'];
    if (body['turn_count'] !== undefined) update['turnCount'] = body['turn_count'];
    if (body['last_activity_at'] !== undefined) update['lastActivityAt'] = body['last_activity_at'];
    if (body['completion_summary'] !== undefined) update['completionSummary'] = body['completion_summary'];
    if (body['ended_at'] !== undefined) update['endedAt'] = body['ended_at'];
    if (body['result_ok'] !== undefined) update['resultOk'] = body['result_ok'];

    if (!update['lastActivityAt']) update['lastActivityAt'] = now;

    if (Object.keys(update).length > 0) {
      db.update(taskRuns)
        .set(update as Parameters<ReturnType<typeof db.update>['set']>[0])
        .where(eq(taskRuns.sessionId, session_id))
        .run();
    }

    const updated = db.select().from(taskRuns).where(eq(taskRuns.sessionId, session_id)).all()[0];
    bus.push({ kind: 'task_run.upserted', id: session_id, payload: updated, ts: now });
    return c.json(updated);
  });

  // GET /task-runs — list with filters
  app.get('/task-runs', (c) => {
    const q = c.req.query() as Record<string, string>;
    const limit = parseIntParam(q['limit'], 100, 500);
    const since = q['since'];

    let rows = db.select().from(taskRuns).orderBy(desc(taskRuns.startedAt)).all();

    if (q['status']) {
      const statuses = q['status'].split(',');
      rows = rows.filter(r => statuses.includes(r.status));
    }
    if (q['project']) rows = rows.filter(r => r.projectSlug === q['project']);
    if (q['domain']) {
      rows = rows.filter(r => {
        try { return (JSON.parse(r.domainSlugs) as string[]).includes(q['domain']); } catch { return false; }
      });
    }
    if (since) rows = rows.filter(r => r.startedAt >= since);
    if (q['cursor']) {
      const idx = rows.findIndex(r => r.sessionId === q['cursor']);
      if (idx >= 0) rows = rows.slice(idx + 1);
    }
    rows = rows.slice(0, limit);

    const result = rows.map(r => ({
      ...r,
      subtask_progress: subtaskProgress(db, r.id),
    }));

    return c.json(result);
  });

  // GET /task-runs/:session_id — detail with subtasks + events + respawn chain
  app.get('/task-runs/:session_id', (c) => {
    const { session_id } = c.req.param();
    const run = db.select().from(taskRuns).where(eq(taskRuns.sessionId, session_id)).all()[0];
    if (!run) return c.json({ error: 'Not found' }, 404);

    const subtasks = db.select().from(taskSubtasks)
      .where(eq(taskSubtasks.taskRunId, run.id))
      .orderBy(taskSubtasks.ordinal, taskSubtasks.id)
      .all();

    const events = db.select().from(taskRunEvents)
      .where(eq(taskRunEvents.taskRunId, run.id))
      .orderBy(desc(taskRunEvents.at))
      .all();

    // Build respawn chain: find prior + next
    let prior: typeof run | undefined;
    if (run.respawnOfSessionId) {
      prior = db.select().from(taskRuns).where(eq(taskRuns.sessionId, run.respawnOfSessionId)).all()[0];
    }
    const nextRun = db.select().from(taskRuns).where(eq(taskRuns.respawnOfSessionId, session_id)).all()[0];
    const next: typeof run | undefined = nextRun;

    return c.json({
      ...run,
      subtask_progress: { done: subtasks.filter(s => s.status === 'done').length, total: subtasks.length },
      subtasks,
      events,
      respawn: { prior: prior ?? null, next: next ?? null },
    });
  });

  // POST /task-runs/:session_id/subtasks — upsert subtask
  app.post('/task-runs/:session_id/subtasks', async (c) => {
    const { session_id } = c.req.param();
    const run = db.select().from(taskRuns).where(eq(taskRuns.sessionId, session_id)).all()[0];
    if (!run) return c.json({ error: 'task_run not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();

    // Upsert: match by (task_run_id, ordinal) if provided, or (task_run_id, source, evidence_value)
    const ordinal = body['ordinal'] !== undefined ? (body['ordinal'] as number) : undefined;
    const source = (body['source'] as string) ?? 'manual';
    const evidenceValue = body['evidence_value'] as string | undefined;

    let existing: typeof taskSubtasks.$inferSelect | undefined;
    if (ordinal !== undefined) {
      existing = db.select().from(taskSubtasks).where(
        and(eq(taskSubtasks.taskRunId, run.id), eq(taskSubtasks.ordinal, ordinal))
      ).all()[0];
    } else if (evidenceValue && source !== 'manual') {
      existing = db.select().from(taskSubtasks).where(
        and(
          eq(taskSubtasks.taskRunId, run.id),
          eq(taskSubtasks.source, source),
          eq(taskSubtasks.evidenceValue, evidenceValue),
        )
      ).all()[0];
    }

    const status = (body['status'] as string) ?? 'pending';

    if (existing) {
      const update: Record<string, unknown> = { status };
      if (body['title']) update['title'] = body['title'];
      if (body['evidence_kind']) update['evidenceKind'] = body['evidence_kind'];
      if (body['evidence_value']) update['evidenceValue'] = body['evidence_value'];
      if (body['detail']) update['detail'] = body['detail'];
      if (status === 'in_progress' && !existing.startedAt) update['startedAt'] = now;
      if ((status === 'done' || status === 'failed') && !existing.completedAt) update['completedAt'] = now;

      db.update(taskSubtasks).set(update as Parameters<ReturnType<typeof db.update>['set']>[0])
        .where(eq(taskSubtasks.id, existing.id)).run();

      const updated = db.select().from(taskSubtasks).where(eq(taskSubtasks.id, existing.id)).all()[0];
      bus.push({ kind: 'task_run.subtask_changed', id: session_id, payload: updated, ts: now });
      return c.json(updated);
    }

    const row: typeof taskSubtasks.$inferInsert = {
      taskRunId: run.id,
      ordinal,
      title: body['title'] as string,
      status,
      source,
      evidenceKind: body['evidence_kind'] as string | undefined,
      evidenceValue,
      detail: body['detail'] as string | undefined,
    };
    if (status === 'in_progress') row.startedAt = now;
    if (status === 'done' || status === 'failed') { row.startedAt = now; row.completedAt = now; }

    db.insert(taskSubtasks).values(row).run();
    const inserted = db.select().from(taskSubtasks)
      .where(eq(taskSubtasks.taskRunId, run.id))
      .orderBy(desc(taskSubtasks.id))
      .all()[0];

    bus.push({ kind: 'task_run.subtask_changed', id: session_id, payload: inserted, ts: now });
    return c.json(inserted, 201);
  });

  // POST /task-runs/:session_id/events — append event
  app.post('/task-runs/:session_id/events', async (c) => {
    const { session_id } = c.req.param();
    const run = db.select().from(taskRuns).where(eq(taskRuns.sessionId, session_id)).all()[0];
    if (!run) return c.json({ error: 'task_run not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();

    const row = {
      taskRunId: run.id,
      at: now,
      turnCount: body['turn_count'] as number | undefined,
      eventKind: body['event_kind'] as string,
      excerpt: body['excerpt'] ? String(body['excerpt']).slice(0, 500) : undefined,
      payload: JSON.stringify(body['payload'] ?? {}),
    };
    db.insert(taskRunEvents).values(row).run();

    const inserted = db.select().from(taskRunEvents)
      .where(eq(taskRunEvents.taskRunId, run.id))
      .orderBy(desc(taskRunEvents.id))
      .all()[0];

    bus.push({ kind: 'task_run.event_appended', id: session_id, payload: inserted, ts: now });
    return c.json(inserted, 201);
  });

  // GET /task-runs/:session_id/respawn-chain — full chain
  app.get('/task-runs/:session_id/respawn-chain', (c) => {
    const { session_id } = c.req.param();

    const current = db.select().from(taskRuns).where(eq(taskRuns.sessionId, session_id)).all()[0];
    if (!current) return c.json({ error: 'Not found' }, 404);

    // Build backwards chain
    const backwards: typeof taskRuns.$inferSelect[] = [];
    let cursor = current;
    while (cursor.respawnOfSessionId) {
      const prev = db.select().from(taskRuns).where(eq(taskRuns.sessionId, cursor.respawnOfSessionId)).all()[0];
      if (!prev) break;
      backwards.unshift(prev);
      cursor = prev;
    }

    // Build forwards chain from current
    const forwards: typeof taskRuns.$inferSelect[] = [current];
    let fwdCursor = current;
    for (let i = 0; i < 20; i++) {
      const next = db.select().from(taskRuns).where(eq(taskRuns.respawnOfSessionId, fwdCursor.sessionId)).all()[0];
      if (!next) break;
      forwards.push(next);
      fwdCursor = next;
    }

    const allInChain = [...backwards, ...forwards];

    // Add subtask progress to each
    const withProgress = allInChain.map(r => ({
      ...r,
      subtask_progress: subtaskProgress(db, r.id),
      isCurrent: r.sessionId === session_id,
    }));

    return c.json(withProgress);
  });
}
