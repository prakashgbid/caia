import type { HealAction, HealResult, PulseContext } from '../types';
import { emitHealEvent } from '../emit';

const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// @no-events — emitHealEvent handles event emission
export const resetStuckTasks: HealAction = {
  name: 'reset-stuck-tasks',
  triggeredByChecks: ['no-stuck-running', 'queue-not-stalled'],
  async run(ctx: PulseContext): Promise<HealResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${ctx.apiBase}/tasks?status=running&limit=50`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks?: Array<{ id?: string; started_at?: string; startedAt?: string }> };
      const tasks = data.tasks ?? [];
      const now = Date.now();
      const stuck = tasks.filter(t => {
        const sa = t.started_at ?? t.startedAt;
        return sa && now - new Date(sa).getTime() > STUCK_THRESHOLD_MS;
      });
      if (stuck.length === 0) {
        const result: HealResult = { action: this.name, triggeredBy: 'no-stuck-running', success: true, idempotent: true, message: 'No stuck running tasks found', durationMs: Date.now() - t0 };
        await emitHealEvent(ctx, this.name, 'no-stuck-running', true);
        return result;
      }
      // Reset stuck tasks back to queued via fail+re-queue
      let reset = 0;
      for (const task of stuck) {
        if (!task.id) continue;
        try {
          await fetch(`${ctx.apiBase}/tasks/${task.id}/fail`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(3000),
            body: JSON.stringify({ reason: 'pulse-heal: reset stuck running task' }),
          });
          reset++;
        } catch { /* best-effort per task */ }
      }
      const result: HealResult = { action: this.name, triggeredBy: 'no-stuck-running', success: reset > 0, idempotent: false, message: `Reset ${reset}/${stuck.length} stuck running task(s)`, durationMs: Date.now() - t0 };
      await emitHealEvent(ctx, this.name, 'no-stuck-running', reset > 0);
      return result;
    } catch (err) {
      const result: HealResult = { action: this.name, triggeredBy: 'no-stuck-running', success: false, idempotent: false, message: `Failed: ${String(err)}`, durationMs: Date.now() - t0 };
      await emitHealEvent(ctx, this.name, 'no-stuck-running', false, String(err));
      return result;
    }
  },
};
