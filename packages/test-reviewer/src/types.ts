/**
 * @caia/test-reviewer — types.
 *
 * Sourced from:
 *   - research/state_machine_handoff_spec_2026.md (canonical pipeline)
 *   - research/caia_v3_final_plan_2026.md (Stage 11 ownership)
 *   - plans/plan-2026-05-24-test-reviewer-subagent.md
 *
 * The Test Reviewer audits `ticket.testCases` (populated by the Test Author
 * agent in Stage 10) against the testing strategy the Testing Architect
 * declared into `tickets.architecture.testing.*`. It emits a single decision
 * envelope the orchestrator consumes to either:
 *
 *   - pass → transition `tests-authored` → `tests-reviewed` (ticket → Scheduler).
 *   - fail → chain `tests-authored` → `tests-reviewed` → `tests-review-failed`
 *            (Test Author re-runs).
 *
 * The reviewer CANNOT write to `tickets.testCases` directly. It writes only
 * to `tickets.review_status` and `tickets.review_feedback` (consistent with
 * the @caia/ea-reviewer contract — both reviewers are critic-style audits,
 * not authors).
 */

import type { Ticket } from '@caia/architect-kit';
import type { TestCase } from '@chiefaia/ticket-template';
import type { ProjectState } from '@caia/state-machine';

// ─── Severity ──────────────────────────────────────────────────────────────

export type Severity = 'P0' | 'P1' | 'P2';

// ─── Inputs ────────────────────────────────────────────────────────────────

/**
 * The minimum subset of the canonical `Ticket` shape the reviewer needs.
 * Real callers pass a full `Ticket`; tests can pass this narrow shape.
 *
 * `testCases` is required (Stage 10's Test Author populates it). An empty
 * array is a legitimate input — it means the author produced no cases at
 * all, which the AC-coverage lens will catch.
 */
export interface ReviewerTicket extends Ticket {
  /** Test Author output — array of typed test cases. */
  testCases?: readonly TestCase[];
  /** Test Author metadata (totalCases, categoryCounts, etc.) — optional. */
  testDesign?: {
    designedBy?: string;
    totalCases?: number;
    categoryCounts?: Partial<Record<TestCase['category'], number>>;
  };
}

/**
 * The full input shape for `TestReviewer.review()`. Mirrors
 * `@caia/ea-reviewer`'s `ReviewerInput`.
 */
export interface ReviewerInput {
  ticket: ReviewerTicket;
  /**
   * The composed `tickets.architecture` JSONB — disjoint-key merge from the
   * EA dispatcher. The reviewer reads the `testing.*` slice (the Testing
   * Architect's strategy) and a handful of cross-architect fields
   * (`a11y.wcagLevel`, `security.dataClassification`, `backend.*`,
   * `frontend.componentTree`) to drive quality-tag floors.
   */
  composedArchitecture: Record<string, unknown>;
  /**
   * Acceptance criteria — usually `ticket.acceptance_criteria`, but the
   * caller can override (e.g. if the criteria were normalized upstream).
   * Drives the AC-coverage lens.
   */
  acceptanceCriteria?: readonly string[];
}

// ─── Outputs ───────────────────────────────────────────────────────────────

/**
 * The orchestrator dispatches `rerunAuthor` to `@caia/test-author`. Empty
 * on pass. Mirrors `@caia/ea-reviewer`'s `RerunDirective` (which targets
 * specific architects); we have one author so the directive is uniform.
 */
export interface RerunDirective {
  /** Always `'test-author'` in v0.1 — kept as a field for forward compat. */
  agent: 'test-author';
  reason: string;
  severity: Severity;
  /** Lens that produced the directive (for traceability). */
  lens: LensName;
}

export interface Advisory {
  /** Either the agent that owns the issue, or `'global'` for cross-cutting. */
  agent: 'test-author' | 'testing-architect' | 'global';
  advisory: string;
  severity: Severity;
  lens: LensName;
}

export type LensName =
  | 'acCoverage'
  | 'pyramid'
  | 'edge'
  | 'error'
  | 'correctness';

/** The final state the orchestrator transitions to on pass. */
export type PassFinalState = 'tests-reviewed';

