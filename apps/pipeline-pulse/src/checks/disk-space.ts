import * as child_process from 'child_process';
import * as os from 'os';
import type { Check, CheckResult, PulseContext } from '../types';

const DISK_WARN_PCT = 85;
const DISK_CRIT_PCT = 95;

// @no-events — check result reported via pulse.ts orchestrator
export const diskSpace: Check = {
  name: 'disk-space',
  stage: 'infra',
  async run(_ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    try {
      const home = os.homedir();
      const out = child_process.execSync(`df -P "${home}" 2>/dev/null | tail -1`, { timeout: 3000 }).toString().trim();
      const parts = out.split(/\s+/);
      const usePctStr = parts[4]; // e.g. "72%"
      if (!usePctStr) throw new Error('Could not parse df output');
      const usePct = parseInt(usePctStr.replace('%', ''), 10);
      const durationMs = Date.now() - t0;
      if (usePct >= DISK_CRIT_PCT) {
        return { name: this.name, stage: this.stage, passed: false, message: `Disk ${usePct}% full — critical`, durationMs };
      }
      if (usePct >= DISK_WARN_PCT) {
        return { name: this.name, stage: this.stage, passed: false, message: `Disk ${usePct}% full — warning`, durationMs };
      }
      return { name: this.name, stage: this.stage, passed: true, message: `Disk ${usePct}% full`, durationMs };
    } catch (err) {
      return { name: this.name, stage: this.stage, passed: true, message: `Disk check skipped: ${String(err)}`, durationMs: Date.now() - t0 };
    }
  },
};
