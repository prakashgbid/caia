/**
 * Single-instance locking via filesystem-level flock-style lockfile.
 * Acquires by atomically creating <lockfilePath>.tmp and renaming. If
 * the rename fails because the file already exists, another instance
 * has the lock.
 *
 * Stale-lock handling: if the lock's recorded pid is dead, we steal it.
 * Otherwise we throw LockfileError.
 */

import * as path from 'node:path';
import { LockfileError } from './types.js';
import type { FsAccess } from './types.js';

export interface LockfileConfig {
  lockfilePath: string;
  fs: FsAccess;
  clock: () => Date;
  /** Real process pid; tests inject a synthetic. */
  getPid?: () => number;
  /** Returns true if the pid is currently alive. Tests inject. */
  isAlive?: (pid: number) => boolean;
}

export interface LockHandle {
  release(): void;
}

interface LockContent {
  pid: number;
  at: string;
}

export function acquireLock(cfg: LockfileConfig): LockHandle {
  const fs = cfg.fs;
  const p = cfg.lockfilePath;
  const dir = path.dirname(p);
  if (!fs.exists(dir)) fs.mkdir(dir);

  const getPid = cfg.getPid ?? (() => process.pid);
  const isAlive =
    cfg.isAlive ??
    ((pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });

  const myPid = getPid();
  const myContent: LockContent = { pid: myPid, at: cfg.clock().toISOString() };

  if (fs.exists(p)) {
    let parsed: LockContent | null;
    try {
      parsed = JSON.parse(fs.readFile(p)) as LockContent;
    } catch {
      // Corrupt lockfile — treat as stale and steal.
      parsed = null;
    }
    if (parsed !== null && parsed.pid !== myPid && isAlive(parsed.pid)) {
      throw new LockfileError(`another retrainer instance is running (pid ${parsed.pid})`, {
        lockfilePath: p,
        heldByPid: parsed.pid
      });
    }
    // Stale or our own — overwrite.
    try {
      fs.unlink(p);
    } catch {
      /* race */
    }
  }

  const tmp = p + '.tmp.' + myPid;
  fs.writeFile(tmp, JSON.stringify(myContent));
  fs.rename(tmp, p);

  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      try {
        if (fs.exists(p)) fs.unlink(p);
      } catch {
        /* best-effort */
      }
    }
  };
}
