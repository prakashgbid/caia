// H-19 (chain-runner-battle-harden phase 10, 2026-05-14). Audit event registry
// + per-event payload schema. Closed set of `event` names with a minimal
// shape contract per event so accidental typos (`paused` vs `chain.paused`)
// or required-field omissions are caught in dev. Production keeps the
// validator no-op for performance.
//
// Activation:
//   - CAIA_VALIDATE_AUDIT=1 — assertValidAudit throws on mismatch
//   - default                — assertValidAudit no-ops (returns the input)
//
// The registry is intentionally a permissive *minimum* schema — `required`
// fields must be present and of the declared primitive type, but extra keys
// are allowed (callers regularly add evidence/context). This keeps the
// registry useful as a structural sanity check without forcing every event
// to enumerate every field it might carry.

import { isoNow } from './time.js';

/** Primitive JSON types we accept for required-field type checks. */
export type AuditFieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface AuditEventSpec {
  /** Required field names on the event payload (excluding ts + event). */
  required?: ReadonlyArray<{ name: string; type: AuditFieldType }>;
  /** Free-form description, shown in errors. */
  description?: string;
  /** Category grouping for stats aggregation. */
  category?:
    | 'phase'
    | 'attempt'
    | 'dispatch'
    | 'lock'
    | 'preflight'
    | 'watchdog'
    | 'alert'
    | 'lifecycle'
    | 'reap'
    | 'operator';
}

/**
 * Closed registry of audit event names. Every appendAudit(_, name, _) call
 * site in the codebase MUST appear here. New event names are added here
 * first, then in the call site. The phase 10 inventory crawl found 22
 * historical event names across the four existing chains + 11 more emitted
 * by the current source code (state_migrated, none_eligible, etc.) for a
 * total of 33 — those are all listed below.
 */
