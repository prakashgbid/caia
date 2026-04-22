import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Check, CheckResult, PulseContext } from '../types';

const DB_SIZE_WARN_BYTES = 1_500_000_000; // 1.5 GB
const DB_SIZE_CRIT_BYTES = 2_000_000_000; // 2 GB

// @no-events — check result reported via pulse.ts orchestrator
export const dbSize: Check = {
  name: 'db-size',
  stage: 'infra',
  async run(ctx: PulseContext): Promise<CheckResult> {
    const t0 = Date.now();
    const dbPath = ctx.dbUrl ?? path.join(os.homedir(), '.conductor', 'db.sqlite');
    try {
      const stat = fs.statSync(dbPath);
      const durationMs = Date.now() - t0;
      const mb = (stat.size / 1_048_576).toFixed(1);
      if (stat.size >= DB_SIZE_CRIT_BYTES) {
        return { name: this.name, stage: this.stage, passed: false, message: `DB size critical: ${mb} MB (limit 2 GB)`, durationMs };
      }
      if (stat.size >= DB_SIZE_WARN_BYTES) {
        return { name: this.name, stage: this.stage, passed: false, message: `DB size warning: ${mb} MB (approaching 2 GB limit)`, durationMs };
      }
      return { name: this.name, stage: this.stage, passed: true, message: `DB size: ${mb} MB`, durationMs };
    } catch {
      // DB file not found — could be fresh install, treat as passing (no runMigrations yet)
      return { name: this.name, stage: this.stage, passed: true, message: 'DB file not found (fresh install)', durationMs: Date.now() - t0 };
    }
  },
};
