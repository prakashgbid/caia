import type { Hono } from 'hono';
import { getSqliteRaw } from '../../db/connection';

export interface PlatformStats {
  totalPrompts: number;
  activeTasks: number;
  blockedTasks: number;
  completedToday: number;
  avgTaskDurationMs: number;
  queueDepth: number;
  lastUpdated: number;
}

// @no-events
export function registerStatsRoutes(app: Hono): void {
  app.get('/platform-stats', (c) => {
    try {
      const sqlite = getSqliteRaw();

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayIso = todayStart.toISOString();

      const totalPrompts = (sqlite.prepare('SELECT COUNT(*) as count FROM prompts').get() as { count: number }).count;
      const activeTasks = (sqlite.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'running'").get() as { count: number }).count;
      const blockedTasks = (sqlite.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'blocked'").get() as { count: number }).count;
      const completedToday = (sqlite.prepare(
        "SELECT COUNT(*) as count FROM tasks WHERE status = 'done' AND completed_at >= ?"
      ).get(todayIso) as { count: number }).count;
      const queueDepth = (sqlite.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'queued'").get() as { count: number }).count;

      const avgRow = sqlite.prepare(
        "SELECT AVG((julianday(ended_at) - julianday(started_at)) * 86400000) as avg_ms FROM task_runs WHERE ended_at IS NOT NULL AND started_at IS NOT NULL"
      ).get() as { avg_ms: number | null };
      const avgTaskDurationMs = Math.round(avgRow?.avg_ms ?? 0);

      const stats: PlatformStats = {
        totalPrompts,
        activeTasks,
        blockedTasks,
        completedToday,
        avgTaskDurationMs,
        queueDepth,
        lastUpdated: Date.now(),
      };

      return c.json(stats);
    } catch {
      return c.json({
        totalPrompts: 0,
        activeTasks: 0,
        blockedTasks: 0,
        completedToday: 0,
        avgTaskDurationMs: 0,
        queueDepth: 0,
        lastUpdated: Date.now(),
      } satisfies PlatformStats);
    }
  });
}
