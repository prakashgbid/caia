import type { Check, CheckResult, PulseContext } from '../types';

const STALL_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// @no-events — check result reported via pulse.ts orchestrator
export const queueNotStalled: Check = {
  name: 'queue-not-stalled',
  stage: 'pipeline',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      const [queuedRes, runningRes] = await Promise.all([
        fetch(`${ctx.apiBase}/tasks?status=queued&limit=50`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${ctx.apiBase}/tasks?status=running&limit=5`, { signal: AbortSignal.timeout(5000) }),
      ]);
      const durationMs = Date.now() - t0;
      if (!queuedRes.ok) return { name: this.name, stage: this.stage, passed: true, message: 'Could not verify', durationMs };
      const [qd, rd] = await Promise.all([
        queuedRes.json() as Promise<{ tasks?: Array<{ created_at?: string; createdAt?: string; id?: string }> }>,
        runningRes.json() as Promise<{ tasks?: unknown[] }>,
      ]);
      const queued = qd.tasks ?? [];
      const running = rd.tasks ?? [];
      // If there are running tasks, the queue is not stalled
      if (running.length > 0) {
        return { name: this.name, stage: this.stage, passed: true, message: `${queued.length} queued, ${running.length} running`, durationMs };
      }
      // Check if queued tasks have been waiting too long with no running tasks
      const now = Date.now();
      const oldQueued = queued.filter(t => {
        const ca = t.created_at ?? t.createdAt;
        return ca && now - new Date(ca).getTime() > STALL_THRESHOLD_MS;
      });
      if (oldQueued.length > 0) {
        return { name: this.name, stage: this.stage, passed: false, message: `${oldQueued.length} task(s) queued >30min with no running tasks — executor may be down`, durationMs };
      }
      return { name: this.name, stage: this.stage, passed: true, message: `${queued.length} queued, 0 running (recent tasks)`, durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: false, message: `Error: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
