/**
 * @caia/plan-defender — public type surface.
 *
 * The Plan Defender pattern: a per-submission Claude Code subagent whose sole
 * job is to answer the EA Plan Reviewer's clarification questions on behalf
 * of the producing agent whose session has closed. The Defender is a faithful
 * proxy for the producer's reasoning, NOT an advocate.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §3.
 */

/** The 5-round iteration cap per spec §3.6. Hard cap, not soft. */
export const DEFENDER_ITERATION_CAP = 5;

/** Threshold of consecutive low-confidence answers before escalation per §3.7.3. */
export const CONSECUTIVE_LOW_CONFIDENCE_THRESHOLD = 3;

/** Plan context dump — the load-bearing artifact every producing agent must emit. */
export interface PlanContextDump {
  schema_version: 1;
  /** Absolute path to the plan markdown this dump accompanies. */
  plan_path: string;
  /** Matches the plan filename (without extension). */
  plan_slug: string;
  /** Producer agent id, e.g. '@caia/researcher' or 'cowork-default'. */
  producer_agent_id: string;
  /** For trace correlation; not for revival. */
  producer_session_id: string;
  /** ISO8601 timestamp. */
  produced_at: string;
  /** Model ids actually used by the producer. */
  models_used: string[];

  /** 500-1500 words — producer's own summary of why the plan looks the way it does. */
  reasoning_summary: string;

  /** Every fork-in-the-road encountered. */
  decision_points: DecisionPoint[];

  /** What the producer read to ground its claims. */
  sources_consulted: SourceConsulted[];

  /** Things the producer left unresolved. */
  open_questions: OpenQuestion[];

  /** Things the producer considered but explicitly dropped. */
  alternatives_dropped: AlternativeDropped[];

  /** Things the producer wants the Reviewer to specifically scrutinize. */
  invitations_to_scrutiny: string[];

  /** Things the producer assumes true without proof. */
  assumptions: Assumption[];
}

export interface DecisionPoint {
  /** The question that was asked. */
  decision: string;
  /** Every option the producer weighed. */
  options_considered: string[];
  /** The option taken. */
  chosen: string;
  /** Why this one over the others. */
  rationale: string;
  confidence: 'low' | 'medium' | 'high';
  /** Condition under which this decision should be re-opened. */
  revisitable_if: string;
}

export interface SourceConsulted {
  type:
    | 'web'
    | 'memory-file'
    | 'caia-file'
    | 'research-doc'
    | 'adr'
    | 'principle'
    | 'conversation';
  /** URL or filesystem path or ADR id or principle id. */
  citation: string;
  /** 1-2 sentences on what this source contributed. */
  relevance: string;
  /** Verbatim quote if the plan leans on a specific phrasing. */
  quoted_excerpt?: string;
}

export interface OpenQuestion {
  question: string;
  /** Why the producer couldn't answer it. */
  why_unresolved: string;
  /** Which sections of the plan depend on this. */
  affects: string[];
  candidate_resolution:
    | 'operator-only'
    | 'reviewable-with-more-research'
    | 'will-emerge-during-build';
}

export interface AlternativeDropped {
  alternative: string;
  why_dropped: string;
  revisit_trigger?: string;
}

export interface Assumption {
  assumption: string;
  why_assumed_true: string;
  blast_radius_if_false: string;
}

/** A single Reviewer → Defender question. */
export interface DefenderQuestion {
  /** Round number, 1-indexed. */
  round: number;
  /** Free text. */
  question: string;
  /** Optional context the Reviewer wants the Defender to weigh. */
  context?: string;
  /** Optional section/scope hint to focus the Defender's response. */
  scope?: string;
  /** ISO timestamp. */
  ts: string;
}

/** A single Defender → Reviewer answer. */
export interface DefenderAnswer {
  /** Round number, matches the question. */
  round: number;
  answer: string;
  cited_sources: string[];
  confidence: 'low' | 'medium' | 'high';
  /**
   * 'plan-stands'           — the question doesn't reveal a defect
   * 'plan-needs-revision'   — the Defender acknowledges a defect; recommend revision
   * 'escalate-to-operator'  — strategic-class or producer-never-decided
   */
  recommended_action: 'plan-stands' | 'plan-needs-revision' | 'escalate-to-operator';
  notes_for_reviewer?: string;
  ts: string;
}

