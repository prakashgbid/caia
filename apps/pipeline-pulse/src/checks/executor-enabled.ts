import type { Check, CheckResult, PulseContext } from '../types';

// @no-events — check result reported via pulse.ts orchestrator
export const executorEnabled: Check = {
  name: 'executor-enabled',
  stage: 'executor',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${ctx.apiBase}/executor/config`, { signal: AbortSignal.timeout(4000) });
      const durationMs = Date.now() - t0;
      if (!res.ok) return { name: this.name, stage: this.stage, passed: false, message: `HTTP ${res.status}`, durationMs };
      const data = await res.json() as { enabled?: boolean; config?: { enabled?: boolean } };
      const enabled = data.enabled ?? data.config?.enabled ?? false;
      if (enabled) return { name: this.name, stage: this.stage, passed: true, message: 'Executor is enabled', durationMs };
      return { name: this.name, stage: this.stage, passed: false, message: 'Executor is disabled — run `conductor exec start`', durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: false, message: `Could not read config: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
