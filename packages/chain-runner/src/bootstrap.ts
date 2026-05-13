// Bootstrap-time safeguards for the chain runner.
//
// Two related concerns live here:
//   1. retryWithBackoff — wraps the MCP create_scheduled_task call (or any
//      flaky external call) with exponential backoff so a transient MCP
//      hiccup during bootstrap doesn't leave the chain with a SKILL.md on
//      disk but no cron registered. Default schedule: 5s, 15s, 45s.
//   2. verifyBootstrap — polls audit.jsonl for a 'wake' event within
//      maxWaitMs; the bootstrap is not declared complete until at least one
//      wake fire has been observed. This catches the disk-vs-registry
//      asymmetry that produced the 2026-05-13 T2.5 cron stall (see RCA).
//
// Both helpers are pure-function-friendly: time / sleep / fs reads are
// injectable so the unit tests run deterministically without real waits.

import { existsSync, readFileSync } from 'node:fs';
import { isoNow } from './time.js';
import type { StateContext } from './state.js';

export interface RetryOptions {
  /** Per-attempt delays in milliseconds. Default [5_000, 15_000, 45_000]. */
  backoffMs?: number[];
  /** Maximum attempts (incl. the first try). Default backoffMs.length + 1 = 4. */
  maxAttempts?: number;
  /** Called after a failure, before the sleep. */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_BACKOFF_MS: readonly number[] = [5_000, 15_000, 45_000];

export async function retryWithBackoff<T>(
  fn: () => Promise<T> | T,
  opts: RetryOptions = {},
): Promise<T> {
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxAttempts = opts.maxAttempts ?? backoff.length + 1;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts) break;
      const idx = Math.min(attempt - 1, backoff.length - 1);
      const delayMs = backoff[idx] ?? 1000;
      opts.onRetry?.(attempt, err, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`retryWithBackoff exhausted: ${String(lastErr)}`);
}

export interface PreflightOptions {
  /** Total time to wait for a wake observation, in milliseconds. */
  maxWaitMs: number;
  /** How often to poll audit.jsonl. Default 5s. */
  pollIntervalMs?: number;
  /** Only count wake events at or after this time. Default: now. */
  since?: Date;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface PreflightResult {
  ok: boolean;
  observedWakeAt: string | null;
  waitedMs: number;
}

/**
 * Scan audit.jsonl for the first 'wake' event at-or-after `since`.
 * Returns null if no qualifying entry is found yet.
 */
export function findWakeAfter(ctx: StateContext, since: Date): string | null {
  if (!existsSync(ctx.paths.auditFile)) return null;
  const raw = readFileSync(ctx.paths.auditFile, 'utf8').trimEnd();
  if (!raw) return null;
  const sinceMs = since.getTime();
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let ev: { ts?: string; event?: string };
    try {
      ev = JSON.parse(line) as { ts?: string; event?: string };
    } catch {
      continue;
    }
    if (!ev.ts || !ev.event) continue;
    if (ev.event !== 'wake' && ev.event !== 'wake_observed') continue;
    const ts = Date.parse(ev.ts);
    if (Number.isNaN(ts)) continue;
    if (ts >= sinceMs) return ev.ts;
  }
  return null;
}

/**
 * Block until either (a) a wake event newer than `since` lands in
 * audit.jsonl, or (b) `maxWaitMs` elapses. Returns ok=true on success,
 * ok=false on timeout — the caller is expected to fail the bootstrap.
 */
export async function verifyBootstrap(
  ctx: StateContext,
  opts: PreflightOptions,
): Promise<PreflightResult> {
  const pollMs = opts.pollIntervalMs ?? 5_000;
  const since = opts.since ?? new Date();
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => new Date());
  const startMs = now().getTime();
  // One immediate check before sleeping (in case a wake already landed).
  let observed = findWakeAfter(ctx, since);
  if (observed) {
    return { ok: true, observedWakeAt: observed, waitedMs: 0 };
  }
  while (now().getTime() - startMs < opts.maxWaitMs) {
    await sleep(pollMs);
    observed = findWakeAfter(ctx, since);
    if (observed) {
      return {
        ok: true,
        observedWakeAt: observed,
        waitedMs: now().getTime() - startMs,
      };
    }
  }
  return { ok: false, observedWakeAt: null, waitedMs: opts.maxWaitMs };
}

export function preflightSummary(r: PreflightResult): string {
  if (r.ok) {
    return `PREFLIGHT_OK wake_at=${r.observedWakeAt} waited_ms=${r.waitedMs}`;
  }
  return `PREFLIGHT_TIMEOUT waited_ms=${r.waitedMs} no_wake_event`;
}

// Re-exported for callers that want a stamped marker in the audit log.
export const PREFLIGHT_EVENT = 'preflight_verified';

export function preflightAuditDetails(r: PreflightResult): Record<string, unknown> {
  return {
    ok: r.ok,
    observed_wake_at: r.observedWakeAt,
    waited_ms: r.waitedMs,
    stamped_at: isoNow(),
  };
}
