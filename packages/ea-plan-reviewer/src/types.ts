/**
 * @caia/ea-plan-reviewer — public type surface.
 *
 * The Plan Reviewer reads a submitted plan (research / spec / implementation /
 * architecture-change / process-change), against the EA Repository, and
 * iterates with the Plan Defender until a terminal verdict is reached or
 * the 5-round cap fires.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §4.2.
 */

import type {
  AffectedAdr,
  NewAdrDraft,
  OperatorEscalation,
  PlanSubmission,
  PlanType,
  RelevantContext,
  ReviewStatus
} from '@caia/ea-architect';
import type {
  DefenderAnswer,
  DefenderEscalation,
  DefenderQuestion,
  PlanContextDump,
  PlanDefenderSpawner
} from '@caia/plan-defender';

/** Re-export to avoid forcing callers to import from both packages. */
export type { PlanSubmission, PlanType, NewAdrDraft, AffectedAdr, OperatorEscalation, ReviewStatus };

/**
 * The Plan Reviewer's input — a submission + its accompanying context dump.
 */
export interface PlanReviewerInput {
  submission: PlanSubmission;
  contextDump: PlanContextDump;
  /** Pre-selected EA Repository slice (loaded by Coordinator). */
  context: RelevantContext;
  /** Submission id (always set by the Coordinator). */
  submissionId: string;
  /** Iteration count across resubmissions (1-indexed, starts at 1). */
  iteration: number;
  /** Per-round defender spawner. */
  spawner: PlanDefenderSpawner;
}

/**
 * The terminal verdict — emitted once the Reviewer either reaches a clean
 * answer or hits the iteration cap.
 */
export interface PlanReviewVerdict {
  status: ReviewStatus;
  reasoning: string;
  cited_adrs: string[];
  cited_principles: string[];
  cited_lessons: string[];
  requested_modifications: string[];
  new_adrs_to_file: NewAdrDraft[];
  affected_existing_adrs: AffectedAdr[];
  escalation_to_operator?: OperatorEscalation;
  /** Number of Defender rounds used (0 if no Defender questions were asked). */
  defenderRoundsUsed: number;
  /** Was the Defender forced to escalate? */
  defenderEscalation?: DefenderEscalation;
  /** Full Q&A history — also persisted to the dialogue log. */
  dialogue: ReadonlyArray<{ q: DefenderQuestion; a: DefenderAnswer }>;
  /** Path of the persisted dialogue log. */
  dialogueLogPath: string;
  /** ISO timestamp of the terminal verdict. */
  reviewedAtIso: string;
}

/**
 * An adapter that produces the round-1 review (no Defender dialogue yet) +
 * decides whether the verdict is final or needs more rounds.
 *
 * In production this is backed by the inherited @caia/ea-architect critic.
 * Tests substitute deterministic stubs.
 */
export interface RoundOneReviewerAdapter {
  review(input: RoundOneInput): Promise<RoundOneOutput>;
}

export interface RoundOneInput {
  planMarkdown: string;
  planType: PlanType;
  affectedComponents: string[];
  context: RelevantContext;
  iteration: number;
}

export interface RoundOneOutput {
  status: ReviewStatus;
  reasoning: string;
  cited_adrs: string[];
  cited_principles: string[];
  cited_lessons: string[];
  requested_modifications: string[];
  new_adrs_to_file: NewAdrDraft[];
  affected_existing_adrs: AffectedAdr[];
  escalation_to_operator?: OperatorEscalation;
  /**
   * Question to ask the Defender NEXT (if any). Only set when the
   * Reviewer is undecided and needs clarification. If null, the verdict
   * is terminal at round 1.
   */
  next_question?: string;
  /** Optional scope hint passed to the Defender. */
  next_question_scope?: string;
}

/**
 * Decides whether a verdict is final, given the question/answer pair just
 * exchanged. Used by the multi-turn driver to know when to stop asking.
 *
 * In production this is also backed by a Claude call. Tests substitute
 * deterministic stubs.
 */
export interface VerdictRefinerAdapter {
  refine(input: VerdictRefinerInput): Promise<VerdictRefinerOutput>;
}

export interface VerdictRefinerInput {
  prior: RoundOneOutput;
  question: DefenderQuestion;
  answer: DefenderAnswer;
  round: number;
  cap: number;
}

export interface VerdictRefinerOutput {
  /** Updated verdict — may flip status, requested_modifications, etc. */
  verdict: RoundOneOutput;
  /**
   * Next question to ask (if any). If null, the Reviewer is done — emit
   * the verdict as terminal.
   */
  next_question?: string;
  next_question_scope?: string;
}

/** Configuration knobs for the Reviewer. */
export interface PlanReviewerConfig {
  /** Override the 5-round cap (defaults to DEFENDER_ITERATION_CAP). */
  iterationCap?: number;
  /** Round-1 adapter — defaults to one wrapping @caia/ea-architect. */
  roundOne?: RoundOneReviewerAdapter;
  /** Verdict refiner — defaults to a heuristic refiner if not provided. */
  refiner?: VerdictRefinerAdapter;
  /** Clock for deterministic tests. */
  clock?: () => Date;
}
