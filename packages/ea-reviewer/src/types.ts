/**
 * @caia/ea-reviewer — types.
 *
 * Sourced from research/17_architect_framework_spec_2026.md §6.
 *
 * The reviewer audits the composed `tickets.architecture` blob via three
 * deterministic lenses (completeness, consistency, correctness) plus an
 * optional LLM-judge for acceptance-criteria alignment. It emits a single
 * decision envelope the dispatcher consumes to either:
 *
 *   - pass → transition `ea-complete-verified` (ticket → Test Author).
 *   - fail → transition `ea-rejected` + per-architect rerun list.
 *
 * The reviewer CANNOT write to `tickets.architecture` directly (§6.4). It
 * writes only to `tickets.review_status` and `tickets.review_feedback`.
 */

import type {
  ArchitectName,
  ArchitectSectionContract,
  Ticket,
} from '@caia/architect-kit';

/** Per-architect audit record (one per architect that ran). */
export interface ArchitectAuditRow {
  architectName: ArchitectName;
  status: 'ok' | 'partial' | 'failed';
  confidence: number;
  notes: string;
  risks: readonly string[];
}

export interface ReviewerInput {
  ticket: Ticket;
  /** The composed jsonb blob (disjoint-key merge from the dispatcher). */
  composedArchitecture: Record<string, unknown>;
  /** Audit rows from `tickets_architect_calls`. */
  auditRows: readonly ArchitectAuditRow[];
  /**
   * Architect contracts — needed so the completeness lens knows which
   * paths SHOULD exist for each architect.
   */
  contracts: readonly ArchitectSectionContract[];
  /**
   * `requiresEscalation` records from the dispatcher's same-rank conflict
   * resolutions. The reviewer surfaces these as P0 rerun directives.
   */
  escalations?: readonly EscalationEntry[];
  /** Acceptance criteria from the ticket; drives the correctness lens. */
  acceptanceCriteria?: readonly string[];
}

export interface EscalationEntry {
  ruleId: string;
  architects: readonly [ArchitectName, ArchitectName];
  reason: string;
}

export type Severity = 'P0' | 'P1' | 'P2';

export interface RerunDirective {
  architect: ArchitectName;
  reason: string;
  severity: Severity;
}

export interface Advisory {
  architect: ArchitectName | 'global';
  advisory: string;
  severity: Severity;
}

/** Decision envelope — output of the reviewer. */
export interface ReviewerDecision {
  /**
   * `pass` → orchestrator transitions ticket to `ea-complete-verified`.
   * `fail` → orchestrator transitions to `ea-rejected` + dispatches reruns.
   */
  decision: 'pass' | 'fail';
  /** Architects the dispatcher should re-run on the next iteration. Empty on pass. */
  rerunArchitects: readonly RerunDirective[];
  /** Non-blocking advisories surfaced on the dashboard. */
  advisories: readonly Advisory[];
  /** Per-lens findings — exposed for dashboard + drill-down. */
  findings: ReviewerFindings;
  /** Final state the orchestrator should transition to. */
  finalState: 'ea-complete-verified' | 'ea-rejected';
  /** Human-readable summary of why the decision was made. */
  summary: string;
}

export interface ReviewerFindings {
  completeness: readonly CompletenessFinding[];
  consistency: readonly ConsistencyFinding[];
  correctness: readonly CorrectnessFinding[];
}

export interface CompletenessFinding {
  architect: ArchitectName;
  missingPath: string;
  severity: Severity;
}

export interface ConsistencyFinding {
  invariantId: string;
  description: string;
  /** Architect(s) whose work would need to change to satisfy the invariant. */
  blameArchitects: readonly ArchitectName[];
  severity: Severity;
}

export interface CorrectnessFinding {
  acceptanceCriterion: string;
  /** Which architect's section appears to violate the AC. */
  blameArchitect: ArchitectName | 'global';
  reason: string;
  severity: Severity;
}

// ─── Critic adapter for the LLM-judge correctness lens (DI seam) ───────────

/**
 * The reviewer delegates the optional LLM-judge for correctness to an
 * adapter so tests can swap in a mock. Default impl uses a deterministic
 * keyword-overlap heuristic (no LLM); production wires this to a
 * `@chiefaia/claude-spawner` call.
 */
export interface CriticAdapter {
  judge(input: {
    composedArchitecture: Record<string, unknown>;
    acceptanceCriteria: readonly string[];
    auditRows: readonly ArchitectAuditRow[];
  }): Promise<readonly CorrectnessFinding[]>;
}

// ─── Reviewer options ──────────────────────────────────────────────────────

export interface ReviewerOptions {
  /**
   * Severities that count as "blocking" — any finding at or above this
   * level forces `decision: 'fail'`. Default: ['P0', 'P1'].
   */
  blockingSeverities?: readonly Severity[];
  /**
   * Severity for a missing required path. Default: 'P1'.
   */
  missingRequiredSeverity?: Severity;
  /**
   * Severity assigned to consistency invariant violations. Default: 'P1'.
   */
  invariantViolationSeverity?: Severity;
  /**
   * Confidence floor below which the reviewer adds a P2 advisory. Default: 0.6.
   * (Per spec §6.2: "Sub-0.6 confidence triggers EA Reviewer scrutiny.")
   */
  confidenceFloor?: number;
}

export const DEFAULT_REVIEWER_OPTIONS: Required<ReviewerOptions> = {
  blockingSeverities: ['P0', 'P1'],
  missingRequiredSeverity: 'P1',
  invariantViolationSeverity: 'P1',
  confidenceFloor: 0.6,
};
