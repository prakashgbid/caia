/**
 * Pure decision logic — given the current state + canary status + corpus
 * delta, decide what action to take. NO I/O. Tests exhaustively cover
 * every input combination.
 *
 * The retrainer wraps this with the I/O sequence:
 *   read state → check canary → aggregate corpus → decide → execute → record
 */

import type {
  EvalAdapterReport,
  RegistryEntry,
  RetrainerStateFile
} from './types.js';

export interface DecisionInput {
  state: RetrainerStateFile;
  /** Active canary entry (from ApprenticeServing.currentCanary()), if any. */
  currentCanary: RegistryEntry | undefined;
  /** Active production entry (from ApprenticeServing.currentProduction()), if any. */
  currentProduction: RegistryEntry | undefined;
  /** Now, in ms since epoch. */
  nowMs: number;
  /** Force flag — skip 'skipped-*' short-circuits. */
  force: boolean;
  // — thresholds —
  retrainThreshold: number;
  retrainMaxAgeMs: number;
  canaryHoldDays: number;
}

export type Decision =
  | { kind: 'skip-canary-active'; daysHeld: number }
  | { kind: 'prompt-operator-canary-held'; daysHeld: number }
  | { kind: 'skip-no-delta'; deltaCount: number; lastTrainAt: string | null }
  | { kind: 'aggregate-and-train' };

export interface PostTrainDecisionInput {
  evalReport: EvalAdapterReport | undefined;
  evalWinRateGate: number;
}

export type PostTrainDecision =
  | { kind: 'promote-canary' }
  | { kind: 'reject-no-eval'; reason: string }
  | { kind: 'reject-low-winrate'; reason: string; winRate: number }
  | { kind: 'reject-regressions'; reason: string; flags: string[] };

/** Pre-train: should we even kick off corpus aggregation + training? */
export function preTrainDecision(input: DecisionInput): Decision {
  // Canary check — owns precedence regardless of force.
  if (input.currentCanary !== undefined) {
    const promotedAt = input.currentCanary.promotedAt ?? input.currentCanary.registeredAt;
    const ageMs = input.nowMs - new Date(promotedAt).getTime();
    const daysHeld = Math.floor(ageMs / (24 * 60 * 60 * 1000));
    if (daysHeld < input.canaryHoldDays) {
      if (input.force) {
        // Even with force, we don't override an active canary — that
        // would create dual canaries (registry invariant 2). Operator
        // must reject the canary first.
        return { kind: 'skip-canary-active', daysHeld };
      }
      return { kind: 'skip-canary-active', daysHeld };
    }
    return { kind: 'prompt-operator-canary-held', daysHeld };
  }

  if (input.force) {
    return { kind: 'aggregate-and-train' };
  }

  // No canary; check delta + age thresholds.
  const lastTrain = input.state.lastSuccessfulTrain;
  if (lastTrain === null) {
    // Never trained — kick off.
    return { kind: 'aggregate-and-train' };
  }
  const ageMs = input.nowMs - new Date(lastTrain.at).getTime();
  if (ageMs >= input.retrainMaxAgeMs) {
    return { kind: 'aggregate-and-train' };
  }

  // We don't have delta yet at decision time — caller checks delta only
  // when we return 'aggregate-and-train'. Default to skip when last
  // train is recent and no max-age trip.
  return {
    kind: 'skip-no-delta',
    deltaCount: 0,
    lastTrainAt: lastTrain.at
  };
}

/** Helper: post-aggregate, did we get enough delta? */
export function shouldRetrainGivenDelta(
  deltaCount: number,
  threshold: number,
  forceOrAge: boolean
): boolean {
  if (forceOrAge) return true;
  return deltaCount >= threshold;
}

/** Post-train: given the eval report, promote-canary or reject? */
export function postTrainDecision(input: PostTrainDecisionInput): PostTrainDecision {
  if (input.evalReport === undefined) {
    // No eval harness or eval failed — conservative: reject. Operator
    // can manually promote if they want.
    return {
      kind: 'reject-no-eval',
      reason:
        'eval harness not configured or eval failed; conservative auto-reject. ' +
        'operator can manually promote-canary if desired.'
    };
  }
  if (input.evalReport.regressionFlags.length > 0) {
    return {
      kind: 'reject-regressions',
      reason: `eval flagged regressions on ${input.evalReport.regressionFlags.length} canonical prompts`,
      flags: input.evalReport.regressionFlags
    };
  }
  if (input.evalReport.winRate < input.evalWinRateGate) {
    return {
      kind: 'reject-low-winrate',
      reason: `eval winRate=${input.evalReport.winRate.toFixed(3)} below gate=${input.evalWinRateGate}`,
      winRate: input.evalReport.winRate
    };
  }
  return { kind: 'promote-canary' };
}
