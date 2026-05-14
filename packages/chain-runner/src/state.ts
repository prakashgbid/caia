import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { atomicWriteJson } from './atomic.js';
import { appendAudit } from './audit.js';
import { ensureChainDir } from './paths.js';
import { isoNow } from './time.js';
import { loadChainSpec } from './spec.js';
import { failureFromReason } from './classify.js';
import { fireHandoffRefresh } from './handoff-refresh.js';
import { resolveRetryPolicy } from './retry-policy.js';
import type {
  ChainPaths,
  ChainSpec,
  FailureClass,
  PhaseFailure,
  PhaseState,
  PhaseStatus,
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
      last_failure_class: null,
      backoff_until: null,
    };
  }
  return {
    schema_version: SCHEMA_VERSION,
    started_at: isoNow(),
    last_wake: null,
    paused: false,
    paused_until: null,
    paused_reason: null,
    budget_consumed_pct: 0,
    budget_cap_pct: DEFAULT_BUDGET_CAP_PCT,
    phase_status: phaseStatus,
    current_phase: null,
    all_done: false,
    // H-5 (phase 5, 2026-05-14). Live count of consecutive NONE_ELIGIBLE
    // wakes. Incremented inside computeNextPhase whenever it returns
    // none_eligible, reset to 0 on any other result kind. Used by
    // check-stall --alert-on-streak to escalate silent stalls.
    none_eligible_streak: 0,
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
  | { kind: 'backoff'; id: number; seconds: number; until: string }
  | {
      kind:
        | 'paused'
        | 'budget_exhausted'
        | 'all_done'
        | 'none_eligible';
    };

// H-5 (phase 5, 2026-05-14). After computeNextPhase decides the outcome, this
// helper updates state.none_eligible_streak — increment on `none_eligible`,
// reset to 0 on every other result kind (including `paused`, `all_done`, and
// `backoff`, all of which are well-defined non-stalled states). Saves only
// when the value actually changes, so happy-path wakes don't churn state.json.
function _applyNoneEligibleStreak(
  ctx: StateContext,
  state: StateFile,
  result: NextPhaseResult,
): NextPhaseResult {
  const current = state.none_eligible_streak ?? 0;
  const next = result.kind === 'none_eligible' ? current + 1 : 0;
  if (next !== current) {
    state.none_eligible_streak = next;
    saveState(ctx, state);
  } else if (state.none_eligible_streak === undefined) {
    // Promote the optional field once so older state files migrate forward.
    state.none_eligible_streak = next;
    saveState(ctx, state);
  }
  return result;
}

// H-21 (chain-runner-battle-harden phase 7, 2026-05-14). evaluateNextPhase is
// the PURE half of the next-phase decision: no mutation, no audit emit, no
// state.json writes. Safe to call from `next-phase --read-only` and from tests
// that want to probe the decision without side-effects.
//
// A phase in `failed` that would be promoted to `blocked` by the retry policy
// is skipped here (treated as not-dispatchable) — the actual promotion lives
// in `promoteFailedToBlocked` and is called explicitly by wake scripts before
// next-phase.
export function evaluateNextPhase(
  state: StateFile,
  spec: ChainSpec,
): NextPhaseResult {
  if (state.paused) return { kind: 'paused' };
  if (state.budget_consumed_pct >= state.budget_cap_pct) {
    return { kind: 'budget_exhausted' };
  }
  if (state.all_done) return { kind: 'all_done' };

  const nowMs = Date.now();
  for (const p of spec.phases) {
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
      if (ps.status === 'failed') {
        const cls = ps.last_failure_class ?? ps.failure?.class ?? null;
        const isLegacyShim =
          ps.failure?.evidence?.['legacy_string_reason'] === true;
        const policy =
          cls && !isLegacyShim ? resolveRetryPolicy(spec, cls) : null;
        const policyMax = policy?.max_attempts ?? ps.max_retries;
        const policyTerminal =
          policy?.action === 'pause_until_reset' ||
          policy?.action === 'pause_until_operator' ||
          policy?.action === 'adjudicate' ||
          policy?.action === 'alert' ||
          policy?.action === 'block';
        const retriesExhausted = ps.attempts >= policyMax;
        if (policyTerminal || retriesExhausted) {
          // Read-only view of "this phase is on the failed→blocked path";
          // promoteFailedToBlocked is where the mutation happens.
          continue;
        }
        if (ps.backoff_until) {
          const bt = new Date(ps.backoff_until).getTime();
          if (Number.isFinite(bt) && bt > nowMs) {
            return {
              kind: 'backoff',
              id: p.id,
              seconds: Math.max(0, Math.ceil((bt - nowMs) / 1000)),
              until: ps.backoff_until,
            };
          }
        }
      }
      return { kind: 'phase_id', id: p.id };
    }
    if (ps.status === 'in_progress') {
      return { kind: 'in_progress', id: p.id };
    }
  }

  // Nothing dispatchable — pure check for all_done.
  const allDone = spec.phases.every(
    (p) => state.phase_status[String(p.id)]?.status === 'done',
  );
  if (allDone) return { kind: 'all_done' };
  return { kind: 'none_eligible' };
}

