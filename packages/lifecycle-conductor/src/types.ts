/**
 * @caia/lifecycle-conductor — core type definitions.
 *
 * Sourced from `research/real_definition_of_done_enforcement_2026.md`
 *   - §4.4 (Layer 4 responsibility surface)
 *   - §6 (the 11-stage solution-lifecycle state machine and its
 *     transition triggers — the conductor uses the canonical-doc
 *     vocabulary for composite states, while the underlying FSM in
 *     `@caia/state-machine` uses the operator vocabulary; the mapping
 *     lives in `fsm.ts` via `SOLUTION_STATE_CANONICAL_SYNONYM`).
 *   - §12 Task A9 (the build task this package implements).
 *
 * Kept in a single module so every other module imports from one
 * source-of-truth and there are no cycles. The shape mirrors the
 * sibling `@caia/activation-steward` package's `types.ts` so the two
 * are easy to read side-by-side.
 */

// ─── Steward names ──────────────────────────────────────────────────────────

/**
 * The five stewards the conductor aggregates. `future-incoming` is the
 * Layer-3.5 steward that gates "are there outstanding research / spec
 * commitments that should keep this solution out of DONE even when the
 * other four greens light?" — same ordinal as `outcome`.
 */
export const STEWARD_NAMES = [
  'deploy',
  'usage',
  'activation',
  'outcome',
  'future-incoming',
] as const;

export type StewardName = (typeof STEWARD_NAMES)[number];

const STEWARD_NAMES_SET = new Set<string>(STEWARD_NAMES);

export function isStewardName(value: unknown): value is StewardName {
  return typeof value === 'string' && STEWARD_NAMES_SET.has(value);
}

// ─── Attestation envelope ───────────────────────────────────────────────────

/**
 * Per-steward attestation. The conductor consumes one of these per
 * (solution, steward) at every steward tick.
 *
 * The shape mirrors `StewardAttestation` in
 * `@caia/state-machine/entities/solution-types` — but the conductor
 * does NOT depend on `@caia/state-machine` for the type, because the
 * stewards emit attestations directly into the conductor's event bus
 * (Layer-2-and-up: subscription-only). Cross-package compatibility is
 * guaranteed by `attestationToFsmAttestation` in `aggregator.ts` which
 * widens the shape if/when a steward also routes through the FSM.
 */
export interface StewardAttestation {
  /** Which steward emitted this. */
  steward: StewardName;
  /** Solution this attestation is for. */
  solutionId: string;
  /** Traffic-light status. */
  status: 'green' | 'amber' | 'red';
  /** ISO timestamp the steward produced this attestation. */
  observedAt: string;
  /** Optional run id from the steward's own JSONL log. */
  runId?: string;
  /** Optional free-form note (e.g. "metric trend negative"). */
  note?: string;
  /** Optional metric/evidence payload. */
  evidence?: Record<string, unknown>;
}

// ─── Composite state vocabulary ─────────────────────────────────────────────

/**
 * Forward-chain composite states. Names mirror the canonical doc §6.1:
 *   plan-approved → pr-merged → deployed → built-into-active-app
 *   → called-in-test → producing-metrics
 *
 * (The existing project FSM tracks `code-written`, `pr-opened`,
 * `called-in-prod` and `done` as separate states in the operator
 * vocabulary; the conductor folds them into the canonical-doc
 * vocabulary for composite-state purposes. The operator-vocab walk is
 * still driven faithfully through the underlying FSM — see
 * `aggregator.ts`.)
 */
export const FORWARD_COMPOSITE_STATES = [
  'plan-approved',
  'pr-merged',
  'deployed',
  'built-into-active-app',
  'called-in-test',
  'producing-metrics',
] as const;

export type ForwardCompositeState = (typeof FORWARD_COMPOSITE_STATES)[number];

/**
 * Orthogonal sticky states per spec §6.1 + §6.2.
 *
 * - `degraded`: entered on any red attestation; clears only after the
 *   configured `degradedClearThreshold` (default 3) consecutive
 *   all-five-green ticks. Defined as "middleware" in the spec — it
 *   sits between the forward states and acts as a regression sink.
 * - `sunset`: terminal, operator-driven.
 */
export const STICKY_COMPOSITE_STATES = ['degraded', 'sunset'] as const;
export type StickyCompositeState = (typeof STICKY_COMPOSITE_STATES)[number];

export type CompositeState = ForwardCompositeState | StickyCompositeState;

export const ALL_COMPOSITE_STATES = [
  ...FORWARD_COMPOSITE_STATES,
  ...STICKY_COMPOSITE_STATES,
] as const;

const COMPOSITE_STATE_SET = new Set<string>(ALL_COMPOSITE_STATES);

export function isCompositeState(value: unknown): value is CompositeState {
  return typeof value === 'string' && COMPOSITE_STATE_SET.has(value);
}

/** Terminal composite states. `producing-metrics` is the DoD-candidate
 * terminal-success state but only counts as DONE after the 24h holdover
 * (enforced at the API layer); `sunset` is the operator-abandoned
 * terminal. */
export const TERMINAL_COMPOSITE_STATES: readonly CompositeState[] = ['sunset'];

export function isTerminalComposite(state: CompositeState): boolean {
  return TERMINAL_COMPOSITE_STATES.includes(state);
}

