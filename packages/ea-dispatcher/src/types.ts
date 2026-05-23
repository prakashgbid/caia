/**
 * @caia/ea-dispatcher — dispatcher-specific types.
 *
 * Sourced from research/17_architect_framework_spec_2026.md §3.
 *
 * Design notes:
 *  - The dispatcher is dependency-injected against its non-trivial collaborators
 *    (state machine, spawner, telemetry sink, clock) so it stays trivial to test
 *    and can be PR'd against develop without those packages also being merged.
 *  - All collaborator interfaces declared here are structurally typed — the
 *    concrete implementations in `@caia/state-machine`, `@chiefaia/claude-spawner`,
 *    and the orchestrator's telemetry sink match by shape, not by import.
 */

import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectName,
  BusinessPlan,
  RenderableDesign,
  TenantContext,
  Ticket,
  SpecialistArchitect,
} from '@caia/architect-kit';

// ─── Inputs to the dispatcher ──────────────────────────────────────────────

export interface DispatchInput {
  ticket: Ticket;
  businessPlan: BusinessPlan;
  designVersion: RenderableDesign;
  tenantContext: TenantContext;
  /**
   * Reviewer feedback from a prior cycle — when non-empty, the dispatcher
   * re-runs ONLY the named architects, not the full roster.
   */
  rerunFor?: ReadonlyArray<{ architect: ArchitectName; reason: string; severity?: 'P0' | 'P1' | 'P2' }>;
  /**
   * Iteration counter for the reviewer ↔ dispatcher loop. Past `MAX_ITERATIONS`
   * (spec §6.3 = 3) the dispatcher refuses to fan out and the orchestrator
   * must escalate to operator.
   */
  iteration?: number;
}

// ─── Outputs from the dispatcher ───────────────────────────────────────────

export interface ArchitectCallRecord {
  ticketId: string;
  architectName: ArchitectName;
  status: ArchitectOutput['status'];
  confidence: number;
  spend: ArchitectOutput['spend'];
  toolCalls: ArchitectOutput['toolCalls'];
  notes: string;
  risks: readonly string[];
  /** Retries the dispatcher consumed (0 = first attempt succeeded). */
  retries: number;
  /** Wall-clock start, ISO-8601. */
  startedAt: string;
  /** Wall-clock end, ISO-8601. */
  endedAt: string;
  failureReason?: string;
}

export interface DispatchTelemetry {
  /** All architects the dispatcher attempted, in finish-time order. */
  calls: readonly ArchitectCallRecord[];
  /** Architects the appliesPredicate filtered out (silent skip — not failures). */
  skipped: readonly ArchitectName[];
}

export interface DispatchResult {
  ticketId: string;
  /** Final composed architecture blob (the value to UPDATE tickets.architecture with). */
  composedArchitecture: Record<string, unknown>;
  /** Per-architect outcomes, success and failure alike. */
  outputs: readonly ArchitectOutput[];
  /** Aggregated telemetry — used by the orchestrator to write audit rows. */
  telemetry: DispatchTelemetry;
  /** Final state the dispatcher transitioned the ticket to. */
  finalState: 'ea-complete' | 'ea-dispatching-failed';
  /** Why this state — short reason. */
  reason: string;
  /**
   * Semantic conflicts the dispatcher detected, after composition. Lower-
   * precedence architects' fields carry `_dissent` annotations; this list
   * lets the reviewer surface them.
   */
  conflicts: readonly ConflictRecord[];
  /** Wave-by-wave execution plan, for logs + dashboard rendering. */
  plan: readonly { wave: number; members: readonly ArchitectName[] }[];
}

export interface ConflictRecord {
  ruleId: string;
  winner: ArchitectName;
  loser: ArchitectName;
  /** Field paths the conflict touched. */
  fields: readonly string[];
  /** Whether this conflict required escalation (same-rank tie). */
  escalated: boolean;
}

// ─── Collaborator interfaces (DI seams) ────────────────────────────────────

/**
 * State-machine adapter — the dispatcher calls these methods to claim,
 * heartbeat, release the ticket and transition the project state. The
 * real implementation is the `StateMachine` class in `@caia/state-machine`;
 * tests use the in-memory mock.
 */
