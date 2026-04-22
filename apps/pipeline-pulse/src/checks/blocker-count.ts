import type { Check, CheckResult, PulseContext } from '../types';

const CRITICAL_BLOCKER_THRESHOLD = 3;

// @no-events — check result reported via pulse.ts orchestrator
export const blockerCount: Check = {
  name: 'blocker-count',
  stage: 'pipeline',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      const res = await fetch(`${ctx.apiBase}/blockers?state=open&severity=critical&limit=20`, { signal: AbortSignal.timeout(5000) });
      const durationMs = Date.now() - t0;
      if (!res.ok) return { name: this.name, stage: this.stage, passed: true, message: 'Could not verify', durationMs };
      const data = await res.json() as { blockers?: unknown[]; total?: number };
      const count = data.total ?? data.blockers?.length ?? 0;
      if (count >= CRITICAL_BLOCKER_THRESHOLD) {
        return { name: this.name, stage: this.stage, passed: false, message: `${count} open critical blocker(s) — pipeline may be stuck`, durationMs };
      }
      if (count > 0) {
        return { name: this.name, stage: this.stage, passed: false, message: `${count} open critical blocker(s)`, durationMs };
      }
      return { name: this.name, stage: this.stage, passed: true, message: 'No critical blockers', durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: false, message: `Error: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
