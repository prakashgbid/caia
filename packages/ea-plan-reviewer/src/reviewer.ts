/**
 * EaPlanReviewer — the multi-turn dialogue driver.
 *
 * Lifecycle per submission:
 *   1. Coordinator passes (submission, contextDump, context, spawner) to review().
 *   2. Reviewer spawns a Defender via spawner.spawn(submissionId, contextDump).
 *   3. Reviewer runs round-1 review using the inherited @caia/ea-architect critic.
 *   4. If round-1 emits next_question, Reviewer asks the Defender, runs the
 *      refiner on the answer, optionally asks another question, …
 *   5. Loop terminates on:
 *        (a) refiner emits no next_question (terminal verdict);
 *        (b) Defender escalates (spawner returns escalation);
 *        (c) iteration cap reached.
 *   6. Reviewer composes PlanReviewVerdict and returns it.
 *
 * All state lives in the spawner + the dialogue log; the Reviewer instance
 * itself is stateless across reviews, allowing concurrent submissions to
 * share one Reviewer.
 */

import { DEFENDER_ITERATION_CAP } from '@caia/plan-defender';

import { HeuristicVerdictRefiner } from './verdict-refiner.js';
import { createCriticBackedRoundOne } from './round-one-adapter.js';
import type {
  PlanReviewerConfig,
  PlanReviewerInput,
  PlanReviewVerdict,
  RoundOneOutput,
  RoundOneReviewerAdapter,
  VerdictRefinerAdapter
} from './types.js';

export class EaPlanReviewer {
  private readonly cap: number;
  private readonly roundOne: RoundOneReviewerAdapter;
  private readonly refiner: VerdictRefinerAdapter;
  private readonly clock: () => Date;

  constructor(cfg: PlanReviewerConfig = {}) {
    this.cap = cfg.iterationCap ?? DEFENDER_ITERATION_CAP;
    this.roundOne = cfg.roundOne ?? createCriticBackedRoundOne();
    this.refiner = cfg.refiner ?? new HeuristicVerdictRefiner();
    this.clock = cfg.clock ?? ((): Date => new Date());
  }

  /** Run the full review loop and return a terminal verdict. */
  async review(input: PlanReviewerInput): Promise<PlanReviewVerdict> {
    const { submission, contextDump, context, submissionId, iteration, spawner } = input;

    if (!spawner.isSpawned(submissionId)) {
      spawner.spawn(submissionId, contextDump);
    }

    let verdict = await this.roundOne.review({
      planMarkdown: submission.planMarkdown,
      planType: submission.planType,
      affectedComponents: submission.affectedComponents ?? [],
      context,
      iteration
    });

    let nextQuestion = verdict.next_question;
    let nextScope = verdict.next_question_scope;
    let round = 0;
    let defenderEscalation: PlanReviewVerdict['defenderEscalation'] | undefined;

    while (nextQuestion !== undefined && round < this.cap) {
      round += 1;
      const askResult = await spawner.askQuestion(submissionId, nextQuestion, {
        ...(nextScope !== undefined ? { scope: nextScope } : {})
      });
      if (askResult.escalation !== undefined) {
        defenderEscalation = askResult.escalation;
        if (verdict.escalation_to_operator === undefined) {
          verdict.escalation_to_operator = {
            reason: askResult.escalation.note,
            decisionPoint: askResult.escalation.question,
            recommendation: `Defender escalated at round ${round} (${askResult.escalation.kind}).`,
            category: 'strategic-direction-change'
          };
        }
        verdict.status = 'needs-clarification';
        break;
      }
      const refined = await this.refiner.refine({
        prior: verdict,
        question: {
          round,
          question: nextQuestion,
          ts: this.clock().toISOString(),
          ...(nextScope !== undefined ? { scope: nextScope } : {})
        },
        answer: askResult.answer,
        round,
        cap: this.cap
      });
      verdict = refined.verdict;
      nextQuestion = refined.next_question;
      nextScope = refined.next_question_scope;
      if (askResult.closed) break;
    }

    if (round >= this.cap && nextQuestion !== undefined && verdict.status === 'needs-clarification') {
      verdict = this.forceTerminalOnCap(verdict, round);
    }

    spawner.close(submissionId);
    const history = spawner.getHistory(submissionId);

    const out: PlanReviewVerdict = {
      status: verdict.status,
      reasoning: verdict.reasoning,
      cited_adrs: verdict.cited_adrs,
      cited_principles: verdict.cited_principles,
      cited_lessons: verdict.cited_lessons,
      requested_modifications: verdict.requested_modifications,
      new_adrs_to_file: verdict.new_adrs_to_file,
      affected_existing_adrs: verdict.affected_existing_adrs,
      defenderRoundsUsed: round,
      dialogue: history,
      dialogueLogPath: spawner.getDialogueLogPath(submissionId),
      reviewedAtIso: this.clock().toISOString(),
      ...(verdict.escalation_to_operator !== undefined
        ? { escalation_to_operator: verdict.escalation_to_operator }
        : {}),
      ...(defenderEscalation !== undefined ? { defenderEscalation } : {})
    };
    return out;
  }

  private forceTerminalOnCap(v: RoundOneOutput, round: number): RoundOneOutput {
    const out: RoundOneOutput = { ...v };
    if (out.requested_modifications.length > 0) {
      out.status = 'approved-with-modifications';
      out.reasoning = `${out.reasoning} (Cap reached at round ${round}; promoting to approved-with-modifications based on accumulated requested modifications.)`;
    } else {
      out.status = 'rejected';
      out.reasoning = `${out.reasoning} (Cap reached at round ${round} without a satisfactory clarification; rejecting on insufficient evidence.)`;
    }
    return out;
  }
}
