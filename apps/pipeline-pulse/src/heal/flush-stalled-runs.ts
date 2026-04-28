import type { HealAction, HealResult, PulseContext } from '../types';
import { emitHealEvent } from '../emit';

const STALE_RUN_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// @no-events — emitHealEvent handles event emission
export const flushStalledRuns: HealAction = {
  name: 'flush-stalled-runs',
  triggeredByChecks: ['no-stuck-running'],
  async run(ctx: PulseContext): Promise<HealResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${ctx.apiBase}/executor/runs?status=running&limit=50`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { runs?: Array<{ id?: string; started_at?: string; startedAt?: string; task_id?: string; taskId?: string }> };
      const runs = data.runs ?? [];
      const now = Date.now();
      const stale = runs.filter(r => {
        const sa = r.started_at ?? r.startedAt;
        return sa && now - new Date(sa).getTime() > STALE_RUN_THRESHOLD_MS;
      });
      if (stale.length === 0) {
        const result: HealResult = { action: this.name, triggeredBy: 'no-stuck-running', success: true, idempotent: true, message: 'No stale executor runs found', durationMs: Date.now() - t0 };
        await emitHealEvent(ctx, this.name, 'no-stuck-running', true);
        return result;
      }
      let flushed = 0;
      for (const run of stale) {
        if (!run.id) continue;
        try {
          await fetch(`${ctx.apiBase}/executor/runs/${run.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(3000),
            body: JSON.stringify({ status: 'failed', failure_reason: 'pulse-heal: stale run flushed', ended_at: new Date().toISOString() }),
          });
          flushed++;
        } catch { /* best-effort */ }
      }
      const result: HealResult = { action: this.name, triggeredBy: 'no-stuck-running', success: flushed > 0, idempotent: false, message: `Flushed ${flushed}/${stale.length} stale executor run(s)`, durationMs: Date.now() - t0 };
      await emitHealEvent(ctx, this.name, 'no-stuck-running', flushed > 0);
      return result;
    } catch (err) {
      const result: HealResult = { action: this.name, triggeredBy: 'no-stuck-running', success: false, idempotent: false, message: `Failed: ${String(err)}`, durationMs: Date.now() - t0 };
      await emitHealEvent(ctx, this.name, 'no-stuck-running', false, String(err));
      return result;
    }
  },
};
