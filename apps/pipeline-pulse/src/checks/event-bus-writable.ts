import type { Check, CheckResult, PulseContext } from '../types';

// @no-events — check result reported via pulse.ts orchestrator
export const eventBusWritable: Check = {
  name: 'event-bus-writable',
  stage: 'pipeline',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${ctx.apiBase}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(4000),
        body: JSON.stringify({
          type: 'system.startup',
          actor: 'system',
          payload: { component: 'pulse.probe', version: '1', message: 'event-bus-writable check' },
          severity: 'debug',
        }),
      });
      const durationMs = Date.now() - t0;
      if (res.ok || res.status === 201) {
        return { name: this.name, stage: this.stage, passed: true, message: `Event bus write OK (${durationMs}ms)`, durationMs };
      }
      return { name: this.name, stage: this.stage, passed: false, message: `Event bus write failed: HTTP ${res.status}`, durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: false, message: `Event bus unreachable: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
