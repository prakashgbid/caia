/**
 * @caia/lifecycle-conductor — pure FSM decision module.
 *
 * Two pure functions and one default-driver object:
 *
 *   - `evaluateForwardChain(rows, freshnessHours, now)`
 *       Computes the highest forward composite state the current
 *       attestation matrix justifies. Also reports anyRed / anyStale
 *       flags so the caller can pick `degraded` over a forward state.
 *
 *   - `decideTransition({ currentState, evaluation, consecutiveGreens…,
 *                         degradedClearThreshold })`
 *       Combines the forward-chain evaluation with the current
 *       composite state and the `degraded` sticky-state machine to
 *       decide the next composite state.
 *
 *   - `DefaultFsmDriver = { evaluate, decide }`
 *       The driver object the aggregator + API consume.
 *
 * Per ADR-063 the forward-chain gates the **four Real-DoD stewards**
 * only (deploy + usage + activation + outcome). The orthogonal
 * `ea-review-approved` state is enforced at the DoD layer (see
 * `aggregator.ts:computeDod`), not here — approval doesn't gate
 * forward progress, only the final DONE verdict.
 *
 * Why pure? The conductor's correctness is composability-critical
 * (each test asserts a single decision). Centralising the decision
 * surface in a pair of pure functions makes the FSM trivially
 * replayable from any persisted attestation log, which we use for
 * the integration test and which the migration cron will use
 * (Task A12) to backfill historical solutions.
 */

import {
  FORWARD_COMPOSITE_STATES,
  STEWARD_NAMES,
  isTerminalComposite,
  type CompositeState,
  type ForwardCompositeState,
  type StewardAttestation,
  type StewardName,
} from './types.js';

// ─── Gate ordinals ──────────────────────────────────────────────────────────

/**
 * Per-steward gate ordinal. The conductor walks the forward chain by
 * comparing each composite state's *required* ordinal against the
 * highest ordinal currently satisfied by green+fresh attestations.
 *
 * Contract (asserted by tests):
 *   0 < deploy < usage < activation < outcome
 *
 * Each steward gates exactly one forward state — outcome alone gates
 * `producing-metrics`. (PR #580's 5-steward version had outcome AND
 * future-incoming both at ordinal 9 with a special-case OR rule; per
 * ADR-063 that special-case is removed.)
 */
export const STEWARD_GATE_ORDINAL: Readonly<Record<StewardName, number>> = Object.freeze({
  deploy: 3,
  usage: 5,
  activation: 7,
  outcome: 9,
});

/**
 * Forward composite state → ordinal. The ordinal is the minimum
 * steward-ordinal that must be met to enter the state.
 *
 *  plan-approved (0): start state — no attestations needed.
 *  pr-merged    (1): any attestation has been observed (the solution
 *                    has "moved" past plan-approved) but deploy is not
 *                    yet green+fresh.
 *  deployed     (3): deploy steward is green+fresh.
 *  built-into-
 *    active-app (5): deploy + usage green+fresh.
 *  called-in-
 *    test       (7): deploy + usage + activation green+fresh.
 *  producing-
 *    metrics    (9): all four (deploy + usage + activation + outcome)
 *                    green+fresh.
 */
export const FORWARD_STATE_ORDINAL: Readonly<Record<ForwardCompositeState, number>> =
  Object.freeze({
    'plan-approved': 0,
    'pr-merged': 1,
    deployed: 3,
    'built-into-active-app': 5,
    'called-in-test': 7,
    'producing-metrics': 9,
  });

/**
 * Reverse lookup: given a gate ordinal, return the highest forward
 * state whose required ordinal is <= the given value. Used by
 * `evaluateForwardChain` to translate "the highest gate satisfied" to
 * a composite state.
 */
function ordinalToForwardState(ordinal: number): ForwardCompositeState {
  let pick: ForwardCompositeState = 'plan-approved';
  for (const s of FORWARD_COMPOSITE_STATES) {
    if (FORWARD_STATE_ORDINAL[s] <= ordinal) pick = s;
  }
  return pick;
}

// ─── evaluateForwardChain ───────────────────────────────────────────────────

