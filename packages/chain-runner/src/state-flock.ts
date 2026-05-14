// H-22 (chain-runner-battle-harden phase 11, 2026-05-14). File-lock wrapper
// for state.json read-modify-write paths. Pre-H-22 every mutation went through
// atomicWriteJson — atomic at the rename boundary, but two concurrent
// load+modify+save sequences can still trample each other (last-writer-wins).
// H-22 funnels mutations through `withStateFlock` which serializes them via
// an O_EXCL sidecar lockfile (`state.json.flock`).
//
// Feature-flag: opt-in via env `CAIA_STATE_FLOCK=1`. Per the hardening plan's
// risk register the flock ships off-by-default and gets smoke-tested before
// being made the default in phase 12. When the env var is unset, withStateFlock
// just runs the closure directly so behavior is unchanged.
//
// Stale-lock recovery: each waiter records pid+iso in the sidecar JSON. If the
// holder PID is no longer alive the next waiter steals the lock (logged via
// the audit hook the caller passes). Bounded retry budget keeps us from
// spinning forever if a real deadlock occurs — caller decides what to do
// when the budget is exhausted.

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, basename, join } from 'node:path';

const FLOCK_SUFFIX = '.flock';
export const DEFAULT_RETRY_MS = 50;
export const DEFAULT_MAX_WAIT_MS = 5000;
export const ENV_FLAG = 'CAIA_STATE_FLOCK';

export interface FlockHolder {
  pid: number;
  iso: string;
  /**
   * Free-form tag identifying the operation holding the lock — useful in
   * audit logs when we have to steal a stale lock. Defaults to 'unknown'.
   */
  tag?: string;
}

export interface WithStateFlockOptions {
  /** Polling interval (ms). Default 50ms. */
  retryMs?: number;
  /** Total wait budget (ms) before giving up. Default 5000ms. */
  maxWaitMs?: number;
  /**
   * Force-enable the flock even when the env flag is unset. Used by tests
   * that want to exercise the serialization path deterministically.
   */
  force?: boolean;
  /**
   * Tag identifying the caller — recorded in the sidecar JSON so a stolen
   * lock leaves an audit trail of WHO was holding it.
   */
  tag?: string;
  /**
   * Hook invoked when the wrapper steals a stale lock from a dead holder.
   * Use this to emit a structured audit event from the calling layer.
   */
  onStaleSteal?: (holder: FlockHolder | null, reason: 'pid_dead' | 'budget_exceeded' | 'unparseable') => void;
}

function flockPathFor(stateFile: string): string {
  return join(dirname(stateFile), `${basename(stateFile)}${FLOCK_SUFFIX}`);
}

function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = process exists but we can't signal it
    // (still alive — be conservative). Default to alive on unknown errors so
    // we don't steal a real holder's lock.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    return true;
  }
}

function readHolder(path: string): FlockHolder | null {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<FlockHolder>;
    if (typeof parsed.pid !== 'number' || typeof parsed.iso !== 'string') {
      return null;
    }
    const out: FlockHolder = { pid: parsed.pid, iso: parsed.iso };
    if (typeof parsed.tag === 'string') out.tag = parsed.tag;
    return out;
  } catch {
    return null;
  }
}

function tryAcquire(path: string, holder: FlockHolder): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(path, 'wx');
    writeSync(fd, JSON.stringify(holder));
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return false;
    throw err;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

function releaseLock(path: string): void {
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // ignore — best-effort release; the next acquire will steal-on-stale
  }
}

export function isFlockEnabled(opts: WithStateFlockOptions = {}): boolean {
  if (opts.force) return true;
  const flag = process.env[ENV_FLAG];
  return flag === '1' || flag === 'true';
}

/**
 * Serialize a state.json mutation through a sidecar O_EXCL lockfile.
 * No-op (runs `fn` directly) when the env flag is unset and `force` isn't
 * passed — keeps the path zero-cost for callers that haven't opted in.
 *
 * Throws when the lock cannot be acquired within `maxWaitMs` AND the
 * incumbent holder PID is still alive. Stale holders (dead PID or
 * unparseable JSON) are stolen — the steal is reported via `onStaleSteal`
 * so callers can audit it.
 */
export function withStateFlock<T>(
  stateFile: string,
  fn: () => T,
  opts: WithStateFlockOptions = {},
): T {
  if (!isFlockEnabled(opts)) {
    return fn();
  }
  const path = flockPathFor(stateFile);
  const retryMs = opts.retryMs ?? DEFAULT_RETRY_MS;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const tag = opts.tag ?? 'unknown';
  const holder: FlockHolder = {
    pid: process.pid,
    iso: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    tag,
  };
  const deadline = Date.now() + maxWaitMs;
  while (true) {
    if (tryAcquire(path, holder)) break;
    const incumbent = readHolder(path);
    if (incumbent === null) {
      // Unparseable sidecar — corrupted by a crash mid-write. Steal and
      // report so the operator sees the corruption signal.
      releaseLock(path);
      opts.onStaleSteal?.(null, 'unparseable');
      continue;
    }
    if (!pidAlive(incumbent.pid)) {
      releaseLock(path);
      opts.onStaleSteal?.(incumbent, 'pid_dead');
      continue;
    }
    if (Date.now() >= deadline) {
      // Budget exhausted with a live holder — refuse rather than steal.
      // Caller decides whether to alert / retry.
      throw new Error(
        `state-flock: timed out after ${maxWaitMs}ms waiting for ${path} (held by pid=${incumbent.pid} tag=${incumbent.tag ?? 'unknown'})`,
      );
    }
    // Sleep retryMs synchronously — withStateFlock has a sync API by design
    // (matches loadState/saveState), so we use the deasync-style busy loop
    // shaped helper below. atomicSleep avoids spinning the CPU.
    atomicSleep(retryMs);
  }
  try {
    return fn();
  } finally {
    releaseLock(path);
  }
}

// Synchronous sleep used by the busy-wait loop. We can't use setTimeout +
// await without making the API async; instead we use Atomics.wait on a
// short-lived shared buffer which yields the thread cleanly.
function atomicSleep(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, Math.max(0, ms));
}

export function flockSidecarPath(stateFile: string): string {
  return flockPathFor(stateFile);
}
