export type PhaseStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'blocked';

// H-15 (chain-runner-battle-harden phase 9, 2026-05-14). Phase-level
// success_criteria, with strict-mode opt-in. Pre-H-15 the success criteria
// were stored as a free `Record<string, unknown>` and only the bash gate
// (bin/gate-mark-done.sh) inspected them. The typed schema below is the
// in-process contract that state.markDone validates before flipping a phase
// to `done`.
//
// `enforce`:
//   - 'warn'   — failure emits `phase_acceptance_warn` + alert, proceeds.
//   - 'strict' — failure refuses mark-done, leaves the phase `in_progress`,
//                emits `phase_acceptance_failed`. Operator runs adjudicate /
//                fix the artifact / call mark-done again.
//
// Default per D-5 is `warn` for back-compat. Strict can be set per-phase
// (PhaseDefinition.success_criteria.enforce) OR chain-wide
// (ChainConfig.acceptance_enforce_default); phase override wins.
export interface PhaseSuccessCriteria {
  /** Absolute or homedir-relative path that must exist after mark-done. */
  output_file?: string;
  /** Minimum byte size of `output_file`. */
  min_bytes?: number;
  /** Regex (string) that must match at least once in `output_file`. */
  grep_match?: string;
  /**
   * When true, scrape the phase's dispatch log for `github.com/<o>/<r>/pull/<n>`
   * refs and require each one to be in state=MERGED via `gh pr view`. Falls
   * back to "skip and warn" when no PR refs are found, matching gate-mark-done
   * for back-compat.
   */
  requires_merged_pr?: boolean;
  /** Per-phase enforcement mode override. */
  enforce?: 'warn' | 'strict';
  [k: string]: unknown;
}

export interface PhaseDefinition {
  id: number;
  name: string;
  description?: string;
  deps?: number[];
  max_minutes?: number;
  prompt_template?: string;
  success_criteria?: PhaseSuccessCriteria;
  /**
   * H-11 (chain-runner-battle-harden phase 8, 2026-05-14). Per-phase override
   * for the staleness grace window (seconds). When omitted the phase inherits
   * `defaults.heartbeat_grace_sec` from the spec, which itself falls back to
   * the `DEFAULT_HEARTBEAT_GRACE_SEC = 1800` constant in state.ts.
   * Legit-slow phases (Phase 11 of self-hosting chains often take >30 min) can
   * widen the window; impatient detection phases can narrow it.
   */
  heartbeat_grace_sec?: number;
  /**
   * H-14 / D-1 (phase 9, 2026-05-14). Per-phase opt-in to the auto-adjudicate
   * path for `worker_hung_post_success`. When true and the classifier emits
   * worker_hung_post_success, the lock-staleness recovery path flips the
   * phase to `done` via markAutoAdjudicated instead of `failed`. Chain-wide
   * default lives at ChainConfig.auto_resolve_hung_post_success.
   */
  auto_resolve_hung_post_success?: boolean;
  /**
   * H-15 / D-5 (phase 9, 2026-05-14). Per-phase enforcement mode for
   * success_criteria validation in markDone. Phase override wins over
   * ChainConfig.acceptance_enforce_default. Omitted → fall back to the
   * chain default ('warn').
   */
  acceptance_enforce?: 'warn' | 'strict';
  [k: string]: unknown;
}

// H-9 (chain-runner-battle-harden phase 4, 2026-05-14). Per-failure-class
// retry policy. `action` tells the wake script what to do when retries are
// exhausted (or zero); `backoff_sec` is the delay schedule between retries.
// The class-aware policy lets a rate-limit pause cleanly without burning
// retries, while a spawn-error still backs off and retries 3x.
export type RetryPolicyAction =
  | 'pause_until_reset' // rate-limit — pause chain, wait for reset
  | 'pause_until_operator' // auth / binary missing — needs interactive fix
  | 'adjudicate' // hung-post-success — operator review
  | 'alert' // runtime-exceeded — alert + leave failed
  | 'block' // generic — promote to blocked
  | 'retry'; // retry with backoff_sec schedule

