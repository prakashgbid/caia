export type PhaseStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'blocked';

export interface PhaseDefinition {
  id: number;
  name: string;
  description?: string;
  deps?: number[];
  max_minutes?: number;
  prompt_template?: string;
  success_criteria?: Record<string, unknown>;
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
}

export interface StateFile {
  schema_version: number;
  started_at: string;
  last_wake: string | null;
  paused: boolean;
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
