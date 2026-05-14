import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { atomicWriteJson } from './atomic.js';
import { appendAudit } from './audit.js';
import { isoNow, parseIso } from './time.js';
import {
  ensurePhaseEntry,
  loadState,
  markAutoAdjudicated,
  markFailed,
  type StateContext,
} from './state.js';
import { checkArtifact, classifyStaleLock } from './classify.js';
import type { LockFile, PhaseFailure } from './types.js';

export const HEARTBEAT_GRACE_SEC = 3600; // 60 min

// H-2 (chain-runner-battle-harden phase 3, 2026-05-14). A worker is counted
// as having run "substantively" if any of these are true at staleness-detect
// time:
//   - it fired at least one heartbeat() (hadAnyHeartbeat)
//   - its dispatch log accumulated more than SUBSTANTIVE_LOG_BYTES
//   - the declared artifact landed (worker reached deliverable write)
// Anything less (rate-limit at spawn, /bin/false, immediate crash before
// stdout flush) leaves attempts untouched so a benign re-dispatch isn't
// burned as a retry.
export const SUBSTANTIVE_LOG_BYTES = 1024;

export function hadAnyHeartbeat(lock: LockFile): boolean {
  if (!lock.heartbeat || !lock.started_at) return false;
  return lock.heartbeat !== lock.started_at;
}

function logFileSize(path: string | null | undefined): number {
  if (!path) return 0;
  try {
    if (!existsSync(path)) return 0;
    const st = statSync(path);
    return st.isFile() ? st.size : 0;
  } catch {
    return 0;
  }
}

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
      failure: PhaseFailure;
    }
  | {
      kind: 'auto_adjudicated';
      phaseId: number;
      reason: 'heartbeat';
      ageSec: number;
      failure: PhaseFailure;
    };

export interface CheckLockStalenessOptions {
  /** Optional dispatch log path to sniff for rate-limit / auth / spawn signals. */
  dispatchLogPath?: string | null;
}

function isAutoResolveEnabled(ctx: StateContext): boolean {
  return ctx.spec.chain_config?.auto_resolve_hung_post_success === true;
}

export function checkLockStaleness(
  ctx: StateContext,
  opts: CheckLockStalenessOptions = {},
): StalenessResult {
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

  // H-2 evidence used by both staleness branches to decide whether to
  // increment ps.attempts when we mark the phase failed.
  const hbFired = hadAnyHeartbeat(lock);
  const logBytes = logFileSize(opts.dispatchLogPath ?? null);
  const art = checkArtifact(ctx, lock.phase_id);
  const ranSubstantively =
    hbFired || logBytes > SUBSTANTIVE_LOG_BYTES || art.exists;

  if (ageSec > HEARTBEAT_GRACE_SEC) {
    const failure = classifyStaleLock(ctx, lock, {
      trigger: 'heartbeat',
      hb_age_sec: ageSec,
      run_sec: runSec,
      cap_sec: capSec,
      dispatchLogPath: opts.dispatchLogPath ?? null,
    });
    // D-1 auto-adjudicate: if the classifier observed worker_hung_post_success
    // AND the chain opted in via chain_config.auto_resolve_hung_post_success,
    // and the artifact already validates success_criteria, mark the phase
    // done and emit phase_auto_adjudicated instead of phase_failed.
    if (
      failure.class === 'worker_hung_post_success' &&
      isAutoResolveEnabled(ctx)
    ) {
      const grepOk = art.grep_matched !== false;
      if (art.exists && art.meets_min_bytes && grepOk) {
        markAutoAdjudicated(ctx, String(lock.phase_id), failure, {
          artifact_path: art.path,
          artifact_size_bytes: art.size_bytes,
          grep_matched: art.grep_matched,
          hb_age_sec: Math.floor(ageSec),
        });
        clearLock(ctx);
        appendAudit(ctx.paths.auditFile, 'lock_cleared', {
          phase_id: lock.phase_id,
          reason: 'heartbeat',
          age_sec: Math.floor(ageSec),
          disposition: 'auto_adjudicated',
        });
        return {
          kind: 'auto_adjudicated',
          phaseId: lock.phase_id,
          reason: 'heartbeat',
          ageSec,
          failure,
        };
      }
    }
    markFailed(ctx, String(lock.phase_id), failure, { ranSubstantively });
    clearLock(ctx);
    appendAudit(ctx.paths.auditFile, 'lock_cleared', {
      phase_id: lock.phase_id,
      reason: 'heartbeat',
      age_sec: Math.floor(ageSec),
      class: failure.class,
      ran_substantively: ranSubstantively,
      evidence: {
        hb_fired: hbFired,
        log_bytes: logBytes,
        artifact_exists: art.exists,
      },
    });
    return {
      kind: 'cleared',
      phaseId: lock.phase_id,
      reason: 'heartbeat',
      ageSec,
      failure,
    };
  }
  if (runSec > capSec) {
    const failure = classifyStaleLock(ctx, lock, {
      trigger: 'timeout',
      hb_age_sec: ageSec,
      run_sec: runSec,
      cap_sec: capSec,
      dispatchLogPath: opts.dispatchLogPath ?? null,
    });
    // Runtime cap exceeded implies the worker ran past its budget — treat as
    // substantive regardless of the heuristic-evidence inputs.
    markFailed(ctx, String(lock.phase_id), failure, { ranSubstantively: true });
    clearLock(ctx);
    appendAudit(ctx.paths.auditFile, 'lock_cleared', {
      phase_id: lock.phase_id,
      reason: 'timeout',
      run_sec: Math.floor(runSec),
      cap_sec: capSec,
      class: failure.class,
    });
    return {
      kind: 'cleared',
      phaseId: lock.phase_id,
      reason: 'timeout',
      ageSec: runSec,
      capSec,
      failure,
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