export interface RetryPolicyEntry {
  max_attempts: number;
  /** Backoff delays in seconds. Length should be >= max_attempts when retrying. */
  backoff_sec?: number[];
  /** Action to take when retries are exhausted or when max_attempts === 0. */
  action?: RetryPolicyAction;
}

export interface ChainDefaults {
  max_retries?: number;
  max_minutes?: number;
  heartbeat_interval_sec?: number;
  /**
   * H-11 (chain-runner-battle-harden phase 8, 2026-05-14). Chain-wide
   * heartbeat staleness grace (seconds). Per-phase overrides win; this is
   * the second-tier fallback. Omitted → DEFAULT_HEARTBEAT_GRACE_SEC (1800).
   */
  heartbeat_grace_sec?: number;
  /** H-9: per-FailureClass retry policy. Missing classes inherit DEFAULT_RETRY_POLICY. */
  retry_policy?: Partial<Record<FailureClass, RetryPolicyEntry>>;
}

// Operator-decision flags surfaced as chain_config in the spec YAML. Loader
// passes them through verbatim; only the keys consumed by runtime today are
// declared here, but [k: string]: unknown keeps future opt-in flags painless.
export interface ChainConfig {
  auto_resolve_hung_post_success?: boolean;
  max_concurrent?: number;
  alert_channels?: string[];
  none_eligible_alert_threshold?: number;
  account_quota_reset_aware?: boolean;
  /**
   * H-15 / D-5 (phase 9, 2026-05-14). Chain-wide enforcement mode for
   * success_criteria validation in markDone. Defaults to 'warn' (back-compat
   * with chains in flight when phase 9 ships). Strict mode is opt-in either
   * here (chain-wide) or per-phase via PhaseDefinition.acceptance_enforce /
   * success_criteria.enforce.
   */
  acceptance_enforce_default?: 'warn' | 'strict';
  [k: string]: unknown;
}

export interface ChainSpec {
  defaults?: ChainDefaults;
  chain_config?: ChainConfig;
  phases: PhaseDefinition[];
}

// H-1 (phase 2 of chain-runner-battle-harden, 2026-05-14): typed failure
// classification. Replaces the single `stale_lock` string reason with a
// closed enum captured at detection time. Maps to gap-analysis §1.1 F-01..F-15.
export type FailureClass =
  | 'worker_no_start_rate_limit'
  | 'worker_no_start_auth_failure'
  | 'worker_no_start_binary_missing'
  | 'worker_no_start_spawn_error'
  | 'worker_no_start_bad_args'
  | 'worker_hung_post_success'
  | 'worker_hung_mid_work'
  | 'worker_crashed'
  | 'mark_done_failed'
  | 'artifact_missing'
  | 'artifact_malformed'
  | 'pr_unmerged_at_done'
  | 'acceptance_failed'
  | 'runtime_exceeded'
  | 'unknown';

export interface PhaseFailure {
  class: FailureClass;
  reason: string;
  detected_at: string;
  evidence: Record<string, unknown>;
}

export interface PhaseState {
  status: PhaseStatus;
  attempts: number;
  max_retries: number;
  max_minutes: number;
  started_at: string | null;
  completed_at: string | null;
  session_id: string | null;
  error: string | null;
  failure?: PhaseFailure | null;
  /**
   * H-9 (chain-runner-battle-harden phase 4, 2026-05-14). FailureClass of the
   * most recent failure, copied off `failure.class` for cheap policy lookup
   * without rehydrating PhaseFailure. Null until the phase has ever failed.
   */
  last_failure_class?: FailureClass | null;
  /**
   * H-9. When set, computeNextPhase returns BACKOFF instead of phase_id until
   * the wallclock passes this ISO timestamp. Populated by markFailed when the
   * retry policy for the class has a `backoff_sec` schedule.
   */
  backoff_until?: string | null;
  /**
   * H-11 (chain-runner-battle-harden phase 8, 2026-05-14). Resolved at
   * buildInitialState from (phase override → chain default → 1800s) and
   * frozen into state so checkLockStaleness reads the per-phase grace
   * without re-walking the spec. Optional in the schema so older state
   * files load without a migration; lock.checkLockStaleness falls back to
   * DEFAULT_HEARTBEAT_GRACE_SEC when undefined.
   */
  heartbeat_grace_sec?: number;
}

