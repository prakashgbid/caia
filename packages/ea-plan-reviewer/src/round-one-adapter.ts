/**
 * Round-1 adapter — wraps the inherited @caia/ea-architect critic so the
 * Plan Reviewer can reuse the existing single-pass review machinery as
 * its first round, then optionally drive multi-turn dialogue from there.
 *
 * The current single-pass critic returns a structured ReviewOutcome that
 * matches RoundOneOutput's shape almost exactly. The only addition is
 * the optional `next_question` field — round-1 doesn't ask follow-ups by
 * default (the Reviewer module decides whether to escalate to a Defender
 * question based on the verdict).
 */

import {
  applyHallucinationGuard,
  createDefaultCritic,
  type CriticAdapter,
  type RelevantContext
} from '@caia/ea-architect';

import type {
  RoundOneInput,
  RoundOneOutput,
  RoundOneReviewerAdapter
} from './types.js';

export interface CriticBackedRoundOneConfig {
  /** Critic override. Defaults to createDefaultCritic(). */
  critic?: CriticAdapter;
  /** Sets of known ids for hallucination guarding. */
  allKnownAdrIds?: ReadonlySet<string>;
  allKnownPrincipleIds?: ReadonlySet<string>;
  allKnownLessonIds?: ReadonlySet<string>;
  /** Pre-loaded RelevantContext if Coordinator wants to reuse one. */
  preloadedContext?: RelevantContext;
}

/**
 * Round-1 adapter backed by the @caia/ea-architect critic. This is the
 * production path; tests substitute a StubRoundOneAdapter.
 */
export function createCriticBackedRoundOne(cfg: CriticBackedRoundOneConfig = {}): RoundOneReviewerAdapter {
  const critic = cfg.critic ?? createDefaultCritic();
  return {
    async review(input: RoundOneInput): Promise<RoundOneOutput> {
      const out = await critic.review({
        planMarkdown: input.planMarkdown,
        planType: input.planType,
        affectedComponents: input.affectedComponents,
        context: input.context,
        iteration: input.iteration,
        modelTier: 'sonnet' // Round-1 always Sonnet; refiner may escalate to Opus
      });
      const guarded = applyHallucinationGuard(
        out,
        input.context,
        cfg.allKnownAdrIds ?? new Set<string>(),
        cfg.allKnownPrincipleIds ?? new Set<string>(),
        cfg.allKnownLessonIds ?? new Set<string>()
      );
      const result: RoundOneOutput = {
        status: guarded.status,
        reasoning: guarded.reasoning,
        cited_adrs: guarded.cited_adrs,
        cited_principles: guarded.cited_principles,
        cited_lessons: guarded.cited_lessons,
        requested_modifications: guarded.requested_modifications,
        new_adrs_to_file: guarded.new_adrs_to_file,
        affected_existing_adrs: guarded.affected_existing_adrs,
        ...(guarded.escalation_to_operator !== undefined
          ? { escalation_to_operator: guarded.escalation_to_operator }
          : {})
      };
      // Heuristic next-question generation: if status is needs-clarification
      // and there are requested_modifications, the first modification text
      // becomes the round-2 question.
      if (
        result.status === 'needs-clarification' &&
        result.requested_modifications.length > 0
      ) {
        const first = result.requested_modifications[0];
        if (first !== undefined) {
          result.next_question = `Please clarify: ${first}`;
          result.next_question_scope = 'review-modification-#1';
        }
      }
      return result;
    }
  };
}

/** Test/stub adapter — returns the configured output. */
export class StubRoundOneAdapter implements RoundOneReviewerAdapter {
  public calls: RoundOneInput[] = [];
  constructor(private readonly output: RoundOneOutput) {}
  async review(input: RoundOneInput): Promise<RoundOneOutput> {
    this.calls.push(input);
    return this.output;
  }
}
