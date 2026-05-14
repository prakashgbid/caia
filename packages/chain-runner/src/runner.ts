import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, clearLock } from './lock.js';
import { appendAudit } from './audit.js';
import { classifyEarlyExit } from './classify.js';
import { findPhase } from './spec.js';
import { markFailed, markInProgress, type StateContext } from './state.js';
import type { LockFile, PhaseFailure } from './types.js';

export interface DispatchOptions {
  command: string;
  args?: string[];
  /**
   * Override the post-spawn early-exit detection window (ms). Default 5000.
   * Tests pass a shorter value to keep the suite snappy.
   */
  earlyExitWindowMs?: number;
}

export interface DispatchResult {
  phaseId: number;
  sessionId: string;
  promptFile: string;
  pid: number | null;
  /** Per-dispatch log file path (stdout+stderr of the spawned worker). */
  logFile?: string;
  /** Set when the child exited within the post-spawn early-exit window. */
  early_exit_code?: number | null;
  /** Optional kill signal (e.g. 'SIGKILL') if process was terminated. */
  early_exit_signal?: string | null;
  /** Set when an early exit triggered classification + markFailed. */
  early_failure?: PhaseFailure;
}

const DEFAULT_EARLY_EXIT_WINDOW_MS = 5000;

interface EarlyExit {
  code: number | null;
  signal: string | null;
}

