/**
 * Coordinator-level types — adapter interfaces the EaCoordinator uses to
 * invoke sub-agents WITHOUT taking a runtime dependency on the sub-agent
 * packages (which themselves depend on @caia/ea-architect for utilities).
 *
 * Sub-agent packages implement these interfaces. Callers (apps, tests,
 * smoke tests) wire concrete sub-agents into the Coordinator via
 * `EaCoordinator`'s constructor config.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §4, §5, §6.
 */

import type {
  AffectedAdr,
  NewAdrDraft,
  OperatorEscalation,
  PlanSubmission,
  ReviewStatus
} from './types.js';

/** Extends the original PlanType set with the new routing-only types from §4.1. */
export type CoordinatorPlanType =
  | 'research'
  | 'spec'
  | 'implementation'
  | 'implementation-plan'
  | 'architecture-change'
  | 'process-change'
  | 'ticket-completeness-check'
  | 'research-request'
  | 'repository-maintenance'
  | 'drift-alert';

/** Sub-agent identifier — one per package. */
export type SubAgentId =
  | 'ea-plan-reviewer'
  | 'ea-ticket-auditor'
  | 'ea-research-conductor'
  | 'ea-doc-steward'
  | 'ea-drift-sentinel';

/** A plan context dump as seen by the Coordinator (mirror of @caia/plan-defender's type). */
export interface CoordinatorContextDump {
  schema_version: 1;
  plan_path: string;
  plan_slug: string;
  producer_agent_id: string;
  producer_session_id: string;
  produced_at: string;
  models_used: string[];
  reasoning_summary: string;
  decision_points: Array<Record<string, unknown>>;
  sources_consulted: Array<Record<string, unknown>>;
  open_questions: Array<Record<string, unknown>>;
  alternatives_dropped: Array<Record<string, unknown>>;
  invitations_to_scrutiny: string[];
  assumptions: Array<Record<string, unknown>>;
}

/** Extended PlanSubmission with the new contextDumpPath field. */
export interface CoordinatorPlanSubmission extends Omit<PlanSubmission, 'planType'> {
  planType: CoordinatorPlanType;
  /** Path to the accompanying plan context dump JSON. */
  contextDumpPath?: string;
  /** Pre-loaded context dump (overrides contextDumpPath if both set). */
  contextDump?: CoordinatorContextDump;
}

/** A single sub-agent's verdict in the Coordinator-level aggregation. */
export interface SubAgentVerdict {
  subAgent: SubAgentId;
  status: ReviewStatus | 'pass' | 'fail' | 'advisory';
  reasoning: string;
  cited_adrs?: string[];
  cited_principles?: string[];
  cited_lessons?: string[];
  requested_modifications?: string[];
  new_adrs_to_file?: NewAdrDraft[];
  affected_existing_adrs?: AffectedAdr[];
  escalation_to_operator?: OperatorEscalation;
  /** Defender rounds used (only meaningful for ea-plan-reviewer). */
  defenderRoundsUsed?: number;
  /** Path of the dialogue log (only meaningful for ea-plan-reviewer). */
  dialogueLogPath?: string;
  /** Full dialogue Q&A for sign-off composition. */
  dialogue?: ReadonlyArray<{ q: { round: number; question: string; scope?: string; ts: string }; a: { round: number; answer: string; cited_sources: string[]; confidence: string; recommended_action: string; ts: string } }>;
  /** Ticket-auditor-specific. */
  ticketAudit?: {
    ticketId: string;
    completenessScore: number;
    missingNonFunctional: string[];
    dodResults: Array<{ id: string; title: string; pass: boolean; reason?: string }>;
  };
  /** Doc-steward-specific. */
  stewardOutput?: {
    filedAdrs: Array<{ adrId: string; title: string; filePath: string; id: number }>;
    supersessionsApplied: Array<{ supersededAdr: string; bySupersedingAdr: string }>;
    supersessionGraphOk: boolean;
  };
  /** Researcher-specific. */
  researchDispatch?: { topicSlug: string; dispatched: boolean; logPath: string };
  /** Drift-sentinel-specific. */
  driftEntries?: Array<{ principleId: string; reason: string; severity: 'info' | 'warn' | 'block' }>;
  ranAtIso: string;
}

/** Plan Reviewer adapter input. */
export interface PlanReviewerAdapterInput {
  submission: CoordinatorPlanSubmission;
  contextDump: CoordinatorContextDump;
  submissionId: string;
  iteration: number;
  /** Spawner reference — opaque to ea-architect. */
  spawner: unknown;
}

export interface PlanReviewerAdapter {
  review(input: PlanReviewerAdapterInput): Promise<SubAgentVerdict>;
}

/** Ticket Auditor adapter. */
export interface TicketAuditorAdapter {
  audit(input: {
    submissionId: string;
    ticketId: string;
    ticketBody: string;
    siblingStories?: Array<{ id: string; body: string }>;
  }): SubAgentVerdict | Promise<SubAgentVerdict>;
}

/** Doc Steward adapter. */
export interface DocStewardAdapter {
  file(input: {
    submissionId: string;
    repo: import('./types.js').EaRepository;
    newAdrsToFile: NewAdrDraft[];
    affectedExistingAdrs: AffectedAdr[];
    dialogueLogPath?: string;
  }): Promise<SubAgentVerdict>;
}

/** Research Conductor adapter. */
export interface ResearchConductorAdapter {
  request(input: {
    submissionId: string;
    topic: string;
    brief: string;
    requesterAgentId: string;
  }): Promise<SubAgentVerdict>;
}

/** Drift Sentinel adapter (synchronous on-demand mode). */
export interface DriftSentinelAdapter {
  processSubmission(input: { submissionId: string; planMarkdown: string }): SubAgentVerdict | Promise<SubAgentVerdict>;
}

/** Aggregated verdict — what the Coordinator returns to callers. */
export interface CoordinatorReviewOutcome {
  /** The dominant (winning) status per the precedence ladder. */
  status: ReviewStatus;
  /** Coordinator's composed reasoning across sub-agents. */
  reasoning: string;
  /** Submission id. */
  submissionId: string;
  /** Iteration. */
  iteration: number;
  /** Per-sub-agent verdicts, in invocation order. */
  subAgentVerdicts: SubAgentVerdict[];
  /** The sub-agents whose verdicts were overridden by precedence. */
  dissenting: SubAgentVerdict[];
  /** Composed citations across all sub-agents. */
  cited_adrs: string[];
  cited_principles: string[];
  cited_lessons: string[];
  /** Aggregated modification requests. */
  requested_modifications: string[];
  /** ADRs filed by the Steward. */
  new_adrs_to_file: NewAdrDraft[];
  affected_existing_adrs: AffectedAdr[];
  /** Operator escalation, if any. */
  escalation_to_operator?: OperatorEscalation;
  /** Path of the sign-off document. */
  signoffPath: string;
  /** Path of the Defender dialogue log (if any). */
  dialogueLogPath?: string;
  /** Defender rounds used in total. */
  defenderRoundsUsed: number;
  /** Sub-agents invoked. */
  subAgentsInvoked: SubAgentId[];
  /** ISO timestamp. */
  reviewedAtIso: string;
}

/** Validation gate result before any sub-agent runs. */
export interface CoordinatorValidationResult {
  ok: boolean;
  /** 'needs-context-dump' if the submission lacks a dump. */
  reason?: 'needs-context-dump' | 'context-dump-invalid' | 'unknown-plan-type';
  detail?: string;
}
