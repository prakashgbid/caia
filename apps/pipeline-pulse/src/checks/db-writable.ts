import type { Check, CheckResult, PulseContext } from '../types';

// @no-events — check result reported via pulse.ts orchestrator
export const dbWritable: Check = {
  name: 'db-writable',
  stage: 'infra',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      // Probe via the events endpoint — a write+read that exercises the DB
      const res = await fetch(`${ctx.apiBase}/events?limit=1`, { signal: AbortSignal.timeout(4000) });
      const durationMs = Date.now() - t0;
      if (res.ok) {
        return { name: this.name, stage: this.stage, passed: true, message: `DB responding (${durationMs}ms)`, durationMs };
      }
      return { name: this.name, stage: this.stage, passed: false, message: `Events endpoint HTTP ${res.status}`, durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: false, message: `DB unreachable: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