function waitForEarlyExit(
  child: ChildProcess,
  windowMs: number,
): Promise<EarlyExit | null> {
  return new Promise<EarlyExit | null>((resolve) => {
    let settled = false;
    const settle = (v: EarlyExit | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      child.off('error', onError);
      resolve(v);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      settle({ code, signal: signal ?? null });
    };
    const onError = (): void => {
      // Spawn failed (ENOENT, EACCES, EPERM …). Without this handler, the
      // 'error' event becomes an unhandled exception. Synthesize a non-zero
      // exit so the caller classifies it as a worker_no_start_* failure.
      settle({ code: 127, signal: null });
    };
    const timer = setTimeout(() => settle(null), windowMs);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function genSessionId(phaseId: number): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '');
  return `phase${phaseId}-${ts}-${process.pid}`;
}

// H-1 extension (chain-runner-battle-harden phase 2, 2026-05-14):
// inject the standing autonomy directive into every spawned prompt so
// future chains don't need to duplicate it in every YAML phase. Operator
// hard rule 2026-05-14: spawned workers decide-and-act, never ask-and-wait.
//
// The directive is concise on purpose — long preambles waste worker
// context. The operator-only carve-out list is the lowest-cardinality
// part because the worker needs it to know which decisions to defer.
const AUTONOMY_DIRECTIVE = `## Autonomy directive (standing rule, 2026-05-14)
You are a spawned worker — operate fully autonomously. Decide-and-act, do NOT ask-and-wait.
- Do thorough analysis first, make the best informed call, execute, then inform via the phase report.
- Banned phrases: "Would you like / Should I / Want me to / Your call / Path A or B?" — kill the draft, decide, ship.
- The ONLY operator-only actions you may defer are: interactive auth/login (gh / claude logout-login), account or billing changes, physical hardware. Flag those into the phase report with \`OPERATOR_ACTION_REQUIRED: <description>\` AND call \`caia-chain emit-alert --type operator_action_required --severity high\` (alerting backbone lands in phase 5; until then, append to ~/.caia/chain-watchdog/INBOX.md).
- Apply standing rules unprompted: subscription-only billing, bypassPermissions for nested spawns, worktree isolation, true-zero before new PR, gate-mark-done.sh before mark-done.
- For everything else: pick a path, execute, document the decision in the phase report.
`;

// H-12 (chain-runner-battle-harden phase 8, 2026-05-14). Worker-level
// heartbeat instruction. The bash wrapper still fires its own background
// subshell heartbeat — this is belt-and-suspenders. If the subshell dies
// (parent shell exits, signal-handler bug, host suspend/resume) the worker
// itself still reports liveness between tool turns, and the staleness path
// won't kill it spuriously. Cadence numbers are filled in below from the
// chain spec so legit-slow phases can stretch the interval to match their
// per-phase `heartbeat_grace_sec`.
const HEARTBEAT_INSTRUCTION_TEMPLATE = (
  cadenceSec: number,
  cadenceMin: number,
): string => `## Worker-level heartbeat (H-12, 2026-05-14)
The chain runner now expects you to emit a liveness heartbeat between tool turns. The bash dispatcher also fires one in the background — your in-prompt heartbeats are the belt-and-suspenders that survive if the background subshell dies.

Cadence: invoke \`caia-chain heartbeat <session>\` **once every 5 tool calls, or every ${cadenceMin} minutes of wall-clock work, whichever comes first** (recommended interval: ~${cadenceSec}s). \`<session>\` is the session id passed to this prompt's dispatch. The call is cheap (single state.json write) and idempotent.

If you skip heartbeats and the worker stalls past the phase's \`heartbeat_grace_sec\` window, the next wake will classify the lock as stale and the phase will fail. Heartbeating loudly is the cheapest insurance against a false-stale.
`;

export function buildPromptFile(
  ctx: StateContext,
  phaseId: number,
  totalPhases: number,
): string {
  const phase = findPhase(ctx.spec, phaseId);
  const maxMinutes =
    phase.max_minutes ?? ctx.spec.defaults?.max_minutes ?? 45;
  // H-12. Cadence advice in the prompt header. Resolution order matches
  // buildInitialState's H-11 grace resolution one step removed:
  //   chain defaults.heartbeat_interval_sec → 600s (10 min) fallback.
  // Per-phase override of cadence is not currently supported; the
  // single-knob design keeps the prompt readable and the worker's
  // mental model simple.
  const cadenceSec = ctx.spec.defaults?.heartbeat_interval_sec ?? 600;
  const cadenceMin = Math.max(1, Math.round(cadenceSec / 60));
  const header = `# PHASE ${phaseId} OF ${totalPhases} — autonomous run

You are running phase ${phaseId} of the chain. The orchestrator dispatched you with all context.

Operate fully autonomously:
- DO NOT return for clarification. Make best informed decisions and document them.
- Stay within budget: max ${maxMinutes} minutes wall-clock.

${HEARTBEAT_INSTRUCTION_TEMPLATE(cadenceSec, cadenceMin)}
${AUTONOMY_DIRECTIVE}
Your task starts below:
---
`;
  const body = String(phase.prompt_template ?? '');
  const dir = mkdtempSync(join(tmpdir(), `caia_chain_phase_${phaseId}_`));
  const file = join(dir, `phase_${phaseId}.txt`);
  writeFileSync(file, header + body);
  return file;
}

/**
 * Mark in-progress, write the prompt file, acquire the lock,
 * and (optionally) spawn the configured command in the background.
 *
 * If `dispatch.command` is empty, returns the prompt file + session id
 * without spawning — useful for callers that want to manage the spawn.
 *
 * H-3 (2026-05-14): when a command is spawned, dispatchPhase opens a
 * per-dispatch log file (stdio routed there) and races the child's `exit`
 * against a 5s window. An early non-zero exit is classified via
 * classifyEarlyExit (sniffs the log for rate-limit / auth banners), the
 * phase is marked failed (attempts NOT charged because the worker didn't
 * run), and the lock is cleared so the next wake can re-dispatch.
 */
export async function dispatchPhase(
  ctx: StateContext,
  phaseId: number,
  dispatch?: DispatchOptions,
): Promise<DispatchResult> {
  const sessionId = genSessionId(phaseId);
  const promptFile = buildPromptFile(ctx, phaseId, ctx.spec.phases.length);

  markInProgress(ctx, String(phaseId), sessionId);
  acquireLock(ctx, phaseId, sessionId);

  if (!dispatch?.command) {
    return { phaseId, sessionId, promptFile, pid: null };
  }

  const logFile = join(
    ctx.paths.baseDir,
    `dispatch-${phaseId}-${sessionId}.log`,
  );
  const args = [
    ...(dispatch.args ?? []),
    String(phaseId),
    sessionId,
    promptFile,
  ];

  let logFd: number;
  try {
    logFd = openSync(logFile, 'a');
  } catch (err) {
    // Disk full / permission denied opening the log → fall back to a
    // no-stdio spawn so we still launch the worker. Audit the degraded state.
    appendAudit(ctx.paths.auditFile, 'dispatch_log_open_failed', {
      phase_id: phaseId,
      session_id: sessionId,
      log_file: logFile,
      error: (err as Error).message,
    });
    const child = spawn(dispatch.command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return {
      phaseId,
      sessionId,
      promptFile,
      pid: child.pid ?? null,
      logFile,
    };
  }

  const child = spawn(dispatch.command, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  const pid = child.pid ?? null;

  appendAudit(ctx.paths.auditFile, 'dispatch_spawned', {
    phase_id: phaseId,
    session_id: sessionId,
    pid,
    command: dispatch.command,
    log_file: logFile,
  });

  const windowMs = dispatch.earlyExitWindowMs ?? DEFAULT_EARLY_EXIT_WINDOW_MS;
  const t0 = Date.now();
  const exit = await waitForEarlyExit(child, windowMs);
  // Best-effort close of our copy of the log fd. The child still holds it via
  // inheritance; node won't actually release the file until the child exits.
  try {
    closeSync(logFd);
  } catch {
    // ignore
  }

  if (!exit) {
    // Window elapsed with the child still running — happy path.
    return { phaseId, sessionId, promptFile, pid, logFile };
  }

  // Child exited within the window.
  if (exit.code === 0 && exit.signal === null) {
    // Graceful early completion — worker called mark-done itself, or
    // dispatch target was a stub like /bin/true. Don't classify as failure.
    appendAudit(ctx.paths.auditFile, 'dispatch_early_exit_clean', {
      phase_id: phaseId,
      session_id: sessionId,
      pid,
      elapsed_ms: Date.now() - t0,
    });
    return {
      phaseId,
      sessionId,
      promptFile,
      pid,
      logFile,
      early_exit_code: 0,
      early_exit_signal: null,
    };
  }

  // Non-zero exit (or signal) — classify, markFailed, clear lock so retry can run.
  const lockSnapshot: LockFile = {
    phase_id: phaseId,
    session_id: sessionId,
    started_at: new Date(t0).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    heartbeat: new Date(t0).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  const failure = classifyEarlyExit(lockSnapshot, {
    exitCode: exit.code,
    signal: exit.signal,
    dispatchLogPath: logFile,
    elapsedMs: Date.now() - t0,
  });
  // Worker never ran substantively (it exited within 5s, no heartbeat).
  markFailed(ctx, String(phaseId), failure, { ranSubstantively: false });
  clearLock(ctx);
  appendAudit(ctx.paths.auditFile, 'dispatch_early_exit_failed', {
    phase_id: phaseId,
    session_id: sessionId,
    pid,
    exit_code: exit.code,
    signal: exit.signal,
    class: failure.class,
    elapsed_ms: Date.now() - t0,
  });
  return {
    phaseId,
    sessionId,
    promptFile,
    pid,
    logFile,
    early_exit_code: exit.code,
    early_exit_signal: exit.signal,
    early_failure: failure,
  };
}
