/**
 * @caia/pipeline-conductor — drift-detector.ts
 *
 * Layer 5 of the AI-First Continuous Discipline framework
 * (research/ai_first_continuous_discipline_2026.md §7).
 *
 * The drift-detector is the *normalising adapter* between upstream drift
 * signals and the canonical Layer 5 event taxonomy. It subscribes to the
 * shared event bus and emits exactly three drift event types:
 *
 *   - policy.violation.detected
 *   - memory.consistency.broken
 *   - architecture.principle.violated
 *
 * Source mapping is intentionally permissive — the detector accepts
 * either fully-formed drift events (from in-process callers via the
 * direct `report*` API) OR upstream-shaped signals (legacy event names
 * from sibling packages) that it then re-publishes under the canonical
 * type. The re-emit guard prevents subscription loops by short-circuiting
 * any event whose actor is 'pipeline-conductor' itself.
 *
 * Subscription-only by design: no imports from @caia/policy-linter,
 * @caia/memory-consolidator, or @caia/ea-drift-sentinel. Loose coupling
 * via the event bus IS the contract (per P9 / P14).
 */

import { eventBus } from '@chiefaia/event-bus-internal';
import type { ConductorEvent } from '@chiefaia/event-bus-internal';

export interface DriftDetectorOptions {
  /** Event bus instance. Defaults to the shared `eventBus`. */
  bus?: typeof eventBus;
  /** Clock injection — tests stub. */
  clock?: () => Date;
  /**
   * Source-event globs the detector subscribes to. Each glob is matched
   * against the event `type`. Defaults below capture both the canonical
   * drift event names (for re-emit guard) and the most likely upstream
   * legacy names from sibling packages. Overridable for tests.
   */
  sourceGlobs?: {
    policyViolation?: string[];
    memoryInconsistency?: string[];
    principleViolation?: string[];
  };
}

/** Canonical payload shape for `policy.violation.detected`. */
export interface PolicyViolationInput {
  policy_id: string;
  dispatch_id: string;
  caller_agent_id: string;
  mode: 'hard-fail' | 'soft-fail' | 'advisory';
  reason: string;
  suggested_fix?: string;
  /** Optional correlation id propagated to the emitted event. */
  correlation_id?: string;
}

/** Canonical payload shape for `memory.consistency.broken`. */
export interface MemoryInconsistencyInput {
  memory_file: string;
  claim: string;
  actual: string;
  discovered_by: string;
  correlation_id?: string;
}

/** Canonical payload shape for `architecture.principle.violated`. */
export interface PrincipleViolationInput {
  principle_id: string;
  adr_id?: string;
  location: string;
  /** Optional ISO timestamp; defaults to detector clock. */
  detected_at?: string;
  correlation_id?: string;
}

export const DEFAULT_SOURCE_GLOBS = Object.freeze({
  policyViolation: Object.freeze([
    'policy.violation.detected',
    'policy-linter.violation',
    'policy-linter.violation.detected',
    'ea-policy.violation',
  ]),
  memoryInconsistency: Object.freeze([
    'memory.consistency.broken',
    'memory-consolidator.inconsistency-found',
    'memory-consolidator.claim-broken',
  ]),
  principleViolation: Object.freeze([
    'architecture.principle.violated',
    'ea-drift-sentinel.violation.confirmed',
    'ea-drift-sentinel.confirmed-violation',
  ]),
}) as Readonly<{
  policyViolation: ReadonlyArray<string>;
  memoryInconsistency: ReadonlyArray<string>;
  principleViolation: ReadonlyArray<string>;
}>;

/** Detector self-actor — used to short-circuit re-emit loops. */
export const DRIFT_DETECTOR_ACTOR = 'pipeline-conductor' as const;

export class DriftDetector {
  private readonly bus: typeof eventBus;
  private readonly clock: () => Date;
  private readonly sourceGlobs: {
    policyViolation: ReadonlyArray<string>;
    memoryInconsistency: ReadonlyArray<string>;
    principleViolation: ReadonlyArray<string>;
  };

  private unsubs: Array<() => void> = [];

  /** Telemetry counters (test-visible, never reset by stop). */
  public eventsObserved = 0;
  public policyViolationsEmitted = 0;
  public memoryInconsistenciesEmitted = 0;
  public principleViolationsEmitted = 0;
  public reemitLoopsBlocked = 0;
  public malformedSourceEvents = 0;