export const AUDIT_EVENTS = {
  // Lifecycle (state machine snapshots)
  state_init: {
    category: 'lifecycle',
    required: [{ name: 'phases', type: 'number' }],
    description: 'Initial state.json materialized for a new chain.',
  },
  state_migrated: {
    category: 'lifecycle',
    description: 'state.json migrated through migrations.ts to a newer schema_version.',
  },
  resumed: {
    category: 'lifecycle',
    description: 'Chain resumed (pause cleared).',
  },
  paused: {
    category: 'lifecycle',
    description: 'Chain paused.',
  },
  all_done: {
    category: 'lifecycle',
    description: 'Every phase reached `done`.',
  },
  wake: {
    category: 'lifecycle',
    description: 'Wake-tick fired (cron/launchd) and recorded last_wake.',
  },
  none_eligible: {
    category: 'lifecycle',
    required: [{ name: 'streak', type: 'number' }],
    description: 'No phase was dispatchable this tick.',
  },
  budget_update: {
    category: 'lifecycle',
    required: [{ name: 'pct', type: 'number' }],
    description: 'budget_consumed_pct updated.',
  },

  // Phase-level transitions
  phase_in_progress: {
    category: 'phase',
    required: [
      { name: 'phase_id', type: 'number' },
      { name: 'session_id', type: 'string' },
      { name: 'attempt', type: 'number' },
    ],
    description: 'Phase transitioned to in_progress and acquired the lock.',
  },
  phase_done: {
    category: 'phase',
    required: [{ name: 'phase_id', type: 'number' }],
    description: 'Phase transitioned to done, lock cleared.',
  },
  phase_failed: {
    category: 'phase',
    required: [
      { name: 'phase_id', type: 'number' },
      { name: 'reason', type: 'string' },
    ],
    description: 'Phase transitioned to failed (retry policy may still apply).',
  },
  phase_blocked: {
    category: 'phase',
    required: [
      { name: 'phase_id', type: 'number' },
      { name: 'reason', type: 'string' },
    ],
    description: 'Phase promoted from failed→blocked (retries exhausted).',
  },
  phase_adjudicated: {
    category: 'operator',
    required: [{ name: 'phase_id', type: 'number' }],
    description: 'Operator-issued adjudicate state transition.',
  },
  phase_auto_adjudicated: {
    category: 'phase',
    required: [{ name: 'phase_id', type: 'number' }],
    description: 'Auto-adjudication path (worker_hung_post_success → done).',
  },
  phase_rearmed: {
    category: 'operator',
    required: [{ name: 'phase_id', type: 'number' }],
    description: 'Operator re-armed a blocked phase back to pending.',
  },
  phase_force_failed: {
    category: 'operator',
    required: [{ name: 'phase_id', type: 'number' }],
    description: 'Operator forced a phase to failed.',
  },
  phase_acceptance_ok: {
    category: 'phase',
    required: [{ name: 'phase_id', type: 'number' }],
    description: 'success_criteria validated cleanly on mark-done.',
  },
  phase_acceptance_warn: {
    category: 'phase',
    required: [{ name: 'phase_id', type: 'number' }],
    description: 'success_criteria failed in warn mode — mark-done proceeded.',
  },
  phase_acceptance_failed: {
    category: 'phase',
    required: [{ name: 'phase_id', type: 'number' }],
    description: 'success_criteria failed in strict mode — mark-done refused.',
  },

  // Attempts (sub-phase loop counters)
  attempt_started: {
    category: 'attempt',
    required: [
      { name: 'phase_id', type: 'number' },
      { name: 'session_id', type: 'string' },
    ],
    description: 'A new dispatch attempt is starting.',
  },
  attempt_completed: {
    category: 'attempt',
    required: [
      { name: 'phase_id', type: 'number' },
      { name: 'session_id', type: 'string' },
    ],
    description: 'A dispatch attempt completed (ran_substantively flag included).',
  },

  // Dispatch
  dispatch_spawned: {
    category: 'dispatch',
    required: [
      { name: 'phase_id', type: 'number' },
      { name: 'session_id', type: 'string' },
      { name: 'pid', type: 'number' },
    ],
    description: 'Background worker spawned.',
  },
  dispatch_log_open_failed: {
    category: 'dispatch',
    required: [{ name: 'phase_id', type: 'number' }],
    description: 'Could not open dispatch log for write.',
  },
  dispatch_early_exit_clean: {
    category: 'dispatch',
    required: [{ name: 'phase_id', type: 'number' }],
    description: 'Worker exited within the early-exit window with code 0.',
  },
  dispatch_early_exit_failed: {
    category: 'dispatch',
    required: [{ name: 'phase_id', type: 'number' }],
    description: 'Worker exited within the early-exit window with a failure class.',
  },

  // Lock
  lock_cleared: {
    category: 'lock',
    required: [
      { name: 'phase_id', type: 'number' },
      { name: 'reason', type: 'string' },
    ],
    description: 'Lock cleared (timeout / stale / explicit).',
  },

  // Preflight
  preflight_dispatch: {
    category: 'preflight',
    required: [
      { name: 'status', type: 'string' },
      { name: 'exit_code', type: 'number' },
    ],
    description: 'preflight-dispatch probe result.',
  },
  preflight_healthz: {
    category: 'preflight',
    required: [{ name: 'ok', type: 'boolean' }],
    description: 'mentor + router /healthz probe summary.',
  },
  preflight_verified: {
    category: 'preflight',
    required: [{ name: 'ok', type: 'boolean' }],
    description: 'Wake-event verification (cron firing) result.',
  },

  // Watchdog
  cron_stall_detected: {
    category: 'watchdog',
    required: [
      { name: 'age_sec', type: 'number' },
      { name: 'threshold_sec', type: 'number' },
    ],
    description: 'last_wake age exceeded threshold.',
  },
  cron_reregister_attempted: {
    category: 'watchdog',
    description: 'Watchdog attempted to re-register the wake LaunchAgent.',
  },
  cron_reregister_skipped: {
    category: 'watchdog',
    description: 'Watchdog skipped re-register (cooldown / disabled).',
  },

  // Reap
  orphan_reaped: {
    category: 'reap',
    required: [
      { name: 'phase_id', type: 'number' },
      { name: 'pid', type: 'number' },
    ],
    description: 'Stray worker process terminated.',
  },

  // Alerting
  alert_emitted: {
    category: 'alert',
    description: 'Alert fan-out (handoff/inbox/notification/audit) completed.',
  },
  alert_suppressed_duplicate: {
    category: 'alert',
    description: 'Alert suppressed by the 6h dedupe.',
  },

  // Free-form chain-level audit (used by operator and historical chain
  // retirement events; payloads vary, so no required fields).
  'chain.paused': {
    category: 'lifecycle',
    description: 'Operator-issued pause with inventory/decision payload.',
  },
  'chain.unpaused': {
    category: 'lifecycle',
    description: 'Operator-issued unpause with decision payload.',
  },
  'chain.retired': {
    category: 'lifecycle',
    description: 'Operator retired the chain (superseded / dead-end).',
  },
  chain_bootstrapped: {
    category: 'lifecycle',
    required: [
      { name: 'label', type: 'string' },
      { name: 'wake_script', type: 'string' },
    ],
    description:
      'Chain artifacts scaffolded by `caia-chain bootstrap-new-chain` (H-47).',
  },
} as const satisfies Record<string, AuditEventSpec>;

