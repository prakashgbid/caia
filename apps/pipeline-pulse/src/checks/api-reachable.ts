import type { Check, CheckResult, PulseContext } from '../types';

// @no-events — check result reported via pulse.ts orchestrator
export const apiReachable: Check = {
  name: 'api-reachable',
  stage: 'infra',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${ctx.apiBase}/health`, { signal: AbortSignal.timeout(4000) });
      const durationMs = Date.now() - t0;
      if (res.ok) {
        return { name: this.name, stage: this.stage, passed: true, message: `API healthy (${durationMs}ms)`, durationMs };
      }
      return { name: this.name, stage: this.stage, passed: false, message: `HTTP ${res.status}`, durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: false, message: `Unreachable: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