  constructor(opts: DriftDetectorOptions = {}) {
    this.bus = opts.bus ?? eventBus;
    this.clock = opts.clock ?? ((): Date => new Date());
    this.sourceGlobs = {
      policyViolation: opts.sourceGlobs?.policyViolation ?? DEFAULT_SOURCE_GLOBS.policyViolation,
      memoryInconsistency:
        opts.sourceGlobs?.memoryInconsistency ?? DEFAULT_SOURCE_GLOBS.memoryInconsistency,
      principleViolation:
        opts.sourceGlobs?.principleViolation ?? DEFAULT_SOURCE_GLOBS.principleViolation,
    };
  }

  /** Start subscribing. Idempotent. */
  start(): void {
    if (this.unsubs.length > 0) return;

    for (const glob of this.sourceGlobs.policyViolation) {
      this.unsubs.push(
        this.bus.subscribe(glob, (event) => this.handlePolicySource(event)),
      );
    }
    for (const glob of this.sourceGlobs.memoryInconsistency) {
      this.unsubs.push(
        this.bus.subscribe(glob, (event) => this.handleMemorySource(event)),
      );
    }
    for (const glob of this.sourceGlobs.principleViolation) {
      this.unsubs.push(
        this.bus.subscribe(glob, (event) => this.handlePrincipleSource(event)),
      );
    }
  }

  /** Stop subscribing. Idempotent. */
  stop(): void {
    for (const unsub of this.unsubs) {
      try { unsub(); } catch { /* never throw on stop */ }
    }
    this.unsubs = [];
  }

  // ─── Bus handlers ─────────────────────────────────────────────────────────

  private handlePolicySource(event: ConductorEvent): void {
    this.eventsObserved += 1;
    if (this.isOwnEmission(event)) {
      this.reemitLoopsBlocked += 1;
      return;
    }
    const input = this.coercePolicyInput(event);
    if (input === null) {
      this.malformedSourceEvents += 1;
      return;
    }
    this.reportPolicyViolation(input, event);
  }

  private handleMemorySource(event: ConductorEvent): void {
    this.eventsObserved += 1;
    if (this.isOwnEmission(event)) {
      this.reemitLoopsBlocked += 1;
      return;
    }
    const input = this.coerceMemoryInput(event);
    if (input === null) {
      this.malformedSourceEvents += 1;
      return;
    }
    this.reportMemoryInconsistency(input, event);
  }

  private handlePrincipleSource(event: ConductorEvent): void {
    this.eventsObserved += 1;
    if (this.isOwnEmission(event)) {
      this.reemitLoopsBlocked += 1;
      return;
    }
    const input = this.coercePrincipleInput(event);
    if (input === null) {
      this.malformedSourceEvents += 1;
      return;
    }
    this.reportPrincipleViolation(input, event);
  }

  // ─── Direct API (sync, for in-process callers / tests) ───────────────────

  /** Emit `policy.violation.detected`. Severity is `error` on hard-fail. */
  reportPolicyViolation(
    input: PolicyViolationInput,
    causedBy?: ConductorEvent,
  ): ConductorEvent {
    const severity = input.mode === 'hard-fail' ? 'error' : 'warning';
    const event = this.bus.publish({
      type: 'policy.violation.detected',
      actor: DRIFT_DETECTOR_ACTOR,
      severity,
      payload: {
        policy_id: input.policy_id,
        dispatch_id: input.dispatch_id,
        caller_agent_id: input.caller_agent_id,
        mode: input.mode,
        reason: input.reason,
        ...(input.suggested_fix !== undefined ? { suggested_fix: input.suggested_fix } : {}),
      },
      ...(input.correlation_id !== undefined
        ? { correlation_id: input.correlation_id }
        : causedBy?.correlation_id
          ? { correlation_id: causedBy.correlation_id }
          : {}),
      ...(causedBy ? { causation_id: causedBy.id } : {}),
      entity_type: 'policy',
      entity_id: input.policy_id,
    });
    this.policyViolationsEmitted += 1;
    return event;
  }

  /** Emit `memory.consistency.broken`. */
  reportMemoryInconsistency(
    input: MemoryInconsistencyInput,
    causedBy?: ConductorEvent,
  ): ConductorEvent {
    const event = this.bus.publish({
      type: 'memory.consistency.broken',
      actor: DRIFT_DETECTOR_ACTOR,
      severity: 'warning',
      payload: {
        memory_file: input.memory_file,
        claim: input.claim,
        actual: input.actual,
        discovered_by: input.discovered_by,
      },
      ...(input.correlation_id !== undefined
        ? { correlation_id: input.correlation_id }
        : causedBy?.correlation_id
          ? { correlation_id: causedBy.correlation_id }
          : {}),
      ...(causedBy ? { causation_id: causedBy.id } : {}),
      entity_type: 'memory-file',
      entity_id: input.memory_file,
    });
    this.memoryInconsistenciesEmitted += 1;
    return event;
  }

