/**
 * Verdict refiner — given a prior verdict + the latest Q/A pair, decides
 * whether the verdict is now final, and if not, what to ask next.
 *
 * Two strategies provided:
 *   1. HeuristicVerdictRefiner — deterministic; advances based on the
 *      Defender's recommended_action + confidence. Used as the default
 *      so the Reviewer is operable without a second LLM call per round.
 *      This is the fall-back the Coordinator wires when the operator-budget
 *      for LLM calls is tight.
 *   2. ClaudeVerdictRefiner — wraps an LLM call for nuanced refinement.
 *      Used when the verdict needs to escalate beyond pure heuristics.
 *
 * Test-only stubs are at the bottom.
 */

import type {
  RoundOneOutput,
  VerdictRefinerAdapter,
  VerdictRefinerInput,
  VerdictRefinerOutput
} from './types.js';

/** Default deterministic refiner. */
export class HeuristicVerdictRefiner implements VerdictRefinerAdapter {
  async refine(input: VerdictRefinerInput): Promise<VerdictRefinerOutput> {
    const { prior, answer, round, cap } = input;
    const updated: RoundOneOutput = { ...prior };

    // Defender explicitly escalated → propagate as escalation verdict.
    if (answer.recommended_action === 'escalate-to-operator') {
      updated.status = 'needs-clarification';
      updated.escalation_to_operator = {
        reason: `Defender escalated at round ${round}`,
        decisionPoint: input.question.question,
        recommendation:
          answer.notes_for_reviewer ??
          'Defender flagged this question as outside its scope; operator decision required.',
        category: 'strategic-direction-change'
      };
      return { verdict: updated };
    }

    // Defender acknowledged a defect → modify verdict to
    // approved-with-modifications (still terminal at the refiner level).
    if (answer.recommended_action === 'plan-needs-revision') {
      updated.status =
        prior.status === 'approved' || prior.status === 'approved-with-modifications'
          ? 'approved-with-modifications'
          : prior.status;
      if (!updated.requested_modifications.includes(answer.answer)) {
        updated.requested_modifications = [
          ...updated.requested_modifications,
          `(Round ${round}) ${answer.answer}`
        ];
      }
      return { verdict: updated };
    }

    // Defender said "plan-stands" with high/medium confidence → close round.
    if (answer.recommended_action === 'plan-stands' && answer.confidence !== 'low') {
      // If the prior status was needs-clarification, promote to approved.
      if (prior.status === 'needs-clarification') {
        updated.status = 'approved';
      }
      return { verdict: updated };
    }

    // Low-confidence "plan-stands" → ask one more clarifying question,
    // but only if we have rounds left.
    if (answer.confidence === 'low' && round < cap) {
      const followUp: VerdictRefinerOutput = {
        verdict: updated,
        next_question: `You answered with low confidence. Can you ground "${trimSentence(answer.answer)}" in a specific section of the plan or a source from the context dump?`
      };
      if (input.question.scope !== undefined) {
        followUp.next_question_scope = input.question.scope;
      }
      return followUp;
    }

    // Cap reached — terminal.
    if (round >= cap) {
      // Force best-available verdict.
      if (updated.status === 'needs-clarification') {
        updated.status = updated.requested_modifications.length > 0
          ? 'approved-with-modifications'
          : 'rejected';
        if (updated.status === 'rejected') {
          updated.reasoning = `${updated.reasoning} (Cap reached at round ${round} without a satisfactory clarification; rejecting on insufficient evidence.)`;
        }
      }
      return { verdict: updated };
    }

    return { verdict: updated };
  }
}

/** Stub for tests. */
export class StubVerdictRefiner implements VerdictRefinerAdapter {
  public calls: VerdictRefinerInput[] = [];
  constructor(private readonly outputs: VerdictRefinerOutput[]) {}
  async refine(input: VerdictRefinerInput): Promise<VerdictRefinerOutput> {
    this.calls.push(input);
    const i = Math.min(this.calls.length - 1, this.outputs.length - 1);
    const out = this.outputs[i];
    if (out === undefined) throw new Error('StubVerdictRefiner exhausted');
    return out;
  }
}

function trimSentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 80) return trimmed;
  return trimmed.slice(0, 80) + '…';
}