/** The final state the orchestrator transitions to on fail. */
export type FailFinalState = 'tests-review-failed';

/**
 * Output of the reviewer. Identical shape to `@caia/ea-reviewer`'s
 * `ReviewerDecision`, swapping `rerunArchitects → rerunAuthor`.
 */
export interface ReviewerDecision {
  decision: 'pass' | 'fail';
  /**
   * `tests-reviewed` on pass; `tests-review-failed` on fail. Note the
   * orchestrator must emit the canonical chain (see api.ts) to satisfy the
   * @caia/state-machine transition table.
   */
  finalState: PassFinalState | FailFinalState;
  rerunAuthor: readonly RerunDirective[];
  advisories: readonly Advisory[];
  findings: ReviewerFindings;
  summary: string;
}

export interface ReviewerFindings {
  acCoverage: readonly AcCoverageFinding[];
  pyramid: readonly PyramidFinding[];
  edge: readonly EdgeFinding[];
  error: readonly ErrorFinding[];
  correctness: readonly CorrectnessFinding[];
}

export interface AcCoverageFinding {
  /** 0-based index into `acceptanceCriteria`. */
  acIndex: number;
  acText: string;
  reason: string;
  severity: Severity;
}

export interface PyramidFinding {
  layer: TestCase['layer'];
  /** Actual % of cases at this layer. */
  actualPct: number;
  /** Target % per Testing Architect's mix; null if architect absent. */
  targetPct: number | null;
  reason: string;
  severity: Severity;
}

export interface EdgeFinding {
  reason: string;
  severity: Severity;
}

export interface ErrorFinding {
  /**
   * The qualifier this finding hangs off — `'baseline'` (one error test),
   * `'a11y'` (wcagLevel set), `'security'` (PII / confidential), etc.
   */
  qualifier: 'baseline' | 'a11y' | 'security';
  reason: string;
  severity: Severity;
}

export interface CorrectnessFinding {
  testCaseId?: string;
  reason: string;
  severity: Severity;
}

// ─── Critic adapter (correctness-lens DI seam) ────────────────────────────

/**
 * The reviewer delegates LLM-judge case-quality review to an adapter so
 * tests can swap in a mock. Default impl: `NullCriticAdapter` (returns no
 * findings; the deterministic lenses do all the work). Heuristic impl:
 * `HeuristicCriticAdapter` (token-overlap on AC vs `given/when/then`).
 * Production: `@chiefaia/claude-spawner`-backed adapter (subscription-only
 * per P14, no API-key billing).
 */
export interface CriticAdapter {
  judge(input: {
    testCases: readonly TestCase[];
    acceptanceCriteria: readonly string[];
    composedArchitecture: Record<string, unknown>;
  }): Promise<readonly CorrectnessFinding[]>;
}

// ─── Reviewer options ─────────────────────────────────────────────────────

export interface ReviewerOptions {
  /**
   * Severities that count as blocking — any finding at or above this level
   * forces `decision: 'fail'`. Default: ['P0', 'P1'].
   */
  blockingSeverities?: readonly Severity[];
  /**
   * Severity attached to AC-coverage misses. Default: 'P1'.
   */
  acCoverageMissSeverity?: Severity;
  /**
   * Severity for a pyramid layer below target (< 50% of declared share).
   * Default: 'P1'.
   */
  pyramidUnderfillSeverity?: Severity;
  /**
   * Severity for a pyramid layer well above target (> 200% of declared share).
   * Default: 'P2' (advisory).
   */
  pyramidOverfillSeverity?: Severity;
  /**
   * Minimum number of edge-case tests required. The reviewer takes the max
   * of this floor and `ceil(totalCases / 10)`. Default: 1.
   */
  edgeCaseFloor?: number;
  /**
   * Severity attached to insufficient edge cases. Default: 'P1'.
   */
  edgeCaseMissSeverity?: Severity;
  /**
   * Severity attached to missing error-state coverage. Default: 'P1'.
   */
  errorMissSeverity?: Severity;
  /**
   * Hard floor on `unit` layer share when the Testing Architect's mix is
   * absent (or the ticket type doesn't appear in the mix). Default: 30.
   */
  unitFloorPct?: number;
  /**
   * Hard ceiling on `e2e` layer share when the architect's mix is absent.
   * Default: 50.
   */
  e2eCeilingPct?: number;
}

