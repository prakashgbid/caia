import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { stories } from '../db/schema';
import { eventBus } from '../events/bus-adapter';

export interface ReaperOptions {
  baseDir?: string;
  repoPath?: string;
  orphanGraceMs?: number;
  fsImpl?: typeof fs;
  execImpl?: typeof spawnSync;
  now?: () => number;
  silent?: boolean;
  gitBin?: string;
}

export interface ReapResult {
  reaped: string[];
  skipped: string[];
  errors: Array<{ storyId: string; error: string }>;
}

const TERMINAL_STATUSES = new Set(['completed']);
const TERMINAL_PHASE2 = new Set(['done', 'escalated']);

/**
 * WorktreeReaper — HARDEN-003.
 *
 * Cleans up on-disk git worktrees that the orchestrator is no longer
 * tracking. Without this, every crashed worker (HARDEN-001) leaves an
 * orphan worktree directory under ~/.caia/worktrees/<storyId>/ that
 * accumulates until the disk fills up.
 *
 * Sweep policy: a worktree directory at <baseDir>/<storyId> is reaped
 * when ANY of:
 *   - the storyId has no row in `stories`
 *   - the story is in a terminal state (status='completed' or
 *     phase2Status in ('done','escalated'))
 *   - the story has assignedWorkerId IS NULL and the directory has
 *     been idle for `orphanGraceMs` (default 10 min)
 *
 * Reap = `git worktree remove --force <path>` from the source repo,
 * with a fs-rm fallback.
 *
 * Security: the reaper refuses to operate outside its configured base
 * directory (path traversal blocked via path.resolve + startsWith).
 *
 * @owner observability (Phase 2 / production hardening)
 */
export class WorktreeReaper {
  private readonly db: Db;
  private readonly baseDir: string;
  private readonly repoPath: string | null;
  private readonly orphanGraceMs: number;
  private readonly fs: typeof fs;
  private readonly exec: typeof spawnSync;
  private readonly now: () => number;
  private readonly silent: boolean;
  private readonly gitBin: string;

  constructor(db: Db, opts: ReaperOptions = {}) {
    this.db = db;
    this.baseDir = path.resolve(
      opts.baseDir ?? path.join(os.homedir(), '.caia', 'worktrees'),
    );
    this.repoPath = opts.repoPath ?? null;
    this.orphanGraceMs = opts.orphanGraceMs ?? 10 * 60 * 1000;
    this.fs = opts.fsImpl ?? fs;
    this.exec = opts.execImpl ?? spawnSync;
    this.now = opts.now ?? Date.now;
    this.silent = opts.silent ?? false;
    this.gitBin = opts.gitBin ?? 'git';
  }

  /**
   * Lists every direct child of baseDir, decides whether to reap, and
   * reports what happened. Safe to run concurrently with worker-coding
   * (a live worker holds an open file inside its worktree, so
   * `git worktree remove` will refuse — those become `errors`).
   */
  sweep(): ReapResult {
    const out: ReapResult = { reaped: [], skipped: [], errors: [] };
    if (!this.fs.existsSync(this.baseDir)) {
      return out;
    }
    const entries = this.fs.readdirSync(this.baseDir, { withFileTypes: true });
    const ts = this.now();
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const storyId = ent.name;
      const wtPath = path.join(this.baseDir, storyId);

      if (!this.isInsideBase(wtPath)) {
        out.skipped.push(storyId);
        continue;
      }

      const decision = this.decide(storyId, wtPath, ts);
      if (decision.kind === 'skip') {
        out.skipped.push(storyId);
        continue;
      }
      try {
        this.reapDirectory(wtPath);
        out.reaped.push(storyId);
        this.emit('worktree.reaped', {
          storyId,
          path: wtPath,
          reason: decision.reason,
          ts,
        });
      } catch (err) {
        out.errors.push({ storyId, error: String(err) });
      }
    }
    return out;
  }

  decide(
    storyId: string,
    wtPath: string,
    ts: number,
  ): { kind: 'reap'; reason: string } | { kind: 'skip' } {
    const row = this.db.select().from(stories).where(eq(stories.id, storyId)).get();
    if (!row) return { kind: 'reap', reason: 'unknown_story' };
    if (TERMINAL_STATUSES.has(row.status ?? '')) {
      return { kind: 'reap', reason: `status_${row.status}` };
    }
    if (row.phase2Status && TERMINAL_PHASE2.has(row.phase2Status)) {
      return { kind: 'reap', reason: `phase2_${row.phase2Status}` };
    }
    if (!row.assignedWorkerId) {
      const stat = this.fs.statSync(wtPath);
      const ageMs = ts - stat.mtimeMs;
      if (ageMs >= this.orphanGraceMs) {
        return { kind: 'reap', reason: 'orphan_unassigned' };
      }
    }
    return { kind: 'skip' };
  }

  private isInsideBase(absPath: string): boolean {
    const resolved = path.resolve(absPath);
    return resolved === this.baseDir || resolved.startsWith(this.baseDir + path.sep);
  }

  private reapDirectory(wtPath: string): void {
    if (this.repoPath) {
      const res = this.exec(
        this.gitBin,
        ['worktree', 'remove', '--force', wtPath],
        { cwd: this.repoPath, encoding: 'utf8' },
      );
      if (res.status === 0) return;
    }
    this.fs.rmSync(wtPath, { recursive: true, force: true });
  }

  private emit(type: string, payload: Record<string, unknown>): void {
    if (this.silent) return;
    eventBus.publish({
      type: type as never,
      actor: 'system',
      entity_type: 'worktree',
      entity_id: payload.storyId as string,
      severity: 'info',
      payload,
    });
  }
}

/**
 * Starts a 5-minute (configurable) sweep loop. Returns a stop()
 * function that clears the interval. The loop is unref'd so it does
 * not hold the event loop open during graceful tear-down.
 */
export function startReaperLoop(
  reaper: WorktreeReaper,
  intervalMs = 5 * 60 * 1000,
): { stop: () => void } {
  const tick = () => {
    try {
      reaper.sweep();
    } catch {
      /* sweep is best-effort observability */
    }
  };
  const handle = setInterval(tick, intervalMs);
  handle.unref?.();
  return { stop: () => clearInterval(handle) };
}
