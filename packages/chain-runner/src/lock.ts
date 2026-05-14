import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
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

// H-11 (chain-runner-battle-harden phase 8, 2026-05-14). Legacy fallback used
// when a PhaseState predates the per-phase `heartbeat_grace_sec` field (i.e.
// an older state.json loaded after upgrade). New state files resolve the
// effective grace at buildInitialState — phase override → chain default →
// DEFAULT_HEARTBEAT_GRACE_SEC (1800s). The CLI `state` command also reads
// this constant for the at-a-glance "stale" marker on the lock summary line.
export const HEARTBEAT_GRACE_SEC = 1800; // 30 min

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

// H-24 (chain-runner-battle-harden phase 11, 2026-05-14). Lock corruption
// detection: every saved lock carries a sha256 of its canonical-JSON encoding.
// loadLock verifies the digest on read; a mismatch backs the corrupt file up
// to .lock-backups/lock.<isoNow>.json.corrupt and returns null (treated as
// no lock — the next dispatch acquires fresh). Last 20 backups retained.
const LOCK_BACKUP_DIR = '.lock-backups';
const LOCK_BACKUP_RETENTION = 20;

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Object.getPrototypeOf(v) === Object.prototype
    ) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        sorted[k] = (v as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return v;
  });
}

function lockChecksum(lock: Omit<LockFile, 'checksum'>): string {
  return createHash('sha256').update(canonicalJson(lock)).digest('hex');
}

function lockBackupsDir(ctx: StateContext): string {
  return join(ctx.paths.baseDir, LOCK_BACKUP_DIR);
}