export interface ForwardChainEvaluation {
  /** Highest forward composite state the current attestation matrix
   * justifies under the green+fresh gating rule. */
  highestForwardState: ForwardCompositeState;
  /** Per-steward boolean: true iff that steward is green AND fresh.
   * False if red, amber, stale, or null. */
  perStewardPass: Record<StewardName, boolean>;
  /** True iff ANY steward's most-recent attestation is red. */
  anyRed: boolean;
  /** True iff ANY steward's most-recent attestation is non-null but
   * older than its freshness window. */
  anyStale: boolean;
  /** Human-readable trigger string explaining the evaluation result.
   * The aggregator uses this verbatim as the `reason` on the FSM
   * advance call, so the audit log reads naturally. */
  trigger: string;
}

/**
 * Pure evaluator. Given the current attestation rows + freshness
 * thresholds + a clock, returns the highest forward composite state
 * justified plus the red/stale flags the caller uses to choose
 * between forward / degraded / no-change.
 */
export function evaluateForwardChain(
  rows: Record<StewardName, StewardAttestation | null>,
  freshnessHours: Record<StewardName, number>,
  now: Date,
): ForwardChainEvaluation {
  const perStewardPass: Record<StewardName, boolean> = {
    deploy: false,
    usage: false,
    activation: false,
    outcome: false,
  };
  const triggerParts: string[] = [];
  let anyRed = false;
  let anyStale = false;
  let anyObserved = false;

  const nowMs = now.getTime();
  for (const steward of STEWARD_NAMES) {
    const row = rows[steward];
    if (row === null) {
      // Not yet observed — does not count as anyRed/anyStale.
      continue;
    }
    anyObserved = true;
    const observedMs = Date.parse(row.observedAt);
    if (Number.isNaN(observedMs)) {
      // Malformed timestamp — treat as stale (defensive).
      anyStale = true;
      triggerParts.push(`${steward}.malformed-observedAt`);
      continue;
    }
    const ageHours = (nowMs - observedMs) / 3_600_000;
    const isFresh = ageHours <= freshnessHours[steward];

    if (row.status === 'red') {
      anyRed = true;
      triggerParts.push(`${steward}.red`);
      continue;
    }
    if (!isFresh) {
      anyStale = true;
      triggerParts.push(`${steward}.stale`);
      continue;
    }
    if (row.status === 'amber') {
      // Amber doesn't advance the gate but it isn't a regression either.
      triggerParts.push(`${steward}.amber`);
      continue;
    }
    // green + fresh
    perStewardPass[steward] = true;
  }

  // Translate per-steward passes to a satisfied gate ordinal.
  // Strategy: walk the steward gate ordinals in ascending order; the
  // highest ordinal we have continuously satisfied is the gate. (We
  // can't skip over a non-green gate — usage being green doesn't
  // count as deploy being green.)
  const ordered = [...STEWARD_NAMES].sort(
    (a, b) => STEWARD_GATE_ORDINAL[a] - STEWARD_GATE_ORDINAL[b],
  );
  let satisfiedOrdinal = 0;
  for (const steward of ordered) {
    if (perStewardPass[steward]) {
      satisfiedOrdinal = STEWARD_GATE_ORDINAL[steward];
    } else {
      break;
    }
  }

  let highestForwardState = ordinalToForwardState(satisfiedOrdinal);
  // Special-case: if we satisfied ZERO gates but some attestation has
  // been observed (e.g. amber/stale), advance to pr-merged so the
  // dashboard reflects that the solution is "in flight". This matches
  // the canonical doc §6.1's intent that pr-merged is "the solution
  // has left plan-approved but no gate has cleared yet".
  if (satisfiedOrdinal === 0 && anyObserved) {
    highestForwardState = 'pr-merged';
  }

  if (triggerParts.length === 0) {
    triggerParts.push(
      anyObserved ? 'observations-present-no-gates-cleared' : 'no-observations',
    );
  }

  return {
    highestForwardState,
    perStewardPass,
    anyRed,
    anyStale,
    trigger: triggerParts.join(','),
  };
}

// ─── decideTransition ───────────────────────────────────────────────────────

export interface DecideTransitionInput {
  currentState: CompositeState;
  evaluation: ForwardChainEvaluation;
  /** Consecutive all-four-green-and-fresh ticks. The aggregator
   * increments this on every all-green evaluation and resets it on
   * any anyRed / anyStale / missing attestation. */
  consecutiveGreensAcrossAllStewards: number;
  /** Default 3 (per canonical doc §6.2). */
  degradedClearThreshold: number;
}

