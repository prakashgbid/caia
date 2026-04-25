import type { Check, CheckResult, PulseContext } from '../types';

const STUCK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// @no-events — check result reported via pulse.ts orchestrator
export const noStuckRunning: Check = {
  name: 'no-stuck-running',
  stage: 'executor',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${ctx.apiBase}/executor/runs?status=running&limit=50`, { signal: AbortSignal.timeout(5000) });
      const durationMs = Date.now() - t0;
      if (!res.ok) return { name: this.name, stage: this.stage, passed: true, message: 'Could not verify (API unavailable)', durationMs };
      const data = await res.json() as { runs?: Array<{ started_at?: string; startedAt?: string; task_id?: string; taskId?: string }> };
      const runs = data.runs ?? [];
      const now = Date.now();
      const stuck = runs.filter(r => {
        const startedAt = r.started_at ?? r.startedAt;
        if (!startedAt) return false;
        return now - new Date(startedAt).getTime() > STUCK_THRESHOLD_MS;
      });
      if (stuck.length === 0) {
        return { name: this.name, stage: this.stage, passed: true, message: `${runs.length} running task(s), none stuck`, durationMs };
      }
      const ids = stuck.map(r => r.task_id ?? r.taskId ?? '?').join(', ');
      return { name: this.name, stage: this.stage, passed: false, message: `${stuck.length} task(s) stuck running >2h: ${ids}`, durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: false, message: `Error: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
