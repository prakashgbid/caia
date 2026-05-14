// Self-healing watchdog for the chain runner.
//
// Every wake, the orchestrator calls `caia-chain check-stall --wake-interval-sec N`.
// If `last_wake` has not advanced within `multiplier * wakeIntervalSec` (default
// 2× the configured wake interval), the runner:
//   1. logs a `cron_stall_detected` audit event,
//   2. appends an alert to INBOX.md (if provided),
//   3. optionally invokes a re-register hook (the bootstrap script /
//      SKILL.md re-issues create_scheduled_task).
//
// This is the second of four safeguards against the RCA failure mode
// where SKILL.md is on disk but no cron is firing.

import { spawnSync } from 'node:child_process';
import { appendAudit } from './audit.js';
import { emitAlert } from './alerting.js';
import type { StateContext } from './state.js';
import type { StateFile } from './types.js';

export interface StallCheckOptions {
  /** Configured wake-interval in seconds (e.g. 900 for a 15-minute cron). */
  wakeIntervalSec: number;
  /** Multiplier on top of wakeIntervalSec before declaring a stall. Default 2. */
  multiplier?: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface StallCheckResult {
  stalled: boolean;
  lastWake: string | null;
  /** Seconds since last_wake (or since started_at if last_wake is null). */
  ageSec: number;
  /** Threshold the age was compared against. */
  thresholdSec: number;
  /** Reason classification for the audit event. */
  reason: 'never_waked' | 'wake_overdue' | 'healthy';
}

export function detectStall(state: StateFile, opts: StallCheckOptions): StallCheckResult {
  if (!Number.isFinite(opts.wakeIntervalSec) || opts.wakeIntervalSec <= 0) {
    throw new Error(`detectStall: wakeIntervalSec must be > 0, got ${opts.wakeIntervalSec}`);
  }
  const multiplier = opts.multiplier ?? 2;
  const thresholdSec = opts.wakeIntervalSec * multiplier;
  const now = (opts.now ?? (() => new Date()))();
  if (!state.last_wake) {
    const startedMs = Date.parse(state.started_at);
    const ageSec = Number.isFinite(startedMs)
      ? (now.getTime() - startedMs) / 1000
      : 0;
    const stalled = ageSec > thresholdSec;
    return {
      stalled,
      lastWake: null,
      ageSec,
      thresholdSec,
      reason: stalled ? 'never_waked' : 'healthy',
    };
  }
  const lastMs = Date.parse(state.last_wake);
  const ageSec = (now.getTime() - lastMs) / 1000;
  const stalled = ageSec > thresholdSec;
  return {
    stalled,
    lastWake: state.last_wake,
    ageSec,
    thresholdSec,
    reason: stalled ? 'wake_overdue' : 'healthy',
  };
}

export interface RecordStallOptions {
  /** Path to INBOX.md to append a human-readable alert. Optional. */
  inboxPath?: string;
  /** Chain id, used in the INBOX message for operator clarity. */
  chainId?: string;
}

export function recordStallDetected(
  ctx: StateContext,
  result: StallCheckResult,
  opts: RecordStallOptions = {},
): void {
  appendAudit(ctx.paths.auditFile, 'cron_stall_detected', {
    last_wake: result.lastWake,
    age_sec: Math.floor(result.ageSec),
    threshold_sec: result.thresholdSec,
    reason: result.reason,
  });
  // H-10 (phase 5, 2026-05-14). Route the inbox-style alert through the
  // unified alerting backbone. The default channel set for
  // cron_stall_detected is [handoff, inbox, audit] (D-3 keeps notification
  // off for cron-stall to avoid pager fatigue on the 30-minute watchdog
  // tick); per-event channel override is supported via opts.channels but the
  // legacy call sites all rely on the default.
  const chainId = opts.chainId ?? ctx.paths.baseDir;
  emitAlert(undefined, {
    type: 'cron_stall_detected',
    severity: 'medium',
    title: `cron_stall_detected — ${chainId}`,
    detail: `last_wake=${result.lastWake ?? 'never'} age=${Math.floor(result.ageSec)}s threshold=${result.thresholdSec}s reason=${result.reason}`,
    chain: chainId,
    evidence: {
      chain_dir: ctx.paths.baseDir,
      last_wake: result.lastWake,
      age_sec: Math.floor(result.ageSec),
      threshold_sec: result.thresholdSec,
      reason: result.reason,
      action:
        'investigate scheduled-task registry; re-register via mcp__scheduled-tasks__create_scheduled_task and verify with `caia-chain verify-bootstrap`',
    },
  }, {
    auditFile: ctx.paths.auditFile,
    ...(opts.inboxPath ? { inboxPath: opts.inboxPath } : {}),
  });
}

export interface ReRegisterAttempt {
  command: string;
  args: string[];
  /** Spawn fn — injectable for tests. */
  spawn?: (cmd: string, args: string[]) => { status: number | null; stderr?: string };
}

export interface ReRegisterResult {
  attempted: boolean;
  ok: boolean;
  exitCode: number | null;
  stderr?: string;
}

/**
 * Best-effort: run an external re-register command. The chain-runner has
 * no MCP client of its own; the bootstrap script (or a per-chain helper)
 * is expected to wrap the actual mcp__scheduled-tasks__create_scheduled_task
 * call. If `command` is empty / undefined, this is a no-op.
 */
export function attemptReRegister(
  attempt: ReRegisterAttempt | undefined,
  ctx: StateContext,
): ReRegisterResult {
  if (!attempt || !attempt.command) {
    appendAudit(ctx.paths.auditFile, 'cron_reregister_skipped', {
      reason: 'no_command_configured',
    });
    return { attempted: false, ok: false, exitCode: null };
  }
  const runner =
    attempt.spawn ??
    ((cmd: string, args: string[]) => {
      const out = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      return {
        status: out.status,
        stderr: out.stderr ? out.stderr.toString('utf8') : undefined,
      };
    });
  const out = runner(attempt.command, attempt.args);
  const ok = out.status === 0;
  appendAudit(ctx.paths.auditFile, 'cron_reregister_attempted', {
    command: attempt.command,
    exit_code: out.status,
    ok,
  });
  return {
    attempted: true,
    ok,
    exitCode: out.status,
    ...(out.stderr !== undefined ? { stderr: out.stderr } : {}),
  };
}