export interface TransitionDecision {
  /** The new composite state. May equal currentState (no-op). */
  newState: CompositeState;
  /** True iff this is a forward → degraded transition. */
  isDrift: boolean;
  /** True iff this is a backward forward → earlier-forward transition. */
  isRegression: boolean;
  /** Trigger string for the audit log. */
  trigger: string;
}

/**
 * Pure decider. Inputs:
 *   - `currentState`: where the FSM currently sits.
 *   - `evaluation`: the forward-chain evaluator's verdict.
 *   - `consecutiveGreensAcrossAllStewards`: the aggregator's tally.
 *   - `degradedClearThreshold`: how many greens before we leave degraded.
 *
 * Rules (in evaluation order):
 *   1. Terminals are sticky (`sunset`).
 *   2. Any-red → degraded, drift event.
 *   3. In degraded with greens < threshold → stay degraded.
 *   4. In degraded with greens >= threshold AND no red → clear to the
 *      evaluation's forward state.
 *   5. Forward → forward: advance, no-change, or regress based on
 *      ordinal comparison.
 */
export function decideTransition(input: DecideTransitionInput): TransitionDecision {
  const { currentState, evaluation, consecutiveGreensAcrossAllStewards, degradedClearThreshold } =
    input;

  // 1. Terminals are sticky.
  if (isTerminalComposite(currentState)) {
    return {
      newState: currentState,
      isDrift: false,
      isRegression: false,
      trigger: 'terminal',
    };
  }

  // 2. Any-red → degraded.
  if (evaluation.anyRed) {
    if (currentState === 'degraded') {
      return {
        newState: 'degraded',
        isDrift: false,
        isRegression: false,
        trigger: `degraded-sticky-red:${evaluation.trigger}`,
      };
    }
    return {
      newState: 'degraded',
      isDrift: true,
      isRegression: false,
      trigger: `drift-to-degraded:${evaluation.trigger}`,
    };
  }

  // 3 + 4. Degraded sticky / clear logic.
  if (currentState === 'degraded') {
    if (
      consecutiveGreensAcrossAllStewards >= degradedClearThreshold &&
      !evaluation.anyStale
    ) {
      return {
        newState: evaluation.highestForwardState,
        isDrift: false,
        isRegression: false,
        trigger: `degraded-cleared-after-${consecutiveGreensAcrossAllStewards}-greens`,
      };
    }
    return {
      newState: 'degraded',
      isDrift: false,
      isRegression: false,
      trigger: `degraded-sticky:greens=${consecutiveGreensAcrossAllStewards}/${degradedClearThreshold}`,
    };
  }

  // 5. Forward → forward.
  const evalOrdinal =
    FORWARD_STATE_ORDINAL[evaluation.highestForwardState];
  // `currentState` is a forward state at this point (terminals + degraded
  // handled above). Cast is safe because TERMINAL_COMPOSITE_STATES + ['degraded']
  // is the complement of FORWARD_COMPOSITE_STATES.
  const currentOrdinal = FORWARD_STATE_ORDINAL[currentState as ForwardCompositeState];

  if (evalOrdinal > currentOrdinal) {
    return {
      newState: evaluation.highestForwardState,
      isDrift: false,
      isRegression: false,
      trigger: `forward-advance:${evaluation.trigger}`,
    };
  }
  if (evalOrdinal < currentOrdinal) {
    // No red but a previously-satisfied gate became stale/missing.
    // Per spec §6.2, this is a regression — fold it into `degraded`
    // so the operator sees it.
    return {
      newState: 'degraded',
      isDrift: false,
      isRegression: true,
      trigger: `regression-detected:${evaluation.trigger}`,
    };
  }
  return {
    newState: currentState,
    isDrift: false,
    isRegression: false,
    trigger: 'no-change',
  };
}

// ─── Default driver ─────────────────────────────────────────────────────────

/**
 * The driver the aggregator + API instantiate. Bundling the two pure
 * functions into an object lets callers inject a custom driver in
 * tests (e.g. to force a particular evaluation outcome).
 */
export const DefaultFsmDriver = {
  evaluate: evaluateForwardChain,
  decide: decideTransition,
} as const;

export type FsmDriver = typeof DefaultFsmDriver;
