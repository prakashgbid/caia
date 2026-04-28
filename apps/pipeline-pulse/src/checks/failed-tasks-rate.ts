import type { Check, CheckResult, PulseContext } from '../types';

const FAILURE_RATE_WARN = 0.4;  // 40%
const FAILURE_RATE_CRIT = 0.6;  // 60%
const SAMPLE_LIMIT = 50;

// @no-events — check result reported via pulse.ts orchestrator
export const failedTasksRate: Check = {
  name: 'failed-tasks-rate',
  stage: 'executor',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      const [completedRes, failedRes] = await Promise.all([
        fetch(`${ctx.apiBase}/tasks?status=completed&limit=${SAMPLE_LIMIT}`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${ctx.apiBase}/tasks?status=failed&limit=${SAMPLE_LIMIT}`, { signal: AbortSignal.timeout(5000) }),
      ]);
      const durationMs = Date.now() - t0;
      if (!completedRes.ok || !failedRes.ok) {
        return { name: this.name, stage: this.stage, passed: true, message: 'Could not verify (API unavailable)', durationMs };
      }
      const [cd, fd] = await Promise.all([
        completedRes.json() as Promise<{ tasks?: unknown[]; total?: number }>,
        failedRes.json() as Promise<{ tasks?: unknown[]; total?: number }>,
      ]);
      const completedCount = cd.total ?? cd.tasks?.length ?? 0;
      const failedCount = fd.total ?? fd.tasks?.length ?? 0;
      const total = completedCount + failedCount;
      if (total === 0) return { name: this.name, stage: this.stage, passed: true, message: 'No tasks yet', durationMs };
      const rate = failedCount / total;
      if (rate >= FAILURE_RATE_CRIT) {
        return { name: this.name, stage: this.stage, passed: false, message: `Failure rate ${(rate * 100).toFixed(0)}% — critical (${failedCount}/${total})`, durationMs };
      }
      if (rate >= FAILURE_RATE_WARN) {
        return { name: this.name, stage: this.stage, passed: false, message: `Failure rate ${(rate * 100).toFixed(0)}% — degraded (${failedCount}/${total})`, durationMs };
      }
      return { name: this.name, stage: this.stage, passed: true, message: `Failure rate ${(rate * 100).toFixed(0)}% (${failedCount}/${total})`, durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: false, message: `Error: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
