/**
 * Public types for @caia/principal-engineer (Stage 12).
 *
 * The shapes here are deliberately kept narrow and side-effect-free so the
 * pure graph + bucketer layers can be unit-tested in isolation, and so the
 * dispatcher + worker-pool layers can be wired against either the real
 * @caia/state-machine + @chiefaia/claude-spawner pair or test stubs.
 */

import type {
  ClaimResult,
  ProjectRow,
  ProjectState,
  TransitionResult,
  TriggeredBy,
} from '@caia/state-machine';

// ─── Tickets + graph ────────────────────────────────────────────────────────

/** Minimum ticket shape the scheduler needs. The full template lives in @chiefaia/ticket-template. */
export interface Ticket {
  /** Stable identifier, eg "T-001". Must be unique within the request. */
  ticketId: string;
  /** Ticket ids this ticket depends on. Must reference tickets in the same request. */
  dependsOn: readonly string[];
  /**
   * Optional resource locks the ticket holds. Two tickets sharing a lock in
   * the same wave are forced into separate waves (sequential-after) by the
   * bucketer.
   */
  resourceLocks?: readonly string[];
  /**
   * Optional estimated effort for capacity planning. Defaults to 1.
   * Used only when the bucketer's per-wave capacity is set in effort units.
   */
  effort?: number;
}

/** Built graph form: nodes + adjacency. */
export interface TicketGraph {
  /** ticketId -> Ticket (preserves insertion order). */
  readonly nodes: ReadonlyMap<string, Ticket>;
  /** ticketId -> ticket ids that depend on it (reverse adjacency, used for topo). */
  readonly successors: ReadonlyMap<string, readonly string[]>;
  /** ticketId -> ticket ids it depends on (forward adjacency; deduped + frozen). */
  readonly predecessors: ReadonlyMap<string, readonly string[]>;
}

/** A strongly-connected component (cycle if size > 1, self-loop if size == 1 with self-edge). */
export interface Scc {
  /** Ticket ids in the SCC, sorted lexicographically for determinism. */
  readonly nodes: readonly string[];
  /** True if the SCC contains a cycle (size > 1 OR a self-loop). */
  readonly isCycle: boolean;
}

/** Returned by detectCycles — only SCCs with a cycle. */
export interface CycleReport {
  readonly cycles: readonly Scc[];
}

/** Returned by topoLevels — one entry per ticket, in input order. */
export interface TopoLevel {
  readonly ticketId: string;
  readonly level: number;
}

// ─── Bucketer ───────────────────────────────────────────────────────────────

/** Kind of bucket the bucketer assigns. */
export type BucketKind =
  /** Tickets in this bucket can run in parallel with peers in the same wave. */
  | { kind: 'parallel-bucket'; index: number }
  /** Tickets in this bucket must run after the named predecessor bucket finishes. */
  | { kind: 'sequential-after'; predecessorBucketId: string };

/** Single bucket within a wave. */
export interface WaveBucket {
  /** Content-addressed id (stable across runs given identical inputs). */
  readonly bucketId: string;
  /** 0-based wave index. */
  readonly waveIndex: number;
  /** Bucket kind + payload. */
  readonly assignment: BucketKind;
  /** Ticket ids assigned to this bucket. */
  readonly ticketIds: readonly string[];
}

/** Full wave plan emitted by the bucketer. */
export interface WavePlan {
  /** Buckets in execution order (sorted by waveIndex then bucketId). */
  readonly buckets: readonly WaveBucket[];
  /** Total wave count. */
  readonly waveCount: number;
  /** Concurrency cap per wave applied (post tier clamp). */
  readonly perWaveCap: number;
}

/** Tenant tier — clamps the per-wave concurrency cap. */
export type TenantTier = 'free' | 'pro' | 'enterprise';

/** Default concurrency cap per tier. */
export const TIER_CAPS: Readonly<Record<TenantTier, number>> = Object.freeze({
  free: 2,
  pro: 5,
  enterprise: 10,
});

/** Inputs to bucketTickets. */
export interface BucketInput {
  readonly tickets: readonly Ticket[];
  readonly tenantTier: TenantTier;
  /** Optional override — clamped against tier cap. */
  readonly tenantOverrideCap?: number;
  /** Optional bucket-policies sourced from SPS YAML; absent => defaults. */
  readonly bucketPolicies?: SpsBucketPolicies;
}

/** Subset of the SPS bucket-policies YAML the scheduler consumes. */
export interface SpsBucketPolicies {
  /**
   * Per-bucket caps. Keys are SPS bucket names (eg "M1-cowork", "stolution-claude").
   * The scheduler only consults this when an explicit `targetSpsBucket` is set,
   * which is out of scope for the v0.1 scheduler — kept for forward compat.
   */
  readonly buckets?: Readonly<Record<string, { initialCap?: number; targetCap?: number }>>;
  /** Global settings the scheduler honours. */
  readonly global?: {
    readonly spawnDispatchMinIntervalS?: number;
    readonly conflictCheckDefault?: 'fail-open' | 'fail-closed';
  };
}

// ─── Worker pool ────────────────────────────────────────────────────────────

