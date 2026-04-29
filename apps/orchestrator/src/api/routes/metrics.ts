import type { Hono } from 'hono';
import type { Db } from '../../db/connection';
import { tasks, blockers, requirements } from '../../db/schema';
import { getPipelineCostTracker } from '../../agents/pipeline-cost-tracker';

// @no-events — route registration wrapper, individual handlers emit events
export function registerMetricsRoutes(app: Hono, db: Db): void {
  app.get('/metrics', (c) => {
    const { projectId } = c.req.query() as Record<string, string>;

    const allTasks = db.select().from(tasks).all();
    const allBlockers = db.select().from(blockers).all();
    const allReqs = db.select().from(requirements).all();

    const filteredTasks = projectId ? allTasks.filter(t => t.projectId === projectId) : allTasks;
    const filteredBlockers = projectId ? allBlockers.filter(b => b.projectId === projectId) : allBlockers;
    const filteredReqs = projectId ? allReqs.filter(r => r.projectId === projectId) : allReqs;

    const completedTasks = filteredTasks.filter(t => t.status === 'completed');
    const openBlockers = filteredBlockers.filter(b => b.state === 'open');
    const bypassedTasks = filteredTasks.filter(t => t.bypassUsed);
    const doneReqs = filteredReqs.filter(r => r.state === 'done');

    const healthPct = filteredReqs.length > 0
      ? Math.round(((doneReqs.length + filteredReqs.filter(r => r.state === 'executing').length) / filteredReqs.length) * 100)
      : 100;

    const resolvedBlockers = filteredBlockers.filter(b => b.state === 'resolved' && b.resolvedAt);
    const avgResolutionMs = resolvedBlockers.length > 0
      ? resolvedBlockers.reduce((sum, b) => {
          const created = new Date(b.createdAt).getTime();
          const resolved = new Date(b.resolvedAt!).getTime();
          return sum + (resolved - created);
        }, 0) / resolvedBlockers.length
      : 0;

    return c.json({
      integrationHealthPct: healthPct,
      taskCompletionRate: filteredTasks.length > 0
        ? Math.round((completedTasks.length / filteredTasks.length) * 100)
        : 0,
      openBlockerCount: openBlockers.length,
      bypassCount: bypassedTasks.length,
      avgResolutionTimeMs: Math.round(avgResolutionMs),
      totalRequirements: filteredReqs.length,
      doneRequirements: doneReqs.length,
      totalTasks: filteredTasks.length,
      completedTasks: completedTasks.length,
    });
  });

  // HARDEN-002: per-pipeline-run cost surface — feeds the dashboard
  // /metrics/cost panel. Returns the requested run when ?correlationId
  // is given, otherwise the most-recent N runs (default 25).
  app.get('/metrics/cost', (c) => {
    const { correlationId, limit } = c.req.query() as Record<string, string>;
    let tracker;
    try {
      tracker = getPipelineCostTracker(db, {
        alertThresholdUsd: parseFloat(
          process.env['CAIA_PIPELINE_COST_ALERT_USD'] ?? '5',
        ),
      });
    } catch {
      return c.json({ runs: [], note: 'cost-tracker not initialised' });
    }
    if (correlationId) {
      const snap = tracker.get(correlationId);
      if (!snap) return c.json({ run: null }, 404);
      return c.json({ run: snap });
    }
    const n = limit ? Math.min(Math.max(parseInt(limit, 10) || 25, 1), 200) : 25;
    return c.json({ runs: tracker.recent(n) });
  });
}
