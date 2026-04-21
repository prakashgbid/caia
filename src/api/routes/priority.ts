import type { Hono } from 'hono';
import { eq, desc, asc, and, notInArray } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { tasks, priorityAudit } from '../../db/schema';
import { scoreOne, scoreAll } from '../../prioritization/reprioritizer';
import { eventBus } from '../../events/bus-adapter';

const TERMINAL_STATUSES = ['done', 'completed', 'failed', 'cancelled'];

function now(): string {
  return new Date().toISOString();
}

// @no-events — route registration wrapper
export function registerPriorityRoutes(app: Hono, db: Db): void {

  // GET /priority/queue — full queue ordered by bucket + ordinal
  app.get('/priority/queue', (c) => {
    const q = c.req.query() as Record<string, string>;

    let rows = db.select().from(tasks)
      .where(notInArray(tasks.status, TERMINAL_STATUSES))
      .orderBy(asc(tasks.priorityBucket), asc(tasks.positionOrdinal))
      .all();

    if (q['bucket']) rows = rows.filter(r => r.priorityBucket === q['bucket']);
    if (q['project_id']) rows = rows.filter(r => r.projectId === q['project_id']);

    const grouped: Record<string, typeof rows> = { P0: [], P1: [], P2: [], P3: [] };
    for (const row of rows) {
      const b = row.priorityBucket ?? 'P2';
      if (!grouped[b]) grouped[b] = [];
      grouped[b].push(row);
    }

    return c.json({ total: rows.length, grouped, rows });
  });

  // POST /priority/score/:taskId — rescore a single task
  app.post('/priority/score/:taskId', async (c) => {
    const { taskId } = c.req.param();
    const result = await scoreOne(taskId, db, 'api');
    if (!result) return c.json({ error: 'Task not found' }, 404);
    return c.json(result, 200);
  });

  // POST /priority/score-all — batch rescore all active tasks
  app.post('/priority/score-all', async (c) => {
    const results = await scoreAll(db, 'api');
    return c.json({ rescored: results.length, results }, 200);
  });

  // GET /priority/explain/:taskId — human-readable score breakdown
  app.get('/priority/explain/:taskId', (c) => {
    const { taskId } = c.req.param();
    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task) return c.json({ error: 'Task not found' }, 404);

    const rationale = task.priorityRationaleJson
      ? JSON.parse(task.priorityRationaleJson) as Record<string, unknown>
      : null;

    return c.json({
      task_id: task.id,
      title: task.title,
      score: task.priorityScore,
      bucket: task.priorityBucket,
      ordinal: task.positionOrdinal,
      last_prioritized_at: task.lastPrioritizedAt,
      rationale,
    });
  });

  // GET /priority/audit/:taskId — history of priority changes
  app.get('/priority/audit/:taskId', (c) => {
    const { taskId } = c.req.param();
    const q = c.req.query() as Record<string, string>;
    const limit = Math.min(parseInt(q['limit'] ?? '50', 10), 200);

    const rows = db.select().from(priorityAudit)
      .where(eq(priorityAudit.taskId, taskId))
      .orderBy(desc(priorityAudit.changedAt))
      .limit(limit)
      .all();

    return c.json(rows);
  });

  // POST /priority/override — user drag-to-override
  app.post('/priority/override', async (c) => {
    const body = await c.req.json<{
      task_id: string;
      new_ordinal: number;
      reason?: string;
    }>();

    const task = db.select().from(tasks).where(eq(tasks.id, body.task_id)).get();
    if (!task) return c.json({ error: 'Task not found' }, 404);

    const oldOrdinal = task.positionOrdinal;
    db.update(tasks)
      .set({ positionOrdinal: body.new_ordinal, lastPrioritizedAt: now() })
      .where(eq(tasks.id, body.task_id))
      .run();

    // Audit the override
    db.insert(priorityAudit).values({
      taskId: body.task_id,
      oldScore: task.priorityScore,
      newScore: task.priorityScore,
      oldBucket: task.priorityBucket,
      newBucket: task.priorityBucket,
      reason: body.reason ?? 'User drag-to-override',
      actor: 'user',
      changedAt: now(),
    }).run();

    eventBus.publish({
      type: 'priority.user_override',
      actor: 'user',
      entity_type: 'task',
      entity_id: body.task_id,
      payload: {
        task_id: body.task_id,
        old_ordinal: oldOrdinal,
        new_ordinal: body.new_ordinal,
        override_reason: body.reason ?? 'drag-to-override',
      },
    });

    return c.json({ ok: true, task_id: body.task_id, new_ordinal: body.new_ordinal });
  });
}
