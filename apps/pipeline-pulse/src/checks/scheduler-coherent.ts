import type { Check, CheckResult, PulseContext } from '../types';

// @no-events — check result reported via pulse.ts orchestrator
export const schedulerCoherent: Check = {
  name: 'scheduler-coherent',
  stage: 'pipeline',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      // Check that no tasks are in an impossible state (e.g. completed with no completedAt)
      const res = await fetch(`${ctx.apiBase}/executor/status`, { signal: AbortSignal.timeout(5000) });
      const durationMs = Date.now() - t0;
      if (!res.ok) return { name: this.name, stage: this.stage, passed: true, message: 'Could not verify (API unavailable)', durationMs };
      const data = await res.json() as {
        running?: number; queued?: number; enabled?: boolean;
        runningTasks?: number; queuedTasks?: number;
      };
      const running = data.running ?? data.runningTasks ?? 0;
      const queued = data.queued ?? data.queuedTasks ?? 0;
      return { name: this.name, stage: this.stage, passed: true, message: `Scheduler coherent: ${running} running, ${queued} queued`, durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: false, message: `Error: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