/** Per-worker registration. */
export interface WorkerRegistration {
  readonly workerId: string;
  /** Tier informs the per-wave dispatch cap. */
  readonly tier: TenantTier;
  /** Optional capability tags (eg "macos", "linux", "k3s"). Reserved for future filtering. */
  readonly capabilities?: readonly string[];
}

/** Live status snapshot of a worker. */
export interface WorkerStatus {
  readonly workerId: string;
  readonly tier: TenantTier;
  readonly assignedProjects: readonly string[];
  readonly lastHeartbeatAt: Date | null;
  readonly isAlive: boolean;
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/** Result of a single FSE spawn attempt. */
export interface DispatchAttempt {
  readonly ticketId: string;
  readonly projectId: string;
  readonly workerId: string;
  /** Whether the spawn returned ok=true. */
  readonly ok: boolean;
  /** Wall-clock duration of the spawn in ms. */
  readonly durationMs: number;
  /** stdout (truncated to 4KB). */
  readonly stdout: string;
  /** stderr (truncated to 4KB). */
  readonly stderr: string;
  /** Diagnostic on failure. */
  readonly diagnostic: string | null;
  /** The transition recorded against the project after dispatch. */
  readonly transition: TransitionResult | null;
  /** Failure reason when the dispatch could not be recorded. */
  readonly failureReason?: string;
}

/** Spawner signature (compatible with @chiefaia/claude-spawner.spawnClaude). */
export type SpawnFn = (input: {
  prompt: string;
  options?: {
    binaryPath?: string;
    timeoutMs?: number;
    cwd?: string;
    extraArgs?: readonly string[];
    extraEnv?: Record<string, string>;
    accountId?: string | null;
  };
}) => Promise<{
  ok: boolean;
  rc: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  diagnostic: string | null;
  accountId: string | null;
}>;

// ─── Scheduler (high-level) ─────────────────────────────────────────────────

/** Input to schedule(). */
export interface ScheduleInput {
  readonly tickets: readonly Ticket[];
  /** Maps each ticketId to the FSM projectId that owns it. */
  readonly projectIdByTicket: Readonly<Record<string, string>>;
  readonly tenantTier: TenantTier;
  readonly tenantOverrideCap?: number;
  readonly bucketPolicies?: SpsBucketPolicies;
  /** Triggered-by attribution; defaults to { kind: 'agent', id: '@caia/principal-engineer' }. */
  readonly triggeredBy?: TriggeredBy;
}

/** Result of schedule(). */
export interface ScheduleResult {
  readonly wavePlan: WavePlan;
  readonly dispatched: readonly DispatchAttempt[];
  readonly transitions: readonly TransitionResult[];
  readonly failures: readonly { ticketId: string; reason: string }[];
  /** Cycles found in the input (empty if none). */
  readonly cycles: readonly Scc[];
}

/** Wiring for the high-level schedule() function. */
export interface SchedulerConfig {
  /** State machine driving FSM transitions and worker primitives. */
  readonly stateMachine: SchedulerStateMachine;
  /** Spawner used to fan out FSEs. */
  readonly spawnFn: SpawnFn;
  /** Path to the FSE subagent template (caia-coding.md). */
  readonly fseSubagentPath: string;
  /**
   * Optional clock for deterministic tests. Defaults to () => new Date().
   */
  readonly clock?: () => Date;
  /** Optional list of worker ids to dispatch through (round-robin). Defaults to one synthetic worker. */
  readonly workerIds?: readonly string[];
  /** Per-spawn timeout. Defaults to 30 * 60 * 1000 (30 minutes). */
  readonly spawnTimeoutMs?: number;
  /** When true, skips the actual spawn and only computes the wave plan. */
  readonly dryRun?: boolean;
}

/**
 * The narrow slice of StateMachine the scheduler depends on. Mirrors the
 * concrete @caia/state-machine surface but kept as a structural interface so
 * tests can supply an InMemory or stub implementation without pulling in pg.
 */
export interface SchedulerStateMachine {
  getProject(projectId: string): Promise<ProjectRow | null>;
  currentState(projectId: string): Promise<ProjectState>;
  transition(
    projectId: string,
    toState: ProjectState,
    opts: {
      reason: string;
      triggeredBy: TriggeredBy;
      payload?: Record<string, unknown>;
    },
  ): Promise<TransitionResult>;
  tryAssignWork(
    projectId: string,
    workerId: string,
    opts?: { ttlSeconds?: number },
  ): Promise<ClaimResult>;
  recordWorkerHeartbeat(workerId: string): Promise<{ ok: boolean; refreshed: string[] }>;
  completeWork(
    workerId: string,
    finalState?: ProjectState,
    opts?: {
      reason?: string;
      triggeredBy?: TriggeredBy;
      payload?: Record<string, unknown>;
    },
  ): Promise<{ released: string[]; transitioned: TransitionResult[] }>;
  expireInactiveWorkers(): Promise<{ releasedAssignments: string[] }>;
}

// ─── API ────────────────────────────────────────────────────────────────────

/** Shape-only HTTP request (so we don't depend on Express/Fastify/etc). */
export interface ScheduleRequestShape {
  readonly method: string;
  readonly body: unknown;
}

/** Shape-only HTTP response. */
export interface ScheduleResponseShape {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}


// ─── State-machine re-exports (so internal modules can pull these via ./types.js) ─
export type { TransitionResult } from '@caia/state-machine';

