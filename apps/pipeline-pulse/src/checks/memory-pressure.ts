import type { Check, CheckResult, PulseContext } from '../types';

const MEM_WARN_BYTES = 1_500_000_000;  // 1.5 GB RSS
const MEM_CRIT_BYTES = 2_000_000_000;  // 2 GB RSS

// @no-events — check result reported via pulse.ts orchestrator
export const memoryPressure: Check = {
  name: 'memory-pressure',
  stage: 'infra',
  async run(_ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    const { rss, heapUsed } = process.memoryUsage();
    const durationMs = Date.now() - t0;
    const mb = (rss / 1_048_576).toFixed(0);
    if (rss >= MEM_CRIT_BYTES) {
      return { name: this.name, stage: this.stage, passed: false, message: `RSS ${mb} MB — critical (limit 2 GB)`, durationMs };
    }
    if (rss >= MEM_WARN_BYTES) {
      return { name: this.name, stage: this.stage, passed: false, message: `RSS ${mb} MB — warning`, durationMs };
    }
    return {
      name: this.name, stage: this.stage, passed: true,
      message: `RSS ${mb} MB, heap ${(heapUsed / 1_048_576).toFixed(0)} MB`, durationMs,
    };
  },
};
