import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { atomicWriteJson } from './atomic.js';
import { appendAudit } from './audit.js';
import { isoNow, parseIso } from './time.js';
import {
  ensurePhaseEntry,
  loadState,
  markFailed,
  type StateContext,
} from './state.js';
import type { LockFile } from './types.js';

export const HEARTBEAT_GRACE_SEC = 3600; // 60 min

export function loadLock(ctx: StateContext): LockFile | null {
  if (!existsSync(ctx.paths.lockFile)) return null;
  try {
    return JSON.parse(readFileSync(ctx.paths.lockFile, 'utf8')) as LockFile;
  } catch {
    return null;
  }
}

export function saveLock(ctx: StateContext, lock: LockFile): void {
  atomicWriteJson(ctx.paths.lockFile, lock);
}

export function clearLock(ctx: StateContext): void {
  if (existsSync(ctx.paths.lockFile)) {
    unlinkSync(ctx.paths.lockFile);
  }
}

export function acquireLock(
  ctx: StateContext,
  phaseId: number,
  sessionId: string,
): void {
  saveLock(ctx, {
    phase_id: phaseId,
    session_id: sessionId,
    started_at: isoNow(),
    heartbeat: isoNow(),
  });
}

export type HeartbeatResult =
  | { kind: 'ok' }
  | { kind: 'no_lock' }
  | { kind: 'owned_by_other'; ownerSession: string };

export function heartbeat(
  ctx: StateContext,
  sessionId: string,
): HeartbeatResult {
  const lock = loadLock(ctx);
  if (!lock) return { kind: 'no_lock' };
  if (lock.session_id !== sessionId) {
    return { kind: 'owned_by_other', ownerSession: lock.session_id };
  }
  lock.heartbeat = isoNow();
  saveLock(ctx, lock);
  return { kind: 'ok' };
}

export type StalenessResult =
  | { kind: 'no_lock' }
  | {
      kind: 'live';
      phaseId: number;
      hbAgeSec: number;
      runSec: number;
      capSec: number;
    }
  | {
      kind: 'cleared';
      phaseId: number;
      reason: 'heartbeat' | 'timeout';
      ageSec: number;
      capSec?: number;
    };

export function checkLockStaleness(ctx: StateContext): StalenessResult {
  const lock = loadLock(ctx);
  if (!lock) return { kind: 'no_lock' };

  const state = loadState(ctx);
  const ps = ensurePhaseEntry(state, String(lock.phase_id));
  const started = parseIso(lock.started_at);
  const hb = parseIso(lock.heartbeat ?? lock.started_at);
  const now = new Date();
  const ageSec = (now.getTime() - hb.getTime()) / 1000;
  const runSec = (now.getTime() - started.getTime()) / 1000;
  const capSec = (ps.max_minutes ?? 45) * 60;

  if (ageSec > HEARTBEAT_GRACE_SEC) {
    markFailed(
      ctx,
      String(lock.phase_id),
      `stale_lock heartbeat_age_sec=${Math.floor(ageSec)}`,
    );
    clearLock(ctx);
    appendAudit(ctx.paths.auditFile, 'lock_cleared', {
      phase_id: lock.phase_id,
      reason: 'heartbeat',
      age_sec: Math.floor(ageSec),
    });
    return {
      kind: 'cleared',
      phaseId: lock.phase_id,
      reason: 'heartbeat',
      ageSec,
    };
  }
  if (runSec > capSec) {
    markFailed(
      ctx,
      String(lock.phase_id),
      `runtime_exceeded run_sec=${Math.floor(runSec)} cap_sec=${capSec}`,
    );
    clearLock(ctx);
    appendAudit(ctx.paths.auditFile, 'lock_cleared', {
      phase_id: lock.phase_id,
      reason: 'timeout',
      run_sec: Math.floor(runSec),
      cap_sec: capSec,
    });
    return {
      kind: 'cleared',
      phaseId: lock.phase_id,
      reason: 'timeout',
      ageSec: runSec,
      capSec,
    };
  }
  return {
    kind: 'live',
    phaseId: lock.phase_id,
    hbAgeSec: ageSec,
    runSec,
    capSec,
  };
}
