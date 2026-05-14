// H-9 (chain-runner-battle-harden phase 4, 2026-05-14). Per-failure-class
// retry policy resolution. Maps each FailureClass to a (max_attempts,
// backoff_sec[], action) tuple. The chain YAML can override any class via
// `defaults.retry_policy.<class>`; unset classes fall back to the defaults
// below, which encode the operator decisions from
// `reports/chain_runner_hardening_plan_2026-05-14.md §H-9`.
import type {
  ChainSpec,
  FailureClass,
  RetryPolicyAction,
  RetryPolicyEntry,
} from './types.js';

// Defaults, see hardening plan §H-9 YAML block. Each class has an explicit
// entry — there is no implicit fallback to a single "default" entry; missing
// classes are filled in below at lookup time.
export const DEFAULT_RETRY_POLICY: Record<FailureClass, RetryPolicyEntry> = {
  worker_no_start_rate_limit: { max_attempts: 0, action: 'pause_until_reset' },
  worker_no_start_auth_failure: { max_attempts: 0, action: 'pause_until_operator' },
  worker_no_start_binary_missing: { max_attempts: 0, action: 'pause_until_operator' },
  worker_no_start_spawn_error: {
    max_attempts: 3,
    backoff_sec: [60, 300, 900],
    action: 'retry',
  },
  worker_no_start_bad_args: { max_attempts: 0, action: 'pause_until_operator' },
  worker_hung_post_success: { max_attempts: 0, action: 'adjudicate' },
  worker_hung_mid_work: { max_attempts: 1, backoff_sec: [60], action: 'retry' },
  worker_crashed: { max_attempts: 2, backoff_sec: [120, 600], action: 'retry' },
  mark_done_failed: { max_attempts: 1, backoff_sec: [60], action: 'retry' },
  artifact_missing: { max_attempts: 1, backoff_sec: [60], action: 'retry' },
  artifact_malformed: { max_attempts: 0, action: 'adjudicate' },
  pr_unmerged_at_done: { max_attempts: 0, action: 'adjudicate' },
  acceptance_failed: { max_attempts: 0, action: 'adjudicate' },
  runtime_exceeded: { max_attempts: 0, action: 'alert' },
  unknown: { max_attempts: 1, backoff_sec: [60], action: 'retry' },
};

// Look up the effective retry policy for a class. Per-chain overrides in
// `spec.defaults.retry_policy[class]` shallow-merge over the default entry.
export function resolveRetryPolicy(
  spec: ChainSpec,
  cls: FailureClass,
): RetryPolicyEntry {
  const base = DEFAULT_RETRY_POLICY[cls];
  const override = spec.defaults?.retry_policy?.[cls];
  if (!override) return base;
  const out: RetryPolicyEntry = {
    max_attempts: override.max_attempts ?? base.max_attempts,
  };
  const backoff = override.backoff_sec ?? base.backoff_sec;
  if (backoff !== undefined) out.backoff_sec = backoff;
  const action = override.action ?? base.action;
  if (action !== undefined) out.action = action;
  return out;
}

// Returns the backoff in seconds for the NEXT attempt given the current
// attempts count (0-indexed: first retry uses backoff_sec[0]). Returns null
// if the schedule is exhausted, missing, or attempts already past the end.
export function backoffSecForAttempt(
  policy: RetryPolicyEntry,
  attempts: number,
): number | null {
  const sched = policy.backoff_sec ?? [];
  if (sched.length === 0) return null;
  if (attempts < 0 || attempts >= sched.length) return null;
  const v = sched[attempts];
  return typeof v === 'number' && v >= 0 ? v : null;
}

// Helpers for typed validation in spec.ts. A retry policy entry is well-
// formed when max_attempts is a non-negative integer and (if present)
// backoff_sec is a non-negative-integer array of length >= max_attempts.
export const VALID_ACTIONS: ReadonlySet<RetryPolicyAction> = new Set([
  'pause_until_reset',
  'pause_until_operator',
  'adjudicate',
  'alert',
  'block',
  'retry',
]);

export function validateRetryPolicyEntry(
  cls: string,
  entry: unknown,
): RetryPolicyEntry {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`retry_policy.${cls}: expected object, got ${typeof entry}`);
  }
  const e = entry as Record<string, unknown>;
  const max = e['max_attempts'];
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 0) {
    throw new Error(`retry_policy.${cls}.max_attempts: expected non-negative integer`);
  }
  let backoff: number[] | undefined;
  if (e['backoff_sec'] !== undefined) {
    if (!Array.isArray(e['backoff_sec'])) {
      throw new Error(`retry_policy.${cls}.backoff_sec: expected array`);
    }
    backoff = e['backoff_sec'].map((v, i) => {
      if (typeof v !== 'number' || v < 0) {
        throw new Error(`retry_policy.${cls}.backoff_sec[${i}]: expected non-negative number`);
      }
      return v;
    });
  }
  let action: RetryPolicyAction | undefined;
  if (e['action'] !== undefined) {
    if (typeof e['action'] !== 'string' || !VALID_ACTIONS.has(e['action'] as RetryPolicyAction)) {
      throw new Error(
        `retry_policy.${cls}.action: expected one of ${Array.from(VALID_ACTIONS).join(', ')}`,
      );
    }
    action = e['action'] as RetryPolicyAction;
  }
  const out: RetryPolicyEntry = { max_attempts: max };
  if (backoff !== undefined) out.backoff_sec = backoff;
  if (action !== undefined) out.action = action;
  return out;
}
