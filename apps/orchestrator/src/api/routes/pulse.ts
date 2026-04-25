import type { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { pulseRuns } from '../../db/schema';

// @no-events — route registration wrapper
export function registerPulseRoutes(app: Hono, db: Db): void {
  // List recent pulse runs
  app.get('/pulse/runs', (c) => {
    const { limit, outcome } = c.req.query() as Record<string, string>;
    const n = limit ? parseInt(limit, 10) : 50;
    let q = db.select().from(pulseRuns).orderBy(desc(pulseRuns.ranAt)).limit(n);
    if (outcome) {
      q = q.where(eq(pulseRuns.outcome, outcome)) as typeof q;
    }
    const rows = q.all();
    return c.json({ runs: rows, total: rows.length });
  });

  // Single pulse run
  app.get('/pulse/runs/:id', (c) => {
    const { id } = c.req.param();
    const run = db.select().from(pulseRuns).where(eq(pulseRuns.id, id)).get();
    if (!run) return c.json({ error: 'not found' }, 404);
    return c.json({ run });
  });

  // Create pulse run (called by emit.ts)
  app.post('/pulse/runs', async (c) => {
    const body = await c.req.json() as {
      id: string; ran_at: string; outcome: string;
      canary_id?: string | null; canary_elapsed_ms?: number | null;
      checks_json: string; invariants_json: string; heals_json: string;
      duration_ms: number;
    };
    db.insert(pulseRuns).values({
      id: body.id,
      ranAt: body.ran_at,
      outcome: body.outcome,
      canaryId: body.canary_id ?? undefined,
      canaryElapsedMs: body.canary_elapsed_ms ?? undefined,
      checksJson: body.checks_json,
      invariantsJson: body.invariants_json,
      healsJson: body.heals_json,
      durationMs: body.duration_ms,
    }).run();
    return c.json({ id: body.id }, 201);
  });

  // Purge old canary tasks — called by pulse on schedule
  app.delete('/pulse/canary/purge', async (c) => {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    // Remove pulse runs older than 24h (keep data for dashboard)
    const old = db.select({ id: pulseRuns.id })
      .from(pulseRuns)
      .where(eq(pulseRuns.outcome, 'PASSING'))
      .orderBy(desc(pulseRuns.ranAt))
      .offset(288) // keep last 24h @ 5min intervals = 288 runs
      .all();
    let deleted = 0;
    for (const row of old) {
      db.delete(pulseRuns).where(eq(pulseRuns.id, row.id)).run();
      deleted++;
    }
    return c.json({ deleted, cutoff });
  });

  // Stats for dashboard
  app.get('/pulse/stats', (c) => {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentRuns = db.select()
      .from(pulseRuns)
      .where(eq(pulseRuns.ranAt, last24h))
      .orderBy(desc(pulseRuns.ranAt))
      .limit(288)
      .all();

    const allRuns = db.select().from(pulseRuns).orderBy(desc(pulseRuns.ranAt)).limit(288).all();
    const latest = allRuns[0] ?? null;
    const healCounts: Record<string, number> = {};
    for (const run of allRuns) {
      try {
        const heals = JSON.parse(run.healsJson) as Array<{ action: string; success: boolean }>;
        for (const h of heals) {
          if (h.success) healCounts[h.action] = (healCounts[h.action] ?? 0) + 1;
        }
      } catch { /* skip */ }
    }
    return c.json({ latest, runs: allRuns, healCounts, recentRuns });
  });
}
