import type { Hono } from 'hono';
import type { Db } from '../../db/connection';
import { tasks, blockers, requirements } from '../../db/schema';

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
}