// H-21. promoteFailedToBlocked is the IMPURE half: walks every `failed` phase,
// applies the H-9 retry policy, and flips the phase to `blocked` (with a
// phase_blocked audit event) when retries are exhausted or the policy action
// is terminal. Returns the list of promoted phase ids so callers can audit
// the per-tick delta.
//
// Wake-script call order (H-21 contract):
//   wake-observed → check-lock-staleness → promote-blocked → next-phase
//
// `promote-blocked` runs this on disk-backed state and persists; `next-phase`
// then becomes a (mostly) read-only operation backed by `evaluateNextPhase`.
export function promoteFailedToBlocked(
  ctx: StateContext,
  state: StateFile,
): number[] {
  const promoted: number[] = [];
  for (const p of ctx.spec.phases) {
    const pid = String(p.id);
    const ps = state.phase_status[pid];
    if (!ps) continue;
    if (ps.status !== 'failed') continue;

    const cls = ps.last_failure_class ?? ps.failure?.class ?? null;
    const isLegacyShim =
      ps.failure?.evidence?.['legacy_string_reason'] === true;
    const policy =
      cls && !isLegacyShim ? resolveRetryPolicy(ctx.spec, cls) : null;
    const policyMax = policy?.max_attempts ?? ps.max_retries;
    const policyTerminal =
      policy?.action === 'pause_until_reset' ||
      policy?.action === 'pause_until_operator' ||
      policy?.action === 'adjudicate' ||
      policy?.action === 'alert' ||
      policy?.action === 'block';
    const retriesExhausted = ps.attempts >= policyMax;
    if (policyTerminal || retriesExhausted) {
      ps.status = 'blocked';
      promoted.push(p.id);
      appendAudit(ctx.paths.auditFile, 'phase_blocked', {
        phase_id: p.id,
        reason: policyTerminal
          ? `policy_action_${policy?.action ?? 'unknown'}`
          : 'retries_exhausted',
        class: cls,
        policy_action: policy?.action ?? null,
        attempts: ps.attempts,
        policy_max_attempts: policyMax,
      });
    }
  }
  if (promoted.length > 0) saveState(ctx, state);
  return promoted;
}

