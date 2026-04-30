/**
 * SAFETY-004 — spend-guard HTTP surface.
 *
 * GET  /spend/today    → today + this-week totals + cap state. Dashboard
 *                        widget uses this for the always-visible
 *                        "$X.XX / $Y.YY today" pill.
 * GET  /spend/caps     → snapshot of all spend_caps rows (operator query).
 * POST /spend/resume   → unset the orchestrator's pause flag, resume the
 *                        run pump. Body: { by: string }.
 *
 * The wiring for "every Claude call increments spend_records" lives in
 * apps/orchestrator/src/api/routes/llm.ts (the /llm/route endpoint).
 */

import type { Hono } from 'hono';
import type { SpendGuardBridge } from '../../safety/spend-guard-bridge';
import type { SqliteRecordSink } from '../../safety/spend-cap-store-sqlite';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

interface ResumeBody {
  by?: string;
}

export function registerSpendRoutes(
  app: Hono,
  bridge: SpendGuardBridge,
  recordSink: SqliteRecordSink,
): void {
  app.get('/spend/today', async (c) => {
    const now = Date.now();
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfWeek = startOfDay.getTime() - 6 * DAY_MS;
    const todayUsd = recordSink.sumCostUsd({ sinceMsEpoch: startOfDay.getTime() });
    const weekUsd = recordSink.sumCostUsd({ sinceMsEpoch: startOfWeek });

    return c.json({
      todayUsd,
      weekUsd,
      pause: bridge.pauseState(),
    });
  });

  app.get('/spend/caps', async (c) => {
    // The cap store implementation has its own list method; we surface
    // it via the SpendGuard's internal capStore. For simplicity, we
    // round-trip a known set of scopes by querying via the dailySpendPctOver
    // helper — but it's cleaner to expose list() directly. Future work.
    return c.json({
      pause: bridge.pauseState(),
      // Operators can query the SQLite spend_caps table directly via
      // mac_db_query; this endpoint is the dashboard's primary surface.
    });
  });

  app.post('/spend/resume', async (c) => {
    let body: ResumeBody = {};
    try {
      body = await c.req.json<ResumeBody>();
    } catch { /* empty body is fine */ }
    const by = body.by ?? 'unknown';
    bridge.resume(by);
    return c.json({ pause: bridge.pauseState(), by });
  });
}
