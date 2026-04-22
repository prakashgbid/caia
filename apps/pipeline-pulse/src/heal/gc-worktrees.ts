import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import type { HealAction, HealResult, PulseContext } from '../types';
import { emitHealEvent } from '../emit';

// @no-events — emitHealEvent handles event emission
export const gcWorktrees: HealAction = {
  name: 'gc-worktrees',
  triggeredByChecks: ['disk-space'],
  async run(ctx: PulseContext): Promise<HealResult> {
    const t0 = Date.now();
    try {
      const worktreeBaseDir = path.join(ctx.conductorDir, '..', '.claude', 'worktrees');
      const execWorktreeDir = path.join(worktreeBaseDir, '..', '..', '.claude', 'worktrees');

      // Get active worktree paths from executor runs
      const runningRes = await fetch(`${ctx.apiBase}/executor/runs?status=running&limit=50`, { signal: AbortSignal.timeout(5000) });
      const activeWorktrees = new Set<string>();
      if (runningRes.ok) {
        const data = await runningRes.json() as { runs?: Array<{ worktree_path?: string; worktreePath?: string }> };
        for (const run of data.runs ?? []) {
          const wt = run.worktree_path ?? run.worktreePath;
          if (wt) activeWorktrees.add(wt);
        }
      }

      let removed = 0;
      for (const baseDir of [worktreeBaseDir, execWorktreeDir]) {
        if (!fs.existsSync(baseDir)) continue;
        const entries = fs.readdirSync(baseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (!entry.name.startsWith('exec-')) continue;
          const fullPath = path.join(baseDir, entry.name);
          if (activeWorktrees.has(fullPath)) continue;
          try {
            // Use git worktree remove if in a git repo, else plain rmdir
            child_process.execSync(`git worktree remove --force "${fullPath}" 2>/dev/null || rm -rf "${fullPath}"`, { timeout: 10000 });
            removed++;
          } catch { /* best-effort */ }
        }
      }

      const result: HealResult = { action: this.name, triggeredBy: 'disk-space', success: true, idempotent: removed === 0, message: `Removed ${removed} orphaned worktree(s)`, durationMs: Date.now() - t0 };
      await emitHealEvent(ctx, this.name, 'disk-space', true);
      return result;
    } catch (err) {
      const result: HealResult = { action: this.name, triggeredBy: 'disk-space', success: false, idempotent: false, message: `Failed: ${String(err)}`, durationMs: Date.now() - t0 };
      await emitHealEvent(ctx, this.name, 'disk-space', false, String(err));
      return result;
    }
  },
};
