import type { Hono } from 'hono';
import { sql, desc } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { tasks, blockers, requirements, spendRecords } from '../../db/schema';

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

  app.get('/metrics/cost', (c) => {
    const windowHRaw = c.req.query('windowH');
    const windowHours = windowHRaw
      ? Math.max(1, Math.min(parseInt(windowHRaw, 10) || 24, 720))
      : 24;
    const sinceMs = Date.now() - windowHours * 3_600_000;

    type AgentRow = { agent_role: string; total_usd: number; call_count: number; input_tokens: number; output_tokens: number };
    type ModelRow = { model: string; total_usd: number; call_count: number };
    type TotalRow = { total_usd: number; call_count: number; input_tokens: number; output_tokens: number };

    const totals = (db.all(
      sql`SELECT COALESCE(SUM(cost_usd),0) AS total_usd, COUNT(*) AS call_count, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens FROM spend_records WHERE ts_ms_epoch >= ${sinceMs}`,
    ) as TotalRow[])[0] ?? { total_usd: 0, call_count: 0, input_tokens: 0, output_tokens: 0 };

    const byAgent = db.all(
      sql`SELECT agent_role, COALESCE(SUM(cost_usd),0) AS total_usd, COUNT(*) AS call_count, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens FROM spend_records WHERE ts_ms_epoch >= ${sinceMs} GROUP BY agent_role ORDER BY total_usd DESC`,
    ) as AgentRow[];

    const byModel = db.all(
      sql`SELECT model, COALESCE(SUM(cost_usd),0) AS total_usd, COUNT(*) AS call_count FROM spend_records WHERE ts_ms_epoch >= ${sinceMs} GROUP BY model ORDER BY total_usd DESC`,
    ) as ModelRow[];

    const recent = db.select({
      taskId: spendRecords.taskId,
      agentRole: spendRecords.agentRole,
      model: spendRecords.model,
      costUsd: spendRecords.costUsd,
      inputTokens: spendRecords.inputTokens,
      outputTokens: spendRecords.outputTokens,
      tsMsEpoch: spendRecords.tsMsEpoch,
    }).from(spendRecords)
      .orderBy(desc(spendRecords.tsMsEpoch))
      .limit(50)
      .all();

    return c.json({
      windowHours,
      totalCostUsd: totals.total_usd,
      totalCalls: Number(totals.call_count),
      totalInputTokens: Number(totals.input_tokens),
      totalOutputTokens: Number(totals.output_tokens),
      byAgent: byAgent.map((r) => ({
        agentRole: r.agent_role,
        costUsd: r.total_usd,
        callCount: Number(r.call_count),
        inputTokens: Number(r.input_tokens),
        outputTokens: Number(r.output_tokens),
      })),
      byModel: byModel.map((r) => ({
        model: r.model,
        costUsd: r.total_usd,
        callCount: Number(r.call_count),
      })),
      recent,
    });
  });
}
