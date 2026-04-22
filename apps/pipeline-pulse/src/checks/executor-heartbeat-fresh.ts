import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Check, CheckResult, PulseContext } from '../types';

const STALE_THRESHOLD_MS = 90_000; // 90 seconds

// @no-events — check result reported via pulse.ts orchestrator
export const executorHeartbeatFresh: Check = {
  name: 'executor-heartbeat-fresh',
  stage: 'executor',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    const heartbeatPath = path.join(ctx.conductorDir, 'executor.heartbeat');
    try {
      const raw = fs.readFileSync(heartbeatPath, 'utf-8');
      const hb = JSON.parse(raw) as { at?: string; pid?: number };
      const at = hb.at ? new Date(hb.at).getTime() : 0;
      const ageMs = Date.now() - at;
      const durationMs = Date.now() - t0;
      if (ageMs <= STALE_THRESHOLD_MS) {
        return { name: this.name, stage: this.stage, passed: true, message: `Heartbeat ${(ageMs / 1000).toFixed(0)}s ago (pid ${hb.pid ?? '?'})`, durationMs };
      }
      return { name: this.name, stage: this.stage, passed: false, message: `Heartbeat stale: ${(ageMs / 1000).toFixed(0)}s ago (threshold ${STALE_THRESHOLD_MS / 1000}s)`, durationMs };
    } catch {
      return { name: this.name, stage: this.stage, passed: false, message: 'No heartbeat file — executor daemon may not be running', durationMs: Date.now() - t0 };
    }
  },
};
