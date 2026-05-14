import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteJson } from './atomic.js';
import { appendAudit } from './audit.js';
import { ensureChainDir } from './paths.js';
import { isoNow } from './time.js';
import { loadChainSpec } from './spec.js';
import { failureFromReason } from './classify.js';
import type {
  ChainPaths,
  ChainSpec,
  FailureClass,
  PhaseFailure,
  PhaseState,
  StateFile,
} from './types.js';

export const SCHEMA_VERSION = 1;
export const DEFAULT_BUDGET_CAP_PCT = 25;

export interface StateContext {
  paths: ChainPaths;
  spec: ChainSpec;
}

export function loadContext(chainId: string, specPath: string): StateContext {
  const paths = ensureChainDir(chainId);
  const spec = loadChainSpec(specPath);
  return { paths, spec };
}

export function buildInitialState(spec: ChainSpec): StateFile {
  const defaults = spec.defaults ?? {};
  const phaseStatus: Record<string, PhaseState> = {};
  for (const p of spec.phases) {
    phaseStatus[String(p.id)] = {
      status: 'pending',
      attempts: 0,
      max_retries: defaults.max_retries ?? 2,
      max_minutes: p.max_minutes ?? defaults.max_minutes ?? 45,
      started_at: null,
      completed_at: null,
      session_id: null,
      error: null,
      failure: null,
    };
  }
  return {
    schema_version: SCHEMA_VERSION,
    started_at: isoNow(),
    last_wake: null,
    paused: false,
    budget_consumed_pct: 0,
    budget_cap_pct: DEFAULT_BUDGET_CAP_PCT,
    phase_status: phaseStatus,
    current_phase: null,
    all_done: false,
  };
}

export function loadState(ctx: StateContext): StateFile {
  if (!existsSync(ctx.paths.stateFile)) {
    return initState(ctx);
  }
  const raw = readFileSync(ctx.paths.stateFile, 'utf8');
  return JSON.parse(raw) as StateFile;
}

export function tryLoadState(ctx: StateContext): StateFile | null {
  if (!existsSync(ctx.paths.stateFile)) return null;
  try {
    return JSON.parse(readFileSync(ctx.paths.stateFile, 'utf8')) as StateFile;
  } catch {
    return null;
  }
}

export function saveState(ctx: StateContext, state: StateFile): void {
  atomicWriteJson(ctx.paths.stateFile, state);
}

export function initState(ctx: StateContext): StateFile {
  const state = buildInitialState(ctx.spec);
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'state_init', {
    phases: ctx.spec.phases.length,
  });
  return state;
}

export function ensurePhaseEntry(state: StateFile, phaseId: string): PhaseState {
  const entry = state.phase_status[phaseId];
  if (!entry) {
    throw new Error(`unknown phase id ${phaseId} (not in state)`);
  }
  return entry;
}

export type NextPhaseResult =
  | { kind: 'phase_id'; id: number }
  | { kind: 'in_progress'; id: number }
  | {
      kind:
        | 'paused'
        | 'budget_exhausted'
        | 'all_done'
        | 'none_eligible';
    };

export function computeNextPhase(ctx: StateContext, state: StateFile): NextPhaseResult {
  if (state.paused) return { kind: 'paused' };
  if (state.budget_consumed_pct >= state.budget_cap_pct) {
    return { kind: 'budget_exhausted' };
  }
  if (state.all_done) return { kind: 'all_done' };

  let mutated = false;
  for (const p of ctx.spec.phases) {
    const pid = String(p.id);
    const ps = state.phase_status[pid];
    if (!ps) continue;
    if (ps.status === 'done' || ps.status === 'blocked') continue;

    const deps = p.deps ?? [];
    const depsMet = deps.every(
      (d) => state.phase_status[String(d)]?.status === 'done',
    );
    if (!depsMet) continue;

    if (ps.status === 'pending' || ps.status === 'failed') {
      if (ps.status === 'failed' && ps.attempts >= ps.max_retries) {
        ps.status = 'blocked';
        mutated = true;
        appendAudit(ctx.paths.auditFile, 'phase_blocked', {
          phase_id: p.id,
          reason: 'retries_exhausted',
        });
        continue;
      }
      if (mutated) saveState(ctx, state);
      return { kind: 'phase_id', id: p.id };
    }
    if (ps.status === 'in_progress') {
      if (mutated) saveState(ctx, state);
      return { kind: 'in_progress', id: p.id };
    }
  }

  // Nothing dispatchable found — promote to all_done if all are done.
  const allDone = ctx.spec.phases.every(
    (p) => state.phase_status[String(p.id)]?.status === 'done',
  );
  if (allDone) {
    state.all_done = true;
    saveState(ctx, state);
    appendAudit(ctx.paths.auditFile, 'all_done', {});
    return { kind: 'all_done' };
  }
  if (mutated) saveState(ctx, state);
  return { kind: 'none_eligible' };
}

