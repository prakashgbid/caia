import type { HealAction, HealResult, PulseContext } from '../types';
import { emitHealEvent } from '../emit';

// @no-events — emitHealEvent handles event emission
export const restartExecutor: HealAction = {
  name: 'restart-executor',
  triggeredByChecks: ['executor-heartbeat-fresh', 'executor-enabled'],
  async run(ctx: PulseContext): Promise<HealResult> {
    const t0 = Date.now();
    try {
      // Check current state first (idempotency)
      const cfgRes = await fetch(`${ctx.apiBase}/executor/config`, { signal: AbortSignal.timeout(4000) });
      if (cfgRes.ok) {
        const cfg = await cfgRes.json() as { enabled?: boolean };
        if (cfg.enabled === false) {
          // Re-enable
          await fetch(`${ctx.apiBase}/executor/resume`, { method: 'POST', signal: AbortSignal.timeout(4000) });
          const result: HealResult = { action: this.name, triggeredBy: 'executor-heartbeat-fresh', success: true, idempotent: false, message: 'Executor re-enabled via resume endpoint', durationMs: Date.now() - t0 };
          await emitHealEvent(ctx, this.name, 'executor-heartbeat-fresh', true);
          return result;
        }
        // Already enabled — try start endpoint to ensure daemon loop is running
        await fetch(`${ctx.apiBase}/executor/start`, { method: 'POST', signal: AbortSignal.timeout(4000) }).catch(() => {});
        const result: HealResult = { action: this.name, triggeredBy: 'executor-heartbeat-fresh', success: true, idempotent: true, message: 'Executor already enabled, start signal sent', durationMs: Date.now() - t0 };
        await emitHealEvent(ctx, this.name, 'executor-heartbeat-fresh', true);
        return result;
      }
      throw new Error(`Config endpoint returned HTTP ${cfgRes.status}`);
    } catch (err) {
      const result: HealResult = { action: this.name, triggeredBy: 'executor-heartbeat-fresh', success: false, idempotent: false, message: `Failed: ${String(err)}`, durationMs: Date.now() - t0 };
      await emitHealEvent(ctx, this.name, 'executor-heartbeat-fresh', false, String(err));
      return result;
    }
  },
};
