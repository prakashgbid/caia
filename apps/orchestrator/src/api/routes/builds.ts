import type { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { buildRuns, buildSteps } from '../../db/schema';

// @no-events — route registration wrapper
export function registerBuildsRoutes(app: Hono, db: Db): void {
  // List recent build runs
  app.get('/builds', (c) => {
    const { limit, status } = c.req.query() as Record<string, string>;
    const n = limit ? parseInt(limit, 10) : 50;

    let q = db.select().from(buildRuns).orderBy(desc(buildRuns.startedAt)).limit(n);
    if (status) {
      q = q.where(eq(buildRuns.status, status)) as typeof q;
    }

    const rows = q.all();
    return c.json({ builds: rows, total: rows.length });
  });

  // Single build run + steps
  app.get('/builds/:id', (c) => {
    const { id } = c.req.param();
    const run = db.select().from(buildRuns).where(eq(buildRuns.id, id)).get();
    if (!run) return c.json({ error: 'not found' }, 404);

    const steps = db.select().from(buildSteps)
      .where(eq(buildSteps.buildRunId, id))
      .orderBy(buildSteps.stepOrder)
      .all();

    return c.json({ build: run, steps });
  });

  // Create / upsert build run (called by build-runner.ts)
  app.post('/builds', async (c) => {
    const body = await c.req.json() as typeof buildRuns.$inferInsert;
    db.insert(buildRuns).values(body).run();
    return c.json({ id: body.id }, 201);
  });

  app.patch('/builds/:id', async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json() as Partial<typeof buildRuns.$inferInsert>;
    db.update(buildRuns).set(body).where(eq(buildRuns.id, id)).run();
    return c.json({ ok: true });
  });

  // Steps CRUD
  app.post('/builds/:id/steps', async (c) => {
    const body = await c.req.json() as typeof buildSteps.$inferInsert;
    db.insert(buildSteps).values(body).run();
    return c.json({ id: body.id }, 201);
  });

  app.patch('/builds/:run_id/steps/:step_id', async (c) => {
    const { step_id } = c.req.param();
    const body = await c.req.json() as Partial<typeof buildSteps.$inferInsert>;
    db.update(buildSteps).set(body).where(eq(buildSteps.id, step_id)).run();
    return c.json({ ok: true });
  });
}
