import type { Check, CheckResult, PulseContext } from '../types';

// @no-events — check result reported via pulse.ts orchestrator
export const circuitBreakerOpen: Check = {
  name: 'circuit-breaker-open',
  stage: 'executor',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${ctx.apiBase}/tasks?status=queued&paused=true&limit=50`, { signal: AbortSignal.timeout(5000) });
      const durationMs = Date.now() - t0;
      if (!res.ok) return { name: this.name, stage: this.stage, passed: true, message: 'Could not verify', durationMs };
      const data = await res.json() as { tasks?: Array<{ id?: string; pause_reason?: string; pauseReason?: string }> };
      const tripped = (data.tasks ?? []).filter(t => {
        const reason = t.pause_reason ?? t.pauseReason ?? '';
        return reason.toLowerCase().includes('circuit') || reason.toLowerCase().includes('breaker');
      });
      if (tripped.length === 0) {
        return { name: this.name, stage: this.stage, passed: true, message: 'No circuit-breaker trips', durationMs };
      }
      const ids = tripped.slice(0, 3).map(t => t.id ?? '?').join(', ');
      return { name: this.name, stage: this.stage, passed: false, message: `${tripped.length} task(s) paused by circuit breaker: ${ids}`, durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: false, message: `Error: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
