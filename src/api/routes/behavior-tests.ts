import type { Hono } from 'hono';
import { eq, desc, and } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { getSqliteRaw } from '../../db/connection';
import { behaviorTests, behaviorTestRuns, behaviorTestFailures } from '../../db/schema';
import { nanoid } from 'nanoid';

export function registerBehaviorTestRoutes(app: Hono, db: Db): void {
  // GET /behavior-tests — list with optional filters
  app.get('/behavior-tests', (c) => {
    const q = c.req.query() as Record<string, string>;
    let rows = db.select().from(behaviorTests).all();

    if (q['feature'])  rows = rows.filter(r => r.feature === q['feature']);
    if (q['project'])  rows = rows.filter(r => r.projectSlug === q['project']);
    if (q['domain'])   rows = rows.filter(r => {
      try { return (JSON.parse(r.domainSlugs) as string[]).includes(q['domain']); } catch { return false; }
    });
    if (q['scope'])    rows = rows.filter(r => r.scope.includes(q['scope']));

    if (q['status']) {
      // Attach last-run status for filtering
      const sqlite = getSqliteRaw();
      const withStatus = rows.map(r => {
        const lastRun = sqlite.prepare(
          'SELECT status FROM behavior_test_runs WHERE test_id = ? ORDER BY run_at DESC LIMIT 1'
        ).get(r.id) as { status: string } | undefined;
        return { ...r, last_status: lastRun?.status ?? 'never' };
      });
      return c.json(withStatus.filter(r => r.last_status === q['status']));
    }

    return c.json(rows);
  });

  // POST /behavior-tests — upsert by (name, feature)
  app.post('/behavior-tests', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const name    = body['name'] as string | undefined;
    const feature = body['feature'] as string | undefined;
    const scope   = body['scope'] as string | undefined;

    if (!name || !feature || !scope) {
      return c.json({ error: 'name, feature, and scope required' }, 400);
    }

    const now = new Date().toISOString();
    const existing = db.select().from(behaviorTests)
      .where(and(eq(behaviorTests.name, name), eq(behaviorTests.feature, feature)))
      .all()[0];

    if (existing) {
      db.update(behaviorTests).set({ lastSeenAt: now }).where(eq(behaviorTests.id, existing.id)).run();
      return c.json({ ...existing, _action: 'existing' });
    }

    const id = nanoid();
    const row = {
      id,
      name,
      feature,
      scope,
      projectSlug: body['project_slug'] as string | undefined,
      domainSlugs: JSON.stringify(body['domain_slugs'] ?? []),
      sourcePath: body['source_path'] as string | undefined,
      firstSeenAt: now,
      lastSeenAt: now,
      expectedBehavior: (body['expected_behavior'] as string) ?? name,
      layoutContract: body['layout_contract'] ? JSON.stringify(body['layout_contract']) : undefined,
      notes: body['notes'] as string | undefined,
    };

    db.insert(behaviorTests).values(row).run();
    const inserted = db.select().from(behaviorTests).where(eq(behaviorTests.id, id)).all()[0];
    return c.json(inserted, 201);
  });

  // POST /behavior-tests/:id/runs — append a run
  app.post('/behavior-tests/:id/runs', async (c) => {
    const { id } = c.req.param();
    const test = db.select().from(behaviorTests).where(eq(behaviorTests.id, id)).all()[0];
    if (!test) return c.json({ error: 'behavior_test not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();

    const row = {
      testId: id,
      runAt: (body['run_at'] as string) ?? now,
      durationMs: body['duration_ms'] as number | undefined,
      status: (body['status'] as string) ?? 'skip',
      evidenceUrl: body['evidence_url'] as string | undefined,
      failureExcerpt: body['failure_excerpt'] ? String(body['failure_excerpt']).slice(0, 1000) : undefined,
      gitSha: body['git_sha'] as string | undefined,
      ci: Boolean(body['ci']),
    };

    db.insert(behaviorTestRuns).values(row).run();
    const inserted = db.select().from(behaviorTestRuns)
      .where(eq(behaviorTestRuns.testId, id))
      .orderBy(desc(behaviorTestRuns.id))
      .all()[0];

    // Update test's lastSeenAt
    db.update(behaviorTests).set({ lastSeenAt: now }).where(eq(behaviorTests.id, id)).run();

    return c.json(inserted, 201);
  });

  // POST /behavior-tests/runs/:run_id/failures — file a failure record
  app.post('/behavior-tests/runs/:run_id/failures', async (c) => {
    const runId = parseInt(c.req.param('run_id'), 10);
    const run = db.select().from(behaviorTestRuns).where(eq(behaviorTestRuns.id, runId)).all()[0];
    if (!run) return c.json({ error: 'behavior_test_run not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const row = {
      testRunId: runId,
      conductorBlockerId: body['conductor_blocker_id'] as string | undefined,
      kind: (body['kind'] as string) ?? 'regression',
      message: (body['message'] as string) ?? '',
      stackExcerpt: body['stack_excerpt'] ? String(body['stack_excerpt']).slice(0, 2000) : undefined,
    };

    db.insert(behaviorTestFailures).values(row).run();
    const inserted = db.select().from(behaviorTestFailures)
      .where(eq(behaviorTestFailures.testRunId, runId))
      .orderBy(desc(behaviorTestFailures.id))
      .all()[0];

    return c.json(inserted, 201);
  });

  // GET /behavior-tests/:id/runs — recent runs for flake detection
  app.get('/behavior-tests/:id/runs', (c) => {
    const { id } = c.req.param();
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);

    const test = db.select().from(behaviorTests).where(eq(behaviorTests.id, id)).all()[0];
    if (!test) return c.json({ error: 'behavior_test not found' }, 404);

    const runs = db.select().from(behaviorTestRuns)
      .where(eq(behaviorTestRuns.testId, id))
      .orderBy(desc(behaviorTestRuns.runAt))
      .all()
      .slice(0, limit);

    // Attach failures
    const sqlite = getSqliteRaw();
    const withFailures = runs.map(r => {
      const failures = sqlite.prepare(
        'SELECT * FROM behavior_test_failures WHERE test_run_id = ?'
      ).all(r.id) as Array<Record<string, unknown>>;
      return { ...r, failures };
    });

    // Flake detection: flaky if last 10 runs have mixed pass/fail
    const last10 = runs.slice(0, 10);
    const hasPassed = last10.some(r => r.status === 'pass');
    const hasFailed = last10.some(r => r.status === 'fail');
    const isFlaky = hasPassed && hasFailed;

    return c.json({ test, runs: withFailures, is_flaky: isFlaky });
  });

  // GET /behavior-tests/coverage — coverage rollup per feature/domain/project
  app.get('/behavior-tests/coverage', (c) => {
    const sqlite = getSqliteRaw();
    const tests = db.select().from(behaviorTests).all();

    // Get last run status for each test
    const withStatus = tests.map(t => {
      const lastRun = sqlite.prepare(
        'SELECT status FROM behavior_test_runs WHERE test_id = ? ORDER BY run_at DESC LIMIT 1'
      ).get(t.id) as { status: string } | undefined;
      return { ...t, last_status: lastRun?.status ?? 'never' };
    });

    const total   = withStatus.length;
    const passing = withStatus.filter(t => t.last_status === 'pass').length;
    const failing = withStatus.filter(t => t.last_status === 'fail').length;
    const skipped = withStatus.filter(t => t.last_status === 'skip' || t.last_status === 'never').length;
    const flaky   = withStatus.filter(t => t.last_status === 'flaky').length;

    // By feature
    const byFeature: Record<string, { total: number; passing: number; failing: number; skipped: number }> = {};
    for (const t of withStatus) {
      if (!byFeature[t.feature]) byFeature[t.feature] = { total: 0, passing: 0, failing: 0, skipped: 0 };
      byFeature[t.feature].total++;
      if (t.last_status === 'pass')  byFeature[t.feature].passing++;
      else if (t.last_status === 'fail') byFeature[t.feature].failing++;
      else byFeature[t.feature].skipped++;
    }

    // By project
    const byProject: Record<string, { total: number; passing: number; failing: number }> = {};
    for (const t of withStatus) {
      const proj = t.projectSlug ?? 'unknown';
      if (!byProject[proj]) byProject[proj] = { total: 0, passing: 0, failing: 0 };
      byProject[proj].total++;
      if (t.last_status === 'pass')   byProject[proj].passing++;
      else if (t.last_status === 'fail') byProject[proj].failing++;
    }

    // 7-day trend
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentRuns = sqlite.prepare(
      'SELECT date(run_at) as day, status, COUNT(*) as count FROM behavior_test_runs WHERE run_at >= ? GROUP BY day, status ORDER BY day ASC'
    ).all(sevenDaysAgo) as Array<{ day: string; status: string; count: number }>;

    const trend: Record<string, { pass: number; fail: number }> = {};
    for (const r of recentRuns) {
      if (!trend[r.day]) trend[r.day] = { pass: 0, fail: 0 };
      if (r.status === 'pass') trend[r.day].pass += r.count;
      else if (r.status === 'fail') trend[r.day].fail += r.count;
    }

    return c.json({
      total, passing, failing, skipped, flaky,
      pass_rate: total > 0 ? Math.round((passing / total) * 100) : 0,
      byFeature, byProject,
      trend_7d: trend,
    });
  });
}