function pruneLockBackups(dir: string): void {
  if (!existsSync(dir)) return;
  let entries: { name: string; mtimeMs: number }[];
  try {
    entries = readdirSync(dir)
      .filter((n) => n.startsWith('lock.'))
      .map((n) => {
        try {
          const st = statSync(join(dir, n));
          return { name: n, mtimeMs: st.mtimeMs };
        } catch {
          return { name: n, mtimeMs: 0 };
        }
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
  } catch {
    return;
  }
  const excess = entries.length - LOCK_BACKUP_RETENTION;
  if (excess <= 0) return;
  for (const ent of entries.slice(0, excess)) {
    try {
      unlinkSync(join(dir, ent.name));
    } catch {
      // ignore
    }
  }
}

function backupCorruptLock(ctx: StateContext, raw: string, reason: string): string {
  const dir = lockBackupsDir(ctx);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return '';
  }
  const stamp = isoNow().replace(/:/g, '-');
  const path = join(dir, `lock.${stamp}.${reason}.json.corrupt`);
  try {
    // writeFileSync is fine — corrupt-lock dumps are flat strings, no
    // canonical-JSON treatment needed.
    writeFileSync(path, raw);
  } catch {
    return '';
  }
  pruneLockBackups(dir);
  return path;
}

export function loadLock(ctx: StateContext): LockFile | null {
  if (!existsSync(ctx.paths.lockFile)) return null;
  let raw: string;
  try {
    raw = readFileSync(ctx.paths.lockFile, 'utf8');
  } catch {
    return null;
  }
  let parsed: LockFile;
  try {
    parsed = JSON.parse(raw) as LockFile;
  } catch {
    // Unparseable JSON → back the file up and report no-lock so the next
    // wake's acquire path can install a fresh lock without operator help.
    const backup = backupCorruptLock(ctx, raw, 'unparseable');
    appendAudit(ctx.paths.auditFile, 'lock_corrupt_detected', {
      reason: 'unparseable_json',
      backup,
    });
    return null;
  }
  // H-24 checksum verification. Locks written by pre-H-24 binaries omit the
  // field — skip the check and accept the lock for back-compat.
  if (typeof parsed.checksum === 'string') {
    const { checksum, ...rest } = parsed;
    const expected = lockChecksum(rest);
    if (expected !== checksum) {
      const backup = backupCorruptLock(ctx, raw, 'checksum_mismatch');
      appendAudit(ctx.paths.auditFile, 'lock_corrupt_detected', {
        reason: 'checksum_mismatch',
        expected,
        found: checksum,
        backup,
      });
      return null;
    }
  }
  return parsed;
}

export function saveLock(ctx: StateContext, lock: LockFile): void {
  // H-24: stamp a checksum derived from the lock body (sans checksum) so a
  // later loadLock can detect tampering / truncation.
  const { checksum: _ignore, ...rest } = lock;
  void _ignore;
  const withSum: LockFile = { ...rest, checksum: lockChecksum(rest) };
  atomicWriteJson(ctx.paths.lockFile, withSum);
}

// H-23 (chain-runner-battle-harden phase 11, 2026-05-14). Lock ownership
// token check. Pre-H-23 clearLock unlinked the lockfile unconditionally — a
// stale call from one session could blow away a fresh lock owned by a
// different worker. Now the caller MUST pass the sessionId it expects to
// own; mismatch refuses (returns 'mismatch') unless `force: true` is set
// (operator-grade override). The lock-staleness recovery path passes the
// lock's own session id; the cli mark-done / mark-failed verbs read the
// lock first then pass that session id.
export interface ClearLockOptions {
  /** When true, unlink the lock regardless of ownership (operator override). */
  force?: boolean;
}

export type ClearLockResult =
  | { kind: 'cleared' }
  | { kind: 'no_lock' }
  | { kind: 'mismatch'; ownerSession: string };

export function clearLock(
  ctx: StateContext,
  sessionId?: string | null,
  opts: ClearLockOptions = {},
): ClearLockResult {
  if (!existsSync(ctx.paths.lockFile)) return { kind: 'no_lock' };
  if (!opts.force && sessionId !== undefined && sessionId !== null) {
    const lock = loadLock(ctx);
    if (lock && lock.session_id !== sessionId) {
      appendAudit(ctx.paths.auditFile, 'lock_clear_refused', {
        reason: 'session_mismatch',
        owner_session: lock.session_id,
        requested_session: sessionId,
      });
      return { kind: 'mismatch', ownerSession: lock.session_id };
    }
  }
  unlinkSync(ctx.paths.lockFile);
  return { kind: 'cleared' };
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
    }
  | {
      kind: 'sleep_wake_deferred';
      phaseId: number;
      hbAgeSec: number;
      lastWakeAgeSec: number;
    };

// H-25 (chain-runner-battle-harden phase 11, 2026-05-14). Sleep/wake awareness.
// When the laptop suspends, lock.heartbeat freezes for the suspended duration
// while the launchd cron also doesn't tick. On resume, the very first wake
// observes a stale-looking lock — but the lock owner may still be live, just
// frozen. Heuristic: if hb_age > LOCK_AGE_SUSPECT_SEC AND
// (now - state.last_wake) < WAKE_RECENT_SEC, treat the wake as the first
// post-suspend tick and skip stale-clear. The next wake (15 min later)
// re-evaluates with a recent heartbeat baseline.
export const SLEEP_WAKE_LOCK_AGE_SUSPECT_SEC = 3600; // 1h
export const SLEEP_WAKE_LAST_WAKE_RECENT_SEC = 1800; // 30 min

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

  // H-11 (phase 8, 2026-05-14). Per-phase grace lives on PhaseState; fall
  // back to the exported constant only when the state file predates the
  // field (older chain dirs loaded after upgrade).
  const graceSec = ps.heartbeat_grace_sec ?? HEARTBEAT_GRACE_SEC;

  // H-25 (chain-runner-battle-harden phase 11, 2026-05-14). Sleep/wake
  // detection. If the lock looks stale BUT state.last_wake fired more
  // recently than SLEEP_WAKE_LAST_WAKE_RECENT_SEC, the wallclock probably
  // suspended (laptop sleep) — defer the stale-clear to the next wake so
  // a freshly-resumed worker has one cycle to refresh its heartbeat.
  // Audited as `sleep_wake_detected`. The next wake re-evaluates with the
  // updated baseline; a still-stuck worker will then be cleared cleanly.
  if (ageSec > SLEEP_WAKE_LOCK_AGE_SUSPECT_SEC) {
    const lastWake = state.last_wake ? parseIso(state.last_wake) : null;
    if (lastWake) {
      const lastWakeAgeSec =
        (now.getTime() - lastWake.getTime()) / 1000;
      if (lastWakeAgeSec < SLEEP_WAKE_LAST_WAKE_RECENT_SEC) {
        appendAudit(ctx.paths.auditFile, 'sleep_wake_detected', {
          phase_id: lock.phase_id,
          hb_age_sec: Math.floor(ageSec),
          last_wake_age_sec: Math.floor(lastWakeAgeSec),
          deferred: true,
        });
        return {
          kind: 'sleep_wake_deferred',
          phaseId: lock.phase_id,
          hbAgeSec: ageSec,
          lastWakeAgeSec,
        };
      }
    }
  }

  if (ageSec > graceSec) {
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
        clearLock(ctx, lock.session_id);
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
    clearLock(ctx, lock.session_id);
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
    clearLock(ctx, lock.session_id);
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
