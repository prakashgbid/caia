import type { Check, CheckResult, PulseContext } from '../types';

const LONG_RUN_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

// @no-events — check result reported via pulse.ts orchestrator
export const longRunningTasks: Check = {
  name: 'long-running-tasks',
  stage: 'pipeline',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${ctx.apiBase}/tasks?status=running&limit=50`, { signal: AbortSignal.timeout(5000) });
      const durationMs = Date.now() - t0;
      if (!res.ok) return { name: this.name, stage: this.stage, passed: true, message: 'Could not verify', durationMs };
      const data = await res.json() as { tasks?: Array<{ started_at?: string; startedAt?: string; id?: string; title?: string }> };
      const running = data.tasks ?? [];
      const now = Date.now();
      const longRunning = running.filter(t => {
        const sa = t.started_at ?? t.startedAt;
        return sa && now - new Date(sa).getTime() > LONG_RUN_THRESHOLD_MS;
      });
      if (longRunning.length === 0) {
        return { name: this.name, stage: this.stage, passed: true, message: `${running.length} running task(s), none >4h`, durationMs };
      }
      const titles = longRunning.slice(0, 2).map(t => t.title?.slice(0, 40) ?? t.id ?? '?').join(', ');
      return { name: this.name, stage: this.stage, passed: false, message: `${longRunning.length} task(s) running >4h: ${titles}`, durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: false, message: `Error: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