// H-2 (chain-runner-battle-harden phase 3, 2026-05-14). markInProgress emits
// only the lifecycle audit events; it no longer mutates ps.attempts. The
// counter advances in recordAttemptCompleted, which is called by markDone /
// markFailed / the lock-staleness path with a `ranSubstantively` flag — a
// worker that never started (rate-limit, auth-fail, /bin/false) leaves
// attempts untouched, so a benign re-dispatch isn't burned as a retry.
export function markInProgress(
  ctx: StateContext,
  phaseId: string,
  sessionId: string,
): void {
  const state = loadState(ctx);
  const ps = ensurePhaseEntry(state, phaseId);
  ps.status = 'in_progress';
  ps.session_id = sessionId;
  ps.started_at = isoNow();
  ps.error = null;
  state.current_phase = Number(phaseId);
  saveState(ctx, state);
  // New event: attempt_started — fires once per dispatch regardless of whether
  // the worker actually runs. Use the audit timeline to count dispatches.
  appendAudit(ctx.paths.auditFile, 'attempt_started', {
    phase_id: Number(phaseId),
    session_id: sessionId,
    attempts_so_far: ps.attempts,
  });
  // Keep phase_in_progress for back-compat with watchdogs / regression tests
  // that grep for it. The `attempt` field reports the current counter; it
  // does NOT pre-increment.
  appendAudit(ctx.paths.auditFile, 'phase_in_progress', {
    phase_id: Number(phaseId),
    session_id: sessionId,
    attempt: ps.attempts,
  });
}

// H-2. Called by markDone, markFailed, and the lock-staleness recovery path.
// Increments ps.attempts iff the worker showed any sign of running — heartbeat
// fired, log produced output, artifact landed, or the worker itself called
// mark-done/mark-failed. A zero-evidence early exit (binary missing, rate
// limit at spawn) returns without incrementing so the retry policy gets a
// clean slate.
export function recordAttemptCompleted(
  ctx: StateContext,
  phaseId: string,
  sessionId: string | null,
  ranSubstantively: boolean,
): void {
  const state = loadState(ctx);
  const ps = ensurePhaseEntry(state, phaseId);
  const before = ps.attempts;
  if (ranSubstantively) {
    ps.attempts = before + 1;
    saveState(ctx, state);
  }
  appendAudit(ctx.paths.auditFile, 'attempt_completed', {
    phase_id: Number(phaseId),
    session_id: sessionId,
    ran_substantively: ranSubstantively,
    attempts_before: before,
    attempts_after: ps.attempts,
  });
}

// H-2 heuristic. Returns true when the failure evidence shows the worker did
// real work. Used by markFailed's default path when the caller hasn't already
// computed ranSubstantively from the lock.
//
// Rule of thumb:
//   - worker_no_start_*           → false (worker never got going)
//   - runtime_exceeded            → true  (worker ran past the cap)
//   - worker_hung_*               → true
//   - worker_crashed              → true
//   - mark_done_failed, artifact_*→ true  (the worker had to run to fail here)
//   - acceptance_failed, pr_unmerged_at_done → true
//   - unknown                     → true  (conservative — counts toward retry)
function inferRanSubstantivelyFromClass(cls: FailureClass): boolean {
  if (cls.startsWith('worker_no_start_')) return false;
  return true;
}