// computeNextPhase keeps the pre-H-21 contract for back-compat: it runs the
// promotion + the all_done bookkeeping + the none_eligible streak + audit
// emit, then returns the evaluation result. Wake scripts that call
// `next-phase` continue to work unchanged.
//
// Callers wanting the read-only flavor (the H-21 split) should use
// `evaluateNextPhase(state, spec)` directly.
export function computeNextPhase(ctx: StateContext, state: StateFile): NextPhaseResult {
  promoteFailedToBlocked(ctx, state);
  const result = evaluateNextPhase(state, ctx.spec);

  // all_done promotion: pure evaluator says all_done but state hasn't been
  // stamped yet. Stamp + audit.
  if (result.kind === 'all_done' && !state.all_done) {
    state.all_done = true;
    saveState(ctx, state);
    appendAudit(ctx.paths.auditFile, 'all_done', {});
  }

  // H-5: emit none_eligible audit + streak bookkeeping.
  if (result.kind === 'none_eligible') {
    appendAudit(ctx.paths.auditFile, 'none_eligible', {
      streak_before: state.none_eligible_streak ?? 0,
    });
  }
  return _applyNoneEligibleStreak(ctx, state, result);
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
  // H-9: a successful retry clears the backoff window; the class is left in
  // place as audit trail (it's purely informational once the phase is done).
  ps2.backoff_until = null;
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
  // H-9: copy class onto top-level field for cheap policy lookup, and if the
  // policy has a backoff schedule for the next attempt, stamp backoff_until.
  // Legacy string-reason calls (evidence.legacy_string_reason=true, class=
  // unknown) skip policy-based backoff to preserve the pre-H-9 retry contract
  // for callers that haven't migrated to typed failures.
  ps.last_failure_class = failure.class;
  const isLegacyShim =
    failure.evidence?.['legacy_string_reason'] === true;
  const policy = isLegacyShim
    ? null
    : resolveRetryPolicy(ctx.spec, failure.class);
  // attempts is the next-attempt index (0 for first retry, 1 for second).
  // Only retry-action policies populate backoff_until. The block/pause/etc
  // actions deliberately leave it null so the wake doesn't sleep on them.
  let backoffSec: number | null = null;
  if (
    policy &&
    (policy.action === 'retry' || policy.action === undefined) &&
    ps.attempts < policy.max_attempts &&
    policy.backoff_sec &&
    policy.backoff_sec.length > 0
  ) {
    const idx = Math.min(ps.attempts, policy.backoff_sec.length - 1);
    const v = policy.backoff_sec[idx];
    if (typeof v === 'number' && v >= 0) backoffSec = v;
  }
  if (backoffSec !== null) {
    ps.backoff_until = new Date(Date.now() + backoffSec * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
  } else {
    ps.backoff_until = null;
  }
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'phase_failed', {
    phase_id: Number(phaseId),
    class: failure.class,
    reason: failure.reason.slice(0, 500),
    attempt: ps.attempts,
    ran_substantively: ranSubstantively,
    evidence: failure.evidence,
    policy_action: policy?.action ?? null,
    policy_max_attempts: policy?.max_attempts ?? null,
    backoff_sec: backoffSec,
    backoff_until: ps.backoff_until,
  });
}

export interface PauseOptions {
  /** Free-form reason; persisted to state.paused_reason. */
  reason?: string;
  /**
   * H-4b / D-4. When set, the wake-script shim auto-resumes the chain once
   * wallclock passes this ISO timestamp. Used to encode rate-limit reset
   * times. Persisted to state.paused_until.
   */
  pausedUntil?: string;
}

export function pause(ctx: StateContext, opts: PauseOptions = {}): void {
  const state = loadState(ctx);
  state.paused = true;
  if (opts.reason !== undefined) state.paused_reason = opts.reason;
  if (opts.pausedUntil !== undefined) state.paused_until = opts.pausedUntil;
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'paused', {
    reason: opts.reason ?? null,
    paused_until: opts.pausedUntil ?? null,
  });
}

