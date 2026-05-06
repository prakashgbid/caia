/**
 * Catastrophic-forgetting taxonomy + mitigation rules.
 */

export interface ForgettingViolation {
  readonly kind: 'baseline-regression' | 'retired-passing-prompt' | 'replay-undersize';
  readonly detail: string;
  readonly severity: 'warn' | 'error';
}

export interface ForgettingCheckInput {
  readonly regressedPrompts: ReadonlyArray<string>;
  readonly retiredPassingPrompts: ReadonlyArray<string>;
  readonly replayBufferFraction: number;
  readonly forgettingThreshold: number;
}

export function checkForgetting(
  input: ForgettingCheckInput
): ForgettingViolation[] {
  const out: ForgettingViolation[] = [];

  if (input.regressedPrompts.length > 0) {
    const fraction =
      input.regressedPrompts.length /
      Math.max(1, input.regressedPrompts.length + 1);
    out.push({
      kind: 'baseline-regression',
      detail:
        `Candidate regressed on ${input.regressedPrompts.length} prompt(s) ` +
        `that prior baseline passed. Fraction = ${fraction.toFixed(2)}, ` +
        `threshold = ${input.forgettingThreshold}.`,
      severity:
        fraction > input.forgettingThreshold ? 'error' : 'warn'
    });
  }

  if (input.retiredPassingPrompts.length > 0) {
    out.push({
      kind: 'retired-passing-prompt',
      detail:
        `${input.retiredPassingPrompts.length} prompt(s) retired from the ` +
        'canonical suite previously passed for the base or a blessed adapter. ' +
        'Retiring passing prompts requires operator approval (PR-gated).',
      severity: 'error'
    });
  }

  if (input.replayBufferFraction < 0.05) {
    out.push({
      kind: 'replay-undersize',
      detail:
        `Replay buffer is ${(input.replayBufferFraction * 100).toFixed(1)}% of ` +
        'the corpus, below the 5% floor. Increases catastrophic-forgetting risk.',
      severity: 'warn'
    });
  }

  return out;
}