/** Reasons the Defender escalates rather than answering. */
export type DefenderEscalationKind =
  | 'producer-never-decided'
  | 'strategic-class-question'
  | 'consecutive-low-confidence'
  | 'iteration-cap-reached';

export interface DefenderEscalation {
  kind: DefenderEscalationKind;
  /** Round at which escalation fired. */
  round: number;
  /** The question that triggered escalation. */
  question: string;
  /** Defender's note for the operator. */
  note: string;
  /** ISO timestamp. */
  ts: string;
}

/** One JSONL line in the persisted dialogue log. */
export interface DialogueLogQuestionEntry extends DefenderQuestion {
  from: 'ea-plan-reviewer';
  to: 'plan-defender';
  entry_kind: 'question';
  submission_id: string;
  trace_id?: string;
}
export interface DialogueLogAnswerEntry extends DefenderAnswer {
  from: 'plan-defender';
  to: 'ea-plan-reviewer';
  entry_kind: 'answer';
  submission_id: string;
  trace_id?: string;
}
export interface DialogueLogEscalationEntry extends DefenderEscalation {
  from: 'plan-defender';
  entry_kind: 'escalation';
  submission_id: string;
  trace_id?: string;
}
export type DialogueLogEntry =
  | DialogueLogQuestionEntry
  | DialogueLogAnswerEntry
  | DialogueLogEscalationEntry;

/** Handle returned by the spawner; consumers use it to address the Defender. */
export interface DefenderHandle {
  submissionId: string;
  /** ISO timestamp the Defender was spawned. */
  spawnedAt: string;
  /** The context dump the Defender was seeded with. */
  contextDump: PlanContextDump;
  /** Round counter — incremented on each question. */
  round: number;
  /** Consecutive low-confidence answers (resets on medium/high). */
  consecutiveLowConfidence: number;
  /** Has the Defender been closed? */
  closed: boolean;
  /** Why closed, if applicable. */
  closeReason?: 'reviewer-terminated' | 'cap-reached' | 'escalated';
}

/** Configuration knobs for the spawner. */
export interface DefenderSpawnerConfig {
  /** Override the iteration cap (default DEFENDER_ITERATION_CAP). */
  iterationCap?: number;
  /** Override the low-confidence threshold (default 3). */
  lowConfidenceThreshold?: number;
  /** Filesystem adapter — for tests. */
  fs?: import('./fs.js').FsLike;
  /** Clock — for deterministic tests. */
  clock?: () => Date;
  /** Path to the dialogue log directory. Defaults to ~/Documents/projects/caia-ea/dialogues. */
  dialogueDir?: string;
  /** Adapter for spawning the underlying responder. Defaults to claude-spawner-backed. */
  responder?: ResponderAdapter;
}

/** Adapter that produces a Defender answer from a question + the context dump. */
export interface ResponderAdapter {
  respond(input: ResponderInput): Promise<DefenderAnswer>;
}

export interface ResponderInput {
  question: DefenderQuestion;
  contextDump: PlanContextDump;
  /** Prior question/answer pairs in this submission, oldest-first. */
  history: Array<{ q: DefenderQuestion; a: DefenderAnswer }>;
  /** Current round number. */
  round: number;
}

/** Reasons the spawner rejects a dump before any Defender work begins. */
export type ContextDumpValidationError =
  | 'wrong-schema-version'
  | 'missing-required-field'
  | 'no-decision-points'
  | 'no-sources-consulted'
  | 'reasoning-summary-too-short'
  | 'reasoning-summary-too-long';

export interface ContextDumpValidation {
  ok: boolean;
  errors: ContextDumpValidationError[];
  /**
   * Best-effort thickness score 0..1; thicker dumps produce fewer
   * escalation storms. < 0.4 is "thin"; > 0.7 is "thick".
   */
  thickness: number;
}