// ─── Freshness windows ──────────────────────────────────────────────────────

/**
 * Default per-steward freshness windows in hours. An attestation is
 * "fresh" iff its `observedAt` is within `now - hours` of the
 * conductor's clock. Out-of-window attestations are treated as `stale`
 * by the gate evaluator regardless of their traffic-light status.
 *
 * The numbers come from the canonical doc §5 (the per-solution
 * manifest's `verifier_freshness_thresholds`). The `futureIncoming`
 * window is set generously because incoming-research stewardship
 * does not have a per-hour rhythm — it's a daily review.
 */
export const DEFAULT_FRESHNESS_HOURS = Object.freeze({
  deploy: 2,
  usage: 4,
  activation: 6,
  outcome: 24,
  futureIncoming: 72,
} as const);

/**
 * Resolve per-steward freshness windows from a partial override. Keys
 * are the camelCase variants in {@link DEFAULT_FRESHNESS_HOURS} (the
 * `future-incoming` steward's key is `futureIncoming` for consistency
 * with the rest of the camelCase config surface). Returns a fully
 * populated map keyed by the kebab-case steward names — that's the
 * shape `evaluateForwardChain` and `decideTransition` consume.
 */
export function resolveFreshnessHours(
  override: Partial<Record<keyof typeof DEFAULT_FRESHNESS_HOURS, number>> = {},
): Record<StewardName, number> {
  const merged = { ...DEFAULT_FRESHNESS_HOURS, ...override };
  return {
    deploy: merged.deploy,
    usage: merged.usage,
    activation: merged.activation,
    outcome: merged.outcome,
    'future-incoming': merged.futureIncoming,
  };
}

// ─── Aggregator-internal state ──────────────────────────────────────────────

/**
 * Per-solution accumulator the aggregator maintains in memory. Pure
 * data — no methods. Mutated by the aggregator on every incoming
 * attestation.
 */
export interface SolutionAccumulator {
  solutionId: string;
  /** Most-recent attestation per steward, null if never observed. */
  rows: Record<StewardName, StewardAttestation | null>;
  /** Current conductor composite-state. Stored separately from the
   * underlying FSM operator-state so the conductor can avoid driving
   * the FSM on no-op ticks. */
  compositeState: CompositeState;
  /** Number of consecutive all-five-green-and-fresh ticks. Used both
   * to clear `degraded` and to track the 24h `producing-metrics`
   * holdover. */
  consecutiveGreensAcrossAllStewards: number;
  /** When the holdover countdown most-recently started (i.e. the
   * timestamp at which we last transitioned INTO `producing-metrics`).
   * null if the solution has never reached `producing-metrics`. */
  producingMetricsSinceMs: number | null;
  /** True if `degraded` fired at any time during the current
   * `producing-metrics` holdover. Resets when the holdover restarts. */
  driftDuringHoldover: boolean;
  /** Hashable trigger from the last evaluate-pass; used by the
   * aggregator to format event-bus + INBOX entries. */
  lastTrigger: string;
}

// ─── DoD math ───────────────────────────────────────────────────────────────

/**
 * `producing-metrics` holdover requirement (hours) before a solution
 * is considered DONE per spec §6.3. The aggregator + API enforce this
 * as a soft barrier on top of the composite state.
 */
export const PRODUCING_METRICS_HOLDOVER_HOURS = 24;

export interface DodStatus {
  solutionId: string;
  /** True iff composite == 'producing-metrics' AND holdover >= 24h
   * AND no degraded event during the holdover. */
  done: boolean;
  compositeState: CompositeState;
  /** Hours remaining in the producing-metrics holdover. Zero if the
   * holdover is complete (and `done = true`). null if the solution
   * has never reached producing-metrics. */
  holdoverHoursRemaining: number | null;
  /** Per-steward miss reason; populated for every steward whose row
   * is currently red, stale, or null. */
  missing: Partial<Record<StewardName, 'red' | 'stale' | 'missing' | 'amber'>>;
  /** True iff any degraded event fired during the current holdover. */
  driftDuringHoldover: boolean;
}

// ─── Conductor configuration ────────────────────────────────────────────────

export interface LifecycleConductorOptions {
  /** Clock for tests. */
  now?: () => Date;
  /** Per-steward freshness window overrides. */
  freshnessHoursOverride?: Partial<Record<keyof typeof DEFAULT_FRESHNESS_HOURS, number>>;
  /** Threshold of consecutive all-green ticks before `degraded`
   * clears. Default 3 (per canonical doc §6.2). */
  degradedClearThreshold?: number;
  /** Optional hook the aggregator calls every time it determines a
   * solution's composite state has changed. Useful for tests and for
   * the dashboard projector to emit SSE without depending on the
   * full event-bus. */
  onCompositeStateChanged?: (event: CompositeStateChangedEvent) => void;
}

export interface CompositeStateChangedEvent {
  solutionId: string;
  fromState: CompositeState;
  toState: CompositeState;
  trigger: string;
  /** Snapshot of the per-steward attestation rows that drove this
   * transition. The aggregator clones before passing this out so
   * callers can hold on to it. */
  rowsSnapshot: Record<StewardName, StewardAttestation | null>;
  /** Conductor clock at the time of the transition. ISO-8601. */
  at: string;
}
