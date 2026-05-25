/**
 * @caia/test-author — types.
 *
 * Stage 10 of CAIA's canonical pipeline.
 *
 * The Test Author Agent reads an EA-approved ticket
 * (`ticket.architecture.testing.*` populated by `@caia/testing-architect`
 * plus `frontend.*`, `backend.*`, `database.*`, `a11y.*` slices) and
 * emits the per-story `ticket.testCases` array (Gherkin given/when/then,
 * category, layer, selector hints, mocks) plus the `ticket.testDesign`
 * metadata block.
 *
 * The emitted `TestCase[]` is the canonical `.strict()` shape from
 * `@chiefaia/ticket-template` — this package never modifies that schema.
 */

import type { Ticket } from '@caia/architect-kit';
import type { ProjectState, TriggeredBy } from '@caia/state-machine';
import type {
  TestCase,
  TestCaseCategory,
  TestCaseLayer
} from '@chiefaia/ticket-template';

// ─── Severity ──────────────────────────────────────────────────────────────

export type Severity = 'P0' | 'P1' | 'P2';

// ─── Inputs ────────────────────────────────────────────────────────────────

/**
 * Narrow projection of the canonical `Ticket` the author needs. Real
 * callers pass a full `Ticket`; tests can pass this shape.
 *
 * `architecture.testing.*` is set by `@caia/testing-architect` (PR #565).
 * If absent, the author falls back to default mix constants (see
 * `agent.ts → DEFAULT_STORY_MIX`).
 */
export interface AuthorTicket extends Ticket {
  architecture?: Record<string, unknown>;
}

/**
 * Per-architect budget. Same shape as `@caia/architect-kit`'s
 * `ArchitectBudget`, redeclared here so this package doesn't need to
 * import the type at runtime (only at the .d.ts surface).
 */
export interface AuthorBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxWallClockMs: number;
  preferredModel: 'haiku' | 'sonnet' | 'opus';
  hardCostCeilingUsd: number;
}

/**
 * Re-run hint from `@caia/test-reviewer` on the chain
 * `tests-authored → tests-review-failed`. Iteration ≥2 only.
 */
export interface ReviewerFeedback {
  reason: string;
  severity: Severity;
  /** Reviewer-suggested case categories / layers to add or rebalance. */
  hints?: Record<string, unknown>;
}

/**
 * The input to `TestAuthorAgent.design()`. Sourced by the orchestrator
 * via the EA Dispatcher's composed `tickets.architecture` JSONB.
 */
export interface AuthorInput {
  ticket: AuthorTicket;
  /**
   * The composed `tickets.architecture` JSONB. The author reads the
   * `testing.*` slice (the Testing Architect's strategy) and a handful
   * of cross-architect fields (`frontend.componentTree`,
   * `frontend.interactionStates`, `backend.apiEndpoints`,
   * `backend.errorEnvelope`, `database.schemaDDL`, `a11y.wcagLevel`).
   */
  composedArchitecture: Record<string, unknown>;
  /**
   * Acceptance criteria. Usually `ticket.acceptance_criteria`, but the
   * caller can override. Drives the AC coverage floor.
   */
  acceptanceCriteria?: readonly string[];
  /** Optional budget; agent uses sane defaults if omitted. */
  budget?: AuthorBudget;
  /** Set on iterations ≥2 of a tests-authored → tests-authoring-failed retry. */
  reviewerFeedback?: ReviewerFeedback;
}

// ─── Spawner / runtime telemetry ───────────────────────────────────────────

export interface AuthorToolCall {
  toolName: string;
  argsHash: string;
  durationMs: number;
  ok: boolean;
}

export interface AuthorSpend {
  inputTokens: number;
  outputTokens: number;
  usdCost: number;
  wallClockMs: number;
  model: string;
}

// ─── Outputs ───────────────────────────────────────────────────────────────

/**
 * The `ticket.testDesign` metadata block. Persisted alongside
 * `ticket.testCases`. Mirrors the shape in `@chiefaia/ticket-template`'s
 * `TestDesign` zod schema, redeclared here for clarity.
 */
export interface TestDesign {
  designedBy: string;
  designedAt: number;
  totalCases: number;
  categoryCounts: Record<TestCaseCategory, number>;
  /** Pyramid layer counts (parallel to categoryCounts). */
  layerCounts: Record<TestCaseLayer, number>;
}