/** Closed-enum type — every appendAudit name should be assignable to this. */
export type AuditEventName = keyof typeof AUDIT_EVENTS;

export const AUDIT_EVENT_NAMES: ReadonlyArray<AuditEventName> = Object.keys(
  AUDIT_EVENTS,
) as AuditEventName[];

/** Returns true if a string is a registered audit event name. */
export function isKnownAuditEvent(name: string): name is AuditEventName {
  return Object.prototype.hasOwnProperty.call(AUDIT_EVENTS, name);
}

export interface AuditValidationIssue {
  name: string;
  reason: string;
  field?: string;
  expectedType?: AuditFieldType;
  actualType?: string;
}

/**
 * Structural validation of an audit payload against the registry. Returns
 * an array of issues (empty when valid). Always cheap — no schema-engine,
 * just a closed-enum lookup and a few typeof checks.
 *
 * Behavior:
 *   - Unknown event name → one issue, no required-field checks.
 *   - Missing required field → one issue per missing field.
 *   - Wrong type for required field → one issue per mismatched field.
 *   - Extra fields beyond required → IGNORED (registry is intentionally
 *     a permissive minimum schema).
 */
export function validateAudit(
  name: string,
  payload: Record<string, unknown>,
): AuditValidationIssue[] {
  const issues: AuditValidationIssue[] = [];
  if (!isKnownAuditEvent(name)) {
    issues.push({
      name,
      reason: `unknown_event — not in AUDIT_EVENTS registry`,
    });
    return issues;
  }
  const spec = AUDIT_EVENTS[name] as AuditEventSpec;
  const required = spec.required ?? [];
  for (const field of required) {
    if (!(field.name in payload)) {
      issues.push({
        name,
        reason: `missing_required_field`,
        field: field.name,
        expectedType: field.type,
      });
      continue;
    }
    const v = payload[field.name];
    const actualType = describeType(v);
    if (!typeMatches(field.type, v)) {
      issues.push({
        name,
        reason: `type_mismatch`,
        field: field.name,
        expectedType: field.type,
        actualType,
      });
    }
  }
  return issues;
}

/**
 * Assert the audit event is valid. Default: no-op (returns the payload
 * unchanged) — production audits must remain fast and never throw on a
 * minor mismatch. When `CAIA_VALIDATE_AUDIT=1` and at least one issue is
 * found, throws an Error so the dev catches it before deployment.
 *
 * The function returns the payload unchanged so call sites can wrap it:
 *   appendFileSync(file, JSON.stringify({ts, event: name, ...assertValidAudit(name, payload)}))
 */
export function assertValidAudit(
  name: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const strict = process.env['CAIA_VALIDATE_AUDIT'] === '1';
  if (!strict) return payload;
  const issues = validateAudit(name, payload);
  if (issues.length === 0) return payload;
  const summary = issues
    .map((i) =>
      i.field
        ? `${i.reason}(field=${i.field} expected=${i.expectedType} actual=${i.actualType ?? '-'})`
        : i.reason,
    )
    .join('; ');
  throw new Error(
    `[audit-schema] invalid audit event ${JSON.stringify(name)}: ${summary}`,
  );
}

/**
 * Build an AuditEvent object (timestamp + event + payload), validating in
 * dev. Returns the object — caller serializes. Production: same return,
 * no validation overhead beyond the env-var check.
 */
export function buildAuditEvent(
  name: string,
  payload: Record<string, unknown> = {},
): Record<string, unknown> {
  assertValidAudit(name, payload);
  return { ts: isoNow(), event: name, ...payload };
}

function typeMatches(expected: AuditFieldType, value: unknown): boolean {
  switch (expected) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