export const DEFAULT_REVIEWER_OPTIONS: Required<ReviewerOptions> = {
  blockingSeverities: ['P0', 'P1'],
  acCoverageMissSeverity: 'P1',
  pyramidUnderfillSeverity: 'P1',
  pyramidOverfillSeverity: 'P2',
  edgeCaseFloor: 1,
  edgeCaseMissSeverity: 'P1',
  errorMissSeverity: 'P1',
  unitFloorPct: 30,
  e2eCeilingPct: 50,
};

// ─── State-machine integration ────────────────────────────────────────────

/**
 * The single canonical agent ID used in state-machine transitions
 * (`triggeredBy.id`). Mirrors `@caia/ea-reviewer`'s `REVIEWER_AGENT_ID`.
 */
export const REVIEWER_AGENT_ID = 'test-reviewer' as const;

/**
 * The fixed pre-state the reviewer reads tickets from. The orchestrator
 * guarantees the ticket is in this state before invoking the reviewer.
 */
export const REVIEWER_PRE_STATE: ProjectState = 'tests-authored';

/**
 * The pass target. Single transition: `tests-authored → tests-reviewed`.
 */
export const REVIEWER_PASS_STATE: PassFinalState = 'tests-reviewed';

/**
 * The intermediate state on the fail path. Per the canonical transition
 * table (`@caia/state-machine`), `tests-review-failed` is only reachable
 * FROM `tests-reviewed`, so the fail path must chain through it.
 */
export const REVIEWER_FAIL_INTERMEDIATE_STATE: PassFinalState =
  'tests-reviewed';

/**
 * The fail target.
 */
export const REVIEWER_FAIL_STATE: FailFinalState = 'tests-review-failed';

// ─── State-machine adapter (DI seam) ──────────────────────────────────────

/**
 * Narrow interface the api.ts wrapper uses to emit transitions. The
 * production adapter wraps `@caia/state-machine`'s `StateMachine` class;
 * tests can pass an in-memory stub that records the transitions emitted.
 */
export interface StateMachineAdapter {
  transition(input: {
    ticketId: string;
    from: ProjectState;
    to: ProjectState;
    triggeredBy: { kind: 'agent'; id: typeof REVIEWER_AGENT_ID };
    payload: {
      /** True for the intermediate hop on the fail chain. */
      intermediate?: boolean;
      decision: ReviewerDecision['decision'];
      findings?: ReviewerFindings;
      summary?: string;
    };
  }): Promise<void>;
}

// ─── Ticket store (DI seam) ───────────────────────────────────────────────

/**
 * The narrow interface api.ts uses to load a ticket by ID. Production
 * wires this to whatever store the orchestrator owns; tests pass an
 * in-memory map.
 */
export interface TicketStore {
  loadTicket(ticketId: string): Promise<ReviewerTicket>;
}

/**
 * The narrow interface api.ts uses to load the composed architecture for
 * a ticket. Often the architecture is on the ticket itself (`ticket.architecture`),
 * but this seam lets callers source it from a separate table.
 */
export interface ArchitectureStore {
  loadArchitecture(ticketId: string): Promise<Record<string, unknown>>;
}

// ─── ReviewOutcome (api.ts return) ────────────────────────────────────────

/**
 * The thing `reviewTicket(ticketId)` returns to the orchestrator. Wraps
 * the reviewer's `ReviewerDecision` with the list of state-machine
 * transitions actually emitted, for audit/replay.
 */
export interface ReviewOutcome {
  ticketId: string;
  decision: ReviewerDecision;
  /**
   * Every transition the api.ts wrapper emitted, in order. On pass: one
   * row (`tests-authored → tests-reviewed`). On fail: two rows
   * (`tests-authored → tests-reviewed` with `intermediate: true`, then
   * `tests-reviewed → tests-review-failed`).
   */
  emittedTransitions: ReadonlyArray<{
    from: ProjectState;
    to: ProjectState;
    intermediate: boolean;
  }>;
}