export interface StateMachineAdapter {
  claimTicketForAgent(
    ticketId: string,
    agentId: string,
    opts?: { ttlSeconds?: number; projectId?: string },
  ): Promise<{ claimed: boolean }>;
  heartbeat(ticketId: string, agentId: string): Promise<void>;
  releaseTicket(
    ticketId: string,
    agentId: string,
    finalStatus: 'done' | 'failed' | 'aborted',
  ): Promise<{ ok: boolean }>;
  transition(
    projectId: string,
    toState: 'ea-complete' | 'ea-dispatching-failed' | 'ea-dispatching',
    opts: {
      reason: string;
      triggeredBy: { kind: 'agent'; id: string };
      payload?: Record<string, unknown>;
    },
  ): Promise<{ applied: boolean }>;
}

/**
 * Spawner adapter — the dispatcher delegates the actual LLM call to the
 * concrete `SpecialistArchitect.run()` of each architect. This adapter
 * exists so the dispatcher can wrap each call with a deadline, capture
 * spend telemetry, and inject reviewer feedback.
 *
 * In production, this is a thin wrapper over the architect's `run()`. In
 * tests, this is a mock that returns canned outputs without spawning Claude.
 */
export interface ArchitectInvoker {
  /**
   * Invoke `architect.run(input)` with a wall-clock timeout. Returns the
   * architect's output (which may itself be `failed` if the architect chose
   * to handle the timeout internally). Throws only on truly catastrophic
   * faults (e.g. the architect threw an uncaught exception); the dispatcher
   * converts these into `failed` outputs.
   */
  invoke(
    architect: SpecialistArchitect,
    input: ArchitectInput,
    deadlineMs: number,
  ): Promise<ArchitectOutput>;
}

/**
 * Telemetry sink — receives per-call ArchitectCallRecord rows. Implementations:
 *  - Production: writes to `tickets_architect_calls` (Postgres) per spec §3.5
 *    and emits an OTel span per spec §10.
 *  - Tests: an in-memory array.
 */
export interface TelemetrySink {
  recordArchitectCall(row: ArchitectCallRecord): Promise<void>;
}

/** Wall-clock for deterministic testing. */
export interface Clock {
  now(): number;
  /** Returns an ISO-8601 timestamp at the current instant. */
  isoNow(): string;
}

// ─── Configuration ─────────────────────────────────────────────────────────

export interface DispatcherOptions {
  /**
   * Per-architect maximum wall-clock budget. Defaults to 60_000 (60s) per
   * spec §1.1 ArchitectBudget default.
   */
  perArchitectTimeoutMs?: number;
  /**
   * Maximum number of architects to spawn concurrently within a single wave.
   * Defaults to 30 (a comfortable upper bound for the 17-architect roster).
   * Larger waves are sub-batched.
   */
  maxConcurrentSpawns?: number;
  /**
   * Retry-once policy: on schema-mismatch (missing required path / extra
   * path), the dispatcher retries the architect once with a corrected
   * prompt fragment. Defaults to true per spec §3.4.
   */
  retryOnSchemaMismatch?: boolean;
  /** Hard cap on reviewer ↔ dispatcher iterations. Defaults to 3 per spec §6.3. */
  maxIterations?: number;
  /**
   * Threshold for `ea-dispatching-failed`. If more than this fraction of the
   * applicable architects fail, the dispatcher refuses to compose and
   * transitions to `ea-dispatching-failed`. Defaults to 0.5 per spec §3.7.
   */
  failureThreshold?: number;
  /** Optional ticket-claim TTL in seconds. Defaults to 600 (10 minutes). */
  claimTtlSeconds?: number;
}

export const DEFAULT_DISPATCHER_OPTIONS: Required<DispatcherOptions> = {
  perArchitectTimeoutMs: 60_000,
  maxConcurrentSpawns: 30,
  retryOnSchemaMismatch: true,
  maxIterations: 3,
  failureThreshold: 0.5,
  claimTtlSeconds: 600,
};