export function resume(ctx: StateContext): void {
  const state = loadState(ctx);
  state.paused = false;
  state.paused_until = null;
  state.paused_reason = null;
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

// H-8 (chain-runner-battle-harden phase 7, 2026-05-14). Adjudication helpers
// replace operator hand-edits of state.json with sanctioned, audited verbs.
//
// Pattern motivated by the 2026-05-14T07:13:59Z incident: phase 3 of
// redflag-remediation was hand-flipped from `blocked` → `done` via a
// state.json edit + a state.json.bak-pre-mark-done-2026-05-14 sidecar. That
// path leaves no audit event and no validation. The adjudicate / re-arm /
// force-fail trio replaces it: every operator intervention now writes a
// timestamped backup, validates the transition, emits a structured audit
// event, and fires the SESSION_HANDOFF refresh hook so other agents see the
// new state immediately.
//
// Backup placement: `<chain-dir>/.backups/state.json.bak.<suffix>.<isoNow>`.
// H-13 (phase 9) will fold this into a shared backup helper; for now each
// helper writes directly here so the audit log entries already carry a
// `backup` field pointing at the right path.

/** Allowed target states for `adjudicate`. */
const ADJUDICATE_VALID_TARGETS: ReadonlyArray<PhaseStatus> = [
  'pending',
  'in_progress',
  'failed',
  'blocked',
  'done',
];

function requireNonEmptyReason(reason: string | undefined | null): string {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length === 0) {
    throw new Error('reason is required and must be non-empty');
  }
  return trimmed;
}

function backupsDir(ctx: StateContext): string {
  return join(ctx.paths.baseDir, '.backups');
}

// Writes a timestamped snapshot of state.json under .backups/ before any
// adjudication-class mutation. Returns the absolute backup path so the audit
// event can record where the pre-edit state went. Idempotent if the state
// file is missing (returns empty string — caller still mutates fresh state).
export function writeStateBackup(ctx: StateContext, suffix: string): string {
  if (!existsSync(ctx.paths.stateFile)) return '';
  const dir = backupsDir(ctx);
  mkdirSync(dir, { recursive: true });
  const iso = isoNow().replace(/:/g, '-');
  const filename = `state.json.bak.${suffix}.${iso}`;
  const fullPath = join(dir, filename);
  copyFileSync(ctx.paths.stateFile, fullPath);
  return fullPath;
}

export interface AdjudicateOptions {
  /**
   * Structured evidence (PR URL, artifact path, doctor report, etc.) that
   * documents the operator's decision. Persisted into the
   * `phase_adjudicated` audit event verbatim.
   */
  evidence?: Record<string, unknown>;
  /**
   * When true, refuse `adjudicate --to done` if the phase's
   * `success_criteria` cannot be verified from evidence. The full
   * success-criteria validator lands in a later phase; for now strict-mode
   * just requires SOME evidence (pr / artifact / verification) to be
   * present so a `--strict --to done` adjudication can't be totally bare.
   */
  strict?: boolean;
}

export function adjudicate(
  ctx: StateContext,
  phaseId: string,
  toState: PhaseStatus,
  reason: string,
  opts: AdjudicateOptions = {},
): { backup: string; from: PhaseStatus; to: PhaseStatus } {
  const cleanReason = requireNonEmptyReason(reason);
  if (!ADJUDICATE_VALID_TARGETS.includes(toState)) {
    throw new Error(
      `invalid target state '${toState}': expected one of ${ADJUDICATE_VALID_TARGETS.join(', ')}`,
    );
  }
  const state = loadState(ctx);
  const ps = ensurePhaseEntry(state, phaseId);
  const fromState = ps.status;
  if (opts.strict && toState === 'done') {
    const ev = opts.evidence ?? {};
    const hasArtifact =
      typeof ev['pr'] === 'string' ||
      typeof ev['artifact'] === 'string' ||
      typeof ev['verification'] === 'string' ||
      typeof ev['session_id'] === 'string';
    if (!hasArtifact) {
      throw new Error(
        `strict adjudicate --to done refused: no pr/artifact/verification evidence supplied`,
      );
    }
  }
  const backup = writeStateBackup(ctx, `pre-adjudicate-${phaseId}-to-${toState}`);

  ps.status = toState;
  if (toState === 'done') {
    ps.completed_at = isoNow();
    ps.error = null;
    ps.backoff_until = null;
  } else if (toState === 'pending') {
    ps.error = null;
    ps.failure = null;
    ps.last_failure_class = null;
    ps.backoff_until = null;
    ps.session_id = null;
    ps.started_at = null;
    ps.completed_at = null;
  } else if (toState === 'blocked') {
    ps.error = ps.error ?? cleanReason.slice(0, 500);
  }
  // If we just adjudicated the in-progress phase out of in_progress, clear
  // current_phase too (it would otherwise lie to status callers).
  if (
    state.current_phase === Number(phaseId) &&
    toState !== 'in_progress'
  ) {
    state.current_phase = null;
  }
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'phase_adjudicated', {
    phase_id: Number(phaseId),
    from: fromState,
    to: toState,
    reason: cleanReason.slice(0, 500),
    evidence: opts.evidence ?? {},
    strict: opts.strict ?? false,
    backup,
  });
  fireHandoffRefresh({
    triggeredBy: `chain-phase-adjudicated-${phaseId}-to-${toState}`,
  });
  return { backup, from: fromState, to: toState };
}