  /** Emit `architecture.principle.violated`. */
  reportPrincipleViolation(
    input: PrincipleViolationInput,
    causedBy?: ConductorEvent,
  ): ConductorEvent {
    const detectedAt = input.detected_at ?? this.clock().toISOString();
    const event = this.bus.publish({
      type: 'architecture.principle.violated',
      actor: DRIFT_DETECTOR_ACTOR,
      severity: 'error',
      payload: {
        principle_id: input.principle_id,
        ...(input.adr_id !== undefined ? { adr_id: input.adr_id } : {}),
        location: input.location,
        detected_at: detectedAt,
      },
      ...(input.correlation_id !== undefined
        ? { correlation_id: input.correlation_id }
        : causedBy?.correlation_id
          ? { correlation_id: causedBy.correlation_id }
          : {}),
      ...(causedBy ? { causation_id: causedBy.id } : {}),
      entity_type: 'principle',
      entity_id: input.principle_id,
    });
    this.principleViolationsEmitted += 1;
    return event;
  }

  // ─── Coercion (defensive parsing of upstream payloads) ───────────────────

  private isOwnEmission(event: ConductorEvent): boolean {
    return event.actor === DRIFT_DETECTOR_ACTOR;
  }

  private coercePolicyInput(event: ConductorEvent): PolicyViolationInput | null {
    const p = event.payload as Record<string, unknown>;
    const policy_id = pickString(p, ['policy_id', 'policyId', 'rule_id', 'ruleId']);
    const dispatch_id = pickString(p, ['dispatch_id', 'dispatchId', 'correlation_id']);
    const caller_agent_id = pickString(p, [
      'caller_agent_id', 'callerAgentId', 'caller', 'agent', 'agent_id', 'actor',
    ]) ?? event.actor;
    const mode = normaliseMode(pickString(p, ['mode', 'severity_mode', 'enforcement']));
    const reason = pickString(p, ['reason', 'message']);
    if (policy_id === null || dispatch_id === null || reason === null) return null;
    return {
      policy_id,
      dispatch_id,
      caller_agent_id,
      mode,
      reason,
      ...(pickString(p, ['suggested_fix', 'suggestion', 'fix']) !== null
        ? { suggested_fix: pickString(p, ['suggested_fix', 'suggestion', 'fix'])! }
        : {}),
      ...(event.correlation_id !== undefined ? { correlation_id: event.correlation_id } : {}),
    };
  }

  private coerceMemoryInput(event: ConductorEvent): MemoryInconsistencyInput | null {
    const p = event.payload as Record<string, unknown>;
    const memory_file = pickString(p, ['memory_file', 'memoryFile', 'file', 'path']);
    const claim = pickString(p, ['claim', 'expected', 'stated']);
    const actual = pickString(p, ['actual', 'reality', 'observed']);
    const discovered_by = pickString(p, ['discovered_by', 'discoveredBy', 'source']) ?? event.actor;
    if (memory_file === null || claim === null || actual === null) return null;
    return {
      memory_file,
      claim,
      actual,
      discovered_by,
      ...(event.correlation_id !== undefined ? { correlation_id: event.correlation_id } : {}),
    };
  }

  private coercePrincipleInput(event: ConductorEvent): PrincipleViolationInput | null {
    const p = event.payload as Record<string, unknown>;
    const principle_id = pickString(p, ['principle_id', 'principleId']);
    const location = pickString(p, ['location', 'file', 'path']);
    if (principle_id === null || location === null) return null;
    const adr_id = pickString(p, ['adr_id', 'adrId']);
    const detected_at = pickString(p, ['detected_at', 'detectedAt']);
    return {
      principle_id,
      location,
      ...(adr_id !== null ? { adr_id } : {}),
      ...(detected_at !== null ? { detected_at } : {}),
      ...(event.correlation_id !== undefined ? { correlation_id: event.correlation_id } : {}),
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function pickString(p: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = p[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function normaliseMode(v: string | null): 'hard-fail' | 'soft-fail' | 'advisory' {
  if (v === 'hard-fail' || v === 'soft-fail' || v === 'advisory') return v;
  if (v === 'hard' || v === 'error' || v === 'block') return 'hard-fail';
  if (v === 'soft' || v === 'warn' || v === 'warning') return 'soft-fail';
  return 'advisory';
}