export function markDone(ctx: StateContext, phaseId: string): void {
  const state = loadState(ctx);
  const ps = ensurePhaseEntry(state, phaseId);
  const sessionId = ps.session_id;
  // Increment attempts before flipping status so the audit shows the final
  // count when the phase finishes.
  recordAttemptCompleted(ctx, phaseId, sessionId, true);
  // Re-load: recordAttemptCompleted just persisted.
  const state2 = loadState(ctx);
  const ps2 = ensurePhaseEntry(state2, phaseId);
  ps2.status = 'done';
  ps2.completed_at = isoNow();
  saveState(ctx, state2);
  appendAudit(ctx.paths.auditFile, 'phase_done', {
    phase_id: Number(phaseId),
  });
}

// Mark a phase done via the D-1 auto-adjudication path. Used when the
// classifier emits worker_hung_post_success AND chain_config has
// auto_resolve_hung_post_success=true AND the artifact validates the
// declared success_criteria. The audit event is distinct from a normal
// phase_done so operators can audit auto-recoveries vs first-class success.
export function markAutoAdjudicated(
  ctx: StateContext,
  phaseId: string,
  failure: PhaseFailure,
  verification: Record<string, unknown>,
): void {
  const sessionId =
    loadState(ctx).phase_status[phaseId]?.session_id ?? null;
  // worker_hung_post_success means the artifact landed — the worker ran.
  recordAttemptCompleted(ctx, phaseId, sessionId, true);
  const state = loadState(ctx);
  const ps = ensurePhaseEntry(state, phaseId);
  ps.status = 'done';
  ps.completed_at = isoNow();
  ps.failure = failure;
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'phase_auto_adjudicated', {
    phase_id: Number(phaseId),
    class: failure.class,
    reason: failure.reason,
    verification,
  });
}

export interface MarkFailedOptions {
  /**
   * Whether the worker showed signs of actually running. When omitted, the
   * value is inferred from `failure.class` (worker_no_start_* → false,
   * otherwise → true). The lock-staleness path passes an explicit boolean
   * computed from heartbeat / log-size / artifact evidence so a zero-work
   * dispatch isn't charged as a retry.
   */
  ranSubstantively?: boolean;
}

// Back-compat shim: legacy callers pass a string reason; new callers pass a
// structured PhaseFailure. The shim wraps the string under class=unknown so
// existing wake scripts + the `caia-chain mark-failed <id> <reason>` CLI
// keep working through one release. The structured form is preferred.
export function markFailed(
  ctx: StateContext,
  phaseId: string,
  failureOrReason: PhaseFailure | string,
  opts: MarkFailedOptions = {},
): void {
  const failure: PhaseFailure =
    typeof failureOrReason === 'string'
      ? failureFromReason(failureOrReason)
      : failureOrReason;
  const ranSubstantively =
    opts.ranSubstantively ?? inferRanSubstantivelyFromClass(failure.class);
  // Stash sessionId before mutating state, for the attempt_completed event.
  const sessionId =
    loadState(ctx).phase_status[phaseId]?.session_id ?? null;
  recordAttemptCompleted(ctx, phaseId, sessionId, ranSubstantively);
  const state = loadState(ctx);
  const ps = ensurePhaseEntry(state, phaseId);
  ps.status = 'failed';
  ps.error = failure.reason.slice(0, 500);
  ps.failure = failure;
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'phase_failed', {
    phase_id: Number(phaseId),
    class: failure.class,
    reason: failure.reason.slice(0, 500),
    attempt: ps.attempts,
    ran_substantively: ranSubstantively,
    evidence: failure.evidence,
  });
}

export function pause(ctx: StateContext): void {
  const state = loadState(ctx);
  state.paused = true;
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'paused', {});
}

export function resume(ctx: StateContext): void {
  const state = loadState(ctx);
  state.paused = false;
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'resumed', {});
}

export function setBudget(ctx: StateContext, pct: number): void {
  const state = loadState(ctx);
  state.budget_consumed_pct = pct;
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'budget_update', { pct });
}

export function recordWake(ctx: StateContext): void {
  const state = loadState(ctx);
  state.last_wake = isoNow();
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'wake', {});
}
