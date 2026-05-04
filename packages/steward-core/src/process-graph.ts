/**
 * Process-graph schema — Zod definitions for the YAML-encoded process
 * definitions that the Steward Agent evaluates each cycle.
 *
 * One YAML file per process. Schema validated at load time. Hot-reloadable
 * (no daemon restart required for policy changes).
 *
 * Reference: devops-steward-agent-design-2026-05-03.md §3.2 + §5.
 */

import { z } from 'zod';
import { EventTypeSchema, RepoIdSchema } from './events.js';

/* ───────────────────────────────────────────────────────────────────────── *
 *  Severity + recovery                                                       *
 * ───────────────────────────────────────────────────────────────────────── */

export const ProcessSeveritySchema = z.enum(['low', 'medium', 'high']);
export type ProcessSeverity = z.infer<typeof ProcessSeveritySchema>;

/**
 * Recovery-action kinds. The actor module (P5+) maps each kind to one or
 * more Capability Broker tokens; the YAML names the *intent*, the code
 * implements the *mechanism*.
 *
 * In propose-only mode (P0–P4) every kind is rendered as an alert; no
 * mechanism runs.
 */
export const RecoveryKindSchema = z.enum([
  'open-back-merge-pr',
  'prune-worktree',
  'cancel-workflow',
  'restart-daemon',
  'rotate-secret',
  'create-release-tag',
  'alert-operator',
  'noop',
]);
export type RecoveryKind = z.infer<typeof RecoveryKindSchema>;

/* ───────────────────────────────────────────────────────────────────────── *
 *  Invariants — predicate-driven event emission                              *
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * An invariant rewrites or emits a derived event when a predicate matches.
 * The predicate is a small expression DSL (see predicate.ts).
 *
 * Example: when a PR merges with base=main and head matching ^release/,
 * emit a `release_landed` event whose payload includes the release SHA.
 */
export const InvariantSchema = z.object({
  /** Stable id within the process; used for diagnostic messages. */
  id: z.string().min(1),
  /** Predicate expression evaluated against the incoming event. */
  when: z.string().min(1),
  /** Canonical type of the event to emit when the predicate is true. */
  emit: EventTypeSchema,
  /**
   * Optional payload mapping. Each value is either a literal string or a
   * jsonpath-style accessor against the source event (`event.payload.foo`).
   * The lifecycle key (used to correlate events across a process instance)
   * defaults to the `correlationId` of the source event.
   */
  payload: z.record(z.string()).optional(),
});
export type Invariant = z.infer<typeof InvariantSchema>;

/* ───────────────────────────────────────────────────────────────────────── *
 *  Transitions — expected-next-event with deadlines                          *
 * ───────────────────────────────────────────────────────────────────────── */

export const OnMissSchema = z.object({
  severity: ProcessSeveritySchema,
  recovery_kind: RecoveryKindSchema,
  /** Free-form payload passed to the actor (or rendered into alerts). */
  recovery_payload: z.record(z.unknown()).optional(),
});
export type OnMiss = z.infer<typeof OnMissSchema>;

/**
 * A transition asserts: after we observe `from`, we must observe
 * `expected_next` within `deadline_min` minutes (for the same lifecycle
 * key — events are correlated by `correlationId`).
 *
 * Missing a deadline emits a `process_drift` event with the on_miss config.
 */
export const TransitionSchema = z.object({
  from: EventTypeSchema,
  expected_next: EventTypeSchema,
  /** Minutes from `from` event's observedAt until the deadline elapses. */
  deadline_min: z.number().int().positive(),
  on_miss: OnMissSchema,
});
export type Transition = z.infer<typeof TransitionSchema>;

/* ───────────────────────────────────────────────────────────────────────── *
 *  Process — the top-level YAML schema                                       *
 * ───────────────────────────────────────────────────────────────────────── */

export const ProcessSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/, 'process id must be kebab-case'),
  name: z.string().min(1),
  version: z.number().int().positive(),
  description: z.string().min(1),
  /** Repo scope. Default: all repos. */
  repos: z.array(RepoIdSchema).default(['*']),
  /** Whether this process is active. Disabled processes are loaded but skipped. */
  enabled: z.boolean().default(true),
  /**
   * Capability tokens the actor module would request when executing recovery
   * actions for this process. P0 propose-only: this list is informational
   * only; no tokens are issued.
   */
  recovery_capability_tokens: z.array(z.string()).default([]),
  /**
   * Canonical Steward event types this process subscribes to. The compliance
   * checker uses this to skip processes that aren't relevant to the current
   * cycle's events.
   */
  signals: z.array(EventTypeSchema).min(1),
  invariants: z.array(InvariantSchema).default([]),
  transitions: z.array(TransitionSchema).default([]),
});
export type Process = z.infer<typeof ProcessSchema>;

/* ───────────────────────────────────────────────────────────────────────── *
 *  Process-drift — what a missed transition produces                         *
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Output of `evaluateProcess`. When a transition deadline elapses without
 * the expected next event, this object is returned — to be persisted to the
 * `smart_cicd_observations` table by the daemon.
 */
export const ProcessDriftSchema = z.object({
  processId: z.string().min(1),
  processVersion: z.number().int().positive(),
  fromEventType: EventTypeSchema,
  expectedNext: EventTypeSchema,
  lifecycleKey: z.string().min(1),
  deadlineMin: z.number().int().positive(),
  detectedAt: z.number().int().nonnegative(),
  fromObservedAt: z.number().int().nonnegative(),
  severity: ProcessSeveritySchema,
  recoveryKind: RecoveryKindSchema,
  recoveryPayload: z.record(z.unknown()).optional(),
});
export type ProcessDrift = z.infer<typeof ProcessDriftSchema>;

/* ───────────────────────────────────────────────────────────────────────── *
 *  Validation helpers                                                        *
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Stricter validation that walks the process graph and asserts internal
 * consistency (every transition.from has a matching invariant.emit, etc.).
 *
 * Throws on the first inconsistency; callers should catch and report.
 */
export function validateProcessGraph(process: Process): void {
  const emittedTypes = new Set(process.invariants.map((i) => i.emit));
  for (const transition of process.transitions) {
    // The `from:` of a transition must be either:
    //   - emitted by one of this process's invariants, OR
    //   - a canonical event type from the signals list (for processes that
    //     transition directly off raw events without an invariant rewrite)
    if (
      !emittedTypes.has(transition.from) &&
      !process.signals.includes(transition.from)
    ) {
      throw new Error(
        `Process "${process.id}" v${process.version}: transition.from = ` +
          `"${transition.from}" is not emitted by any invariant nor declared ` +
          `in signals[]`,
      );
    }
  }
}