/**
 * The agent's full output. The api.ts wrapper consumes this and writes
 * it to the ticket store.
 */
export interface AuthorOutput {
  agentName: 'test-author';
  testCases: readonly TestCase[];
  testDesign: TestDesign;
  /** 0..1. The api.ts wrapper records this in the transition payload. */
  confidence: number;
  notes: string;
  /** Sibling agents this author consulted (always includes 'testing'). */
  dependencies: readonly string[];
  risks: readonly string[];
  toolCalls: readonly AuthorToolCall[];
  spend: AuthorSpend;
  status: 'ok' | 'partial' | 'failed';
  failureReason?: string;
}

// ─── Pass/fail final states ────────────────────────────────────────────────

export type PassFinalState = 'tests-authored';
export type FailFinalState = 'tests-authoring-failed';

// ─── api.ts DI seams ───────────────────────────────────────────────────────

/**
 * Narrow `loadTicket` interface used by `api.ts`. Production wires to
 * the orchestrator's Postgres store; tests pass an in-memory map.
 */
export interface TicketStore {
  loadTicket(ticketId: string): Promise<AuthorTicket>;
  /**
   * Persist the testCases + testDesign payload onto the ticket. The
   * adapter is responsible for transactional consistency between the
   * two columns.
   */
  writeTestCases(input: {
    ticketId: string;
    testCases: readonly TestCase[];
    testDesign: TestDesign;
  }): Promise<void>;
}

/**
 * Narrow `loadArchitecture` interface — often the architecture is on
 * the ticket itself (`ticket.architecture`), but this seam lets callers
 * source it from a separate table. Mirrors `@caia/test-reviewer`'s
 * `ArchitectureStore` seam.
 */
export interface ArchitectureStore {
  loadArchitecture(ticketId: string): Promise<Record<string, unknown>>;
}

/**
 * Narrow state-machine adapter the api.ts wrapper uses. Production
 * wraps `@caia/state-machine`'s `StateMachine` class; tests pass an
 * in-memory recorder.
 */
export interface StateMachineAdapter {
  transition(input: {
    ticketId: string;
    from: ProjectState;
    to: ProjectState;
    triggeredBy: TriggeredBy;
    payload: {
      /** True for the intermediate hop on the fail chain. */
      intermediate?: boolean;
      decision: 'pass' | 'fail';
      summary?: string;
      testDesign?: TestDesign;
      failureReason?: string;
    };
  }): Promise<void>;
}

// ─── ApiOutcome (api.ts return) ────────────────────────────────────────────

export interface AuthorOutcome {
  ticketId: string;
  output: AuthorOutput;
  /**
   * Every transition the api.ts wrapper emitted, in order. Pass path:
   * one row (`ea-complete → tests-authored`). Fail path: two rows
   * (`ea-complete → tests-authored` with `intermediate: true`, then
   * `tests-authored → tests-authoring-failed`).
   */
  emittedTransitions: ReadonlyArray<{
    from: ProjectState;
    to: ProjectState;
    intermediate: boolean;
  }>;
}

// ─── Author options ────────────────────────────────────────────────────────

export interface AuthorOptions {
  /** Minimum number of cases the author tries to emit. Default 3. */
  softFloor?: number;
  /**
   * Hard cap; mirrors `@chiefaia/ticket-template`'s `MAX_TEST_CASES`.
   * Default 50. The author truncates by lowest priority if the LLM
   * over-emits.
   */
  hardCap?: number;
  /**
   * Whether to emit a `category: 'accessibility'` case when the
   * architecture declares a wcagLevel. Default true.
   */
  enforceAccessibilityFloor?: boolean;
  /**
   * Whether to emit a `category: 'performance'` case when the
   * architecture declares `testing.perfRegressionBudgets`. Default true.
   */
  enforcePerformanceFloor?: boolean;
  /**
   * Whether to emit at least one `category: 'error'` per documented
   * error-envelope entry. Default true.
   */
  enforceErrorFloor?: boolean;
}

export const DEFAULT_AUTHOR_OPTIONS: Required<AuthorOptions> = {
  softFloor: 3,
  hardCap: 50,
  enforceAccessibilityFloor: true,
  enforcePerformanceFloor: true,
  enforceErrorFloor: true
};