export interface StateFile {
  schema_version: number;
  started_at: string;
  last_wake: string | null;
  paused: boolean;
  /**
   * H-14 / D-4 (phase 9, 2026-05-14). ISO timestamp the chain entered the
   * paused state. Distinct from `paused_until` (the auto-resume target) — this
   * is the operator-facing audit field. Promoted to mandatory in v2; pre-v2
   * state files have it backfilled to null by migrations.v1_to_v2.
   */
  paused_at?: string | null;
  /**
   * H-4b / D-4 (chain-runner-battle-harden phase 4, 2026-05-14). When the
   * preflight detects a rate-limit and parses the reset time, this ISO
   * timestamp is written into state.json so wake-script shims can auto-resume
   * the chain once now >= paused_until.
   */
  paused_until?: string | null;
  /** Why the chain was paused (set alongside `paused`). */
  paused_reason?: string | null;
  budget_consumed_pct: number;
  budget_cap_pct: number;
  phase_status: Record<string, PhaseState>;
  current_phase: number | null;
  all_done: boolean;
  /**
   * H-5 (chain-runner-battle-harden phase 5, 2026-05-14). Count of consecutive
   * wakes that produced `none_eligible` from computeNextPhase. Used by
   * `caia-chain check-stall --alert-on-streak <n>` to escalate silent chain
   * stalls (the 8-hour 2026-05-14 incident pattern). Resets to 0 on any
   * non-`none_eligible` result. Optional in the schema so older state.json
   * files load without a migration; first save promotes it to 0.
   */
  none_eligible_streak?: number;
}

export interface LockFile {
  phase_id: number;
  session_id: string;
  started_at: string;
  heartbeat: string;
  /**
   * H-24 (chain-runner-battle-harden phase 11, 2026-05-14). SHA-256 of the
   * canonical-JSON encoding of the rest of the lock fields. Verified on
   * load — a mismatch indicates the lockfile was truncated, manually edited,
   * or corrupted by a concurrent writer (which H-22's flock makes
   * impossible, but we belt-and-suspenders the check anyway). Optional in
   * the schema so locks written by older binaries still load — load just
   * skips the verification when the field is absent.
   */
  checksum?: string;
  /**
   * H-30 (chain-runner-battle-harden phase 11, 2026-05-14). Prompt file
   * written by buildPromptFile and consumed by the spawned worker. Recorded
   * here so clearLock can rm-rf the parent tmpdir without the caller having
   * to plumb the path through markDone / markFailed. Optional — older locks
   * predate the field; clearLock skips the cleanup when absent.
   */
  prompt_file?: string | null;
  /**
   * H-42 (chain-runner-battle-harden phase 11, 2026-05-14). Worker PID, set
   * after spawn so `caia-chain stop --phase <id>` can SIGTERM the right
   * process without having to re-walk pgrep. Optional — early-exit dispatches
   * never get a PID stamped, and locks acquired without spawn (cli `dispatch`
   * with no --spawn) leave it null.
   */
  worker_pid?: number | null;
}

export interface AuditEvent {
  ts: string;
  event: string;
  [k: string]: unknown;
}

export interface ChainPaths {
  baseDir: string;
  stateFile: string;
  lockFile: string;
  auditFile: string;
}