export interface ReArmOptions {
  /** When true, set ps.attempts back to 0 alongside the status flip. */
  resetAttempts?: boolean;
  /** Lift the blocked-only guard. Used when re-arming an in_progress / failed phase. */
  force?: boolean;
}

export function reArm(
  ctx: StateContext,
  phaseId: string,
  reason: string,
  opts: ReArmOptions = {},
): { backup: string; from: PhaseStatus; attemptsBefore: number; attemptsAfter: number } {
  const cleanReason = requireNonEmptyReason(reason);
  const state = loadState(ctx);
  const ps = ensurePhaseEntry(state, phaseId);
  const fromState = ps.status;
  if (fromState !== 'blocked' && !opts.force) {
    throw new Error(
      `re-arm refused: phase ${phaseId} is '${fromState}', not 'blocked' (pass force=true to override)`,
    );
  }
  const backup = writeStateBackup(ctx, `pre-rearm-${phaseId}`);
  const attemptsBefore = ps.attempts;
  ps.status = 'pending';
  ps.error = null;
  ps.backoff_until = null;
  if (opts.resetAttempts) {
    ps.attempts = 0;
  }
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'phase_rearmed', {
    phase_id: Number(phaseId),
    from: fromState,
    reset_attempts: opts.resetAttempts ?? false,
    attempts_before: attemptsBefore,
    attempts_after: ps.attempts,
    reason: cleanReason.slice(0, 500),
    backup,
  });
  fireHandoffRefresh({
    triggeredBy: `chain-phase-rearmed-${phaseId}`,
  });
  return {
    backup,
    from: fromState,
    attemptsBefore,
    attemptsAfter: ps.attempts,
  };
}

export function forceFail(
  ctx: StateContext,
  phaseId: string,
  reason: string,
): { backup: string; from: PhaseStatus } {
  const cleanReason = requireNonEmptyReason(reason);
  const state = loadState(ctx);
  const ps = ensurePhaseEntry(state, phaseId);
  const fromState = ps.status;
  const backup = writeStateBackup(ctx, `pre-force-fail-${phaseId}`);
  ps.status = 'failed';
  ps.error = cleanReason.slice(0, 500);
  const detectedAt = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
  const failure: PhaseFailure = {
    class: 'unknown',
    reason: cleanReason.slice(0, 500),
    detected_at: detectedAt,
    evidence: { source: 'operator_force_fail' },
  };
  ps.failure = failure;
  ps.last_failure_class = 'unknown';
  ps.backoff_until = null;
  if (state.current_phase === Number(phaseId)) {
    state.current_phase = null;
  }
  saveState(ctx, state);
  appendAudit(ctx.paths.auditFile, 'phase_force_failed', {
    phase_id: Number(phaseId),
    from: fromState,
    reason: cleanReason.slice(0, 500),
    backup,
  });
  fireHandoffRefresh({
    triggeredBy: `chain-phase-force-failed-${phaseId}`,
  });
  return { backup, from: fromState };
}
