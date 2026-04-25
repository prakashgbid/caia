import type { HealAction, HealResult, PulseContext } from '../types';
import { emitHealEvent } from '../emit';

// @no-events — emitHealEvent handles event emission
export const resetCircuitBreaker: HealAction = {
  name: 'reset-circuit-breaker',
  triggeredByChecks: ['circuit-breaker-open'],
  async run(ctx: PulseContext): Promise<HealResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${ctx.apiBase}/tasks?status=queued&paused=true&limit=50`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks?: Array<{ id?: string; pause_reason?: string; pauseReason?: string }> };
      const tripped = (data.tasks ?? []).filter(t => {
        const reason = t.pause_reason ?? t.pauseReason ?? '';
        return reason.toLowerCase().includes('circuit') || reason.toLowerCase().includes('breaker');
      });
      if (tripped.length === 0) {
        const result: HealResult = { action: this.name, triggeredBy: 'circuit-breaker-open', success: true, idempotent: true, message: 'No circuit-breaker-paused tasks found', durationMs: Date.now() - t0 };
        await emitHealEvent(ctx, this.name, 'circuit-breaker-open', true);
        return result;
      }
      let unpaused = 0;
      for (const task of tripped) {
        if (!task.id) continue;
        try {
          await fetch(`${ctx.apiBase}/executor/tasks/${task.id}/unpause`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(3000),
            body: JSON.stringify({ reset_attempts: true }),
          });
          unpaused++;
        } catch { /* best-effort per task */ }
      }
      const result: HealResult = { action: this.name, triggeredBy: 'circuit-breaker-open', success: unpaused > 0, idempotent: false, message: `Unpaused ${unpaused}/${tripped.length} circuit-breaker-paused task(s)`, durationMs: Date.now() - t0 };
      await emitHealEvent(ctx, this.name, 'circuit-breaker-open', unpaused > 0);
      return result;
    } catch (err) {
      const result: HealResult = { action: this.name, triggeredBy: 'circuit-breaker-open', success: false, idempotent: false, message: `Failed: ${String(err)}`, durationMs: Date.now() - t0 };
      await emitHealEvent(ctx, this.name, 'circuit-breaker-open', false, String(err));
      return result;
    }
  },
};
