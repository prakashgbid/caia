/**
 * Public type surface for @caia/devops-runtime (Stage 15).
 *
 * Source-of-truth fields are anchored to the architect's contract
 * (`@caia/devops-architect.DEVOPS_OWNED_SECTIONS`). The runtime never
 * mutates the spec — it only reads it.
 */

import type {
  SolutionLifecycleMachine,
  SolutionState,
  SolutionTransitionResult,
  SolutionTriggeredBy,
  StewardAttestation,
} from '@caia/state-machine';

// ─── Strategy enum (mirrored from @caia/devops-architect.contract) ────────

/** Strategies this runtime implements. Mirrors @caia/devops-architect's
 * `DEPLOY_STRATEGIES`. The architect MAY add new names; if the runtime
 * encounters one it does not implement, it refuses the deploy with a
 * `'unsupported-strategy'` reason rather than crashing. */
export const RUNTIME_DEPLOY_STRATEGIES = [
  'blue-green',
  'canary',
  'rolling',
  'ring-deployment',
  'recreate',
] as const;

export type DeployStrategyName = (typeof RUNTIME_DEPLOY_STRATEGIES)[number];

/** Target environments the runtime understands. */
export const TARGET_ENVIRONMENTS = ['development', 'staging', 'production', 'preview'] as const;
export type TargetEnv = (typeof TARGET_ENVIRONMENTS)[number];

/** Rollback methods mirrored from architect's `rollbackContract.method`. */
export const ROLLBACK_METHODS = ['time-machine-snapshot', 'git-revert-and-redeploy'] as const;
export type RollbackMethod = (typeof ROLLBACK_METHODS)[number];

// ─── Architect-spec slices the runtime consumes ───────────────────────────

/** Subset of `ticket.architecture.devops` the runtime needs. The full
 * shape is owned by the architect; we read these fields verbatim. */
export interface ArchitectureDevopsSlice {
  deployStrategy: {
    strategy: DeployStrategyName;
    /** Canary: per-step traffic-share schedule (e.g. [10, 50, 100]). */
    trafficShiftSchedule?: number[];
    /** Canary/blue-green/rolling: minutes to dwell at each step. */
    dwellMin?: number;
    /** Healthcheck endpoint (relative path or absolute URL). */
    healthcheckPath?: string;
    /** Rolling: per-batch parameters. */
    maxSurge?: number;
    maxUnavailable?: number;
    /** Abort if healthcheck fails > thresholdRedSecs in a row. */
    abortCondition?: { healthcheckRedSecs: number };
  };
  rollbackContract: {
    trigger: 'healthcheck-failure' | 'manual' | 'attestation-red';
    autoRevertWindowMin: number;
    method: RollbackMethod;
    timeMachineSnapshotKey?: string;
    dataMigrationRollback?: 'reversible' | 'forward-fix-only';
  };
  infrastructureAsCode: {
    tool: string;
    capabilities: string[];
  };
  environmentPromotion: {
    environments: { name: TargetEnv; autoPromote: boolean; gateKind?: string }[];
  };
  deploymentObservability: {
    eventTypes?: string[];
    retentionDays?: number;
  };
  secretsManagementInPipeline: {
    provider: string;
    tokenLifetimeMin: number;
  };
}

/** Minimal ticket loader shape — re-implemented to avoid coupling to a
 * specific ticket-template version (the architect already enforces the
 * spec). */
export interface LoadedDeployTicket {
  ticketId: string;
  /** The Solution id used for the SolutionLifecycleMachine. */
  solutionId: string;
  /** The git sha being deployed. */
  gitSha: string;
  /** Architecture slice from the architect's emission. */
  architecture: { devops: ArchitectureDevopsSlice };
  /** Repo path used by adapters that shell out (terraform apply, kubectl, etc.). */
  repoPath?: string;
  /** Tenant id for multi-tenant adapters. */
  tenantId?: string;
}

export interface TicketStore {
  loadTicket(ticketId: string): Promise<LoadedDeployTicket>;
}

// ─── BYOC adapter contract ────────────────────────────────────────────────

/** Per-deploy adapter input — strategy-agnostic. The strategy modules
 * call the adapter with a `phase` (single-shot for blue-green/rolling,
 * one-per-step for canary). */
export interface DeployAdapterInput {
  ticketId: string;
  solutionId: string;
  gitSha: string;
  targetEnv: TargetEnv;
  /** Strategy-level identifier so adapters can label artifacts. */
  strategy: DeployStrategyName;
  /** Strategy-step label (e.g. `'green-up'`, `'canary-10'`, `'batch-2/3'`). */
  phase: string;
  /** Strategy-step traffic-share (canary). 0..100. */
  trafficSharePct?: number;
  /** Capability token signature (sealed; never logged). */
  capabilityTokenId: string;
  /** Free-form forwarding data the adapter understands. */
  args?: Record<string, unknown>;
}

export interface DeployAdapterOutput {
  ok: boolean;
  phase: string;
  durationMs: number;
  /** Adapter-specific structured result (record only; never inspected). */
  data?: Record<string, unknown>;
  /** Healthcheck result snapshot. */
  healthcheck?: HealthcheckSnapshot;
  /** Human-readable reason on failure. */
  reason?: string;
  /** Optional undo pointer the rollback layer can use. */
  undoToken?: string;
}

export interface HealthcheckSnapshot {
  ok: boolean;
  status?: number;
  latencyMs?: number;
  body?: string;
}

export interface ByocAdapter {
  /** Execute a single deploy phase. Strategies call this multiple times
   * for canary/rolling and once for blue-green/recreate. */
  applyPhase(input: DeployAdapterInput): Promise<DeployAdapterOutput>;
  /** Roll back a single phase. Used by the rollback executor for
   * `git-revert-and-redeploy`. */
  rollbackPhase(input: DeployAdapterInput): Promise<DeployAdapterOutput>;
  /** Optional: time-machine snapshot restore. The runtime calls this
   * when `rollbackContract.method === 'time-machine-snapshot'`. */
  restoreSnapshot?(input: SnapshotRestoreInput): Promise<DeployAdapterOutput>;
}

export interface SnapshotRestoreInput {
  ticketId: string;
  solutionId: string;
  targetEnv: TargetEnv;
  snapshotKey: string;
  capabilityTokenId: string;
}

// ─── Capability broker contract (minimal slice) ───────────────────────────

/** Minimal slice of @chiefaia/capability-broker we depend on at runtime.
 * The broker package's `CapabilityBroker` satisfies this contract; we
 * accept any object that exposes `issue` so tests can stub. */
export interface CapabilityIssuer {
  issue(request: {
    name: string;
    scope: string;
    agentRole: string;
    taskId: string;
    requestedTtlMs?: number;
    reason: string;
  }): Promise<{ tokenId: string; expiresAt: number }>;
}

// ─── Steward contract ─────────────────────────────────────────────────────

/** Row written to the deploy-steward ledger. Schema mirrors the existing
 * `~/.caia/deploy-steward/runs.jsonl` rows. */
export interface StewardLedgerRow {
  ts: string;
  id: string;
  section: string;
  kind: 'deploy' | 'working_tree_patch' | 'rollback';
  node_id: string | null;
  deploy_passed: boolean;
  deploy_rc: number;
  deploy_reason: string;
  deploy_duration_ms: number;
  deploy_stdout: string;
  deploy_stderr: string;
  inuse_passed: boolean;
  inuse_rc: number;
  inuse_reason: string;
  inuse_duration_ms: number;
  inuse_stdout: string;
  inuse_stderr: string;
  green: boolean;
}

export interface StewardClient {
  /** Append a deploy row to the ledger and return the assigned id. */
  recordDeploy(row: StewardLedgerRow): Promise<void>;
  /** Poll for the matching row's `inuse_passed` + `green` fields.
   * Resolves when both are true OR the freshness window elapses. */
  pollVerification(rowId: string, opts: PollVerificationOpts): Promise<StewardVerification>;
}

export interface PollVerificationOpts {
  /** Polling interval in ms. */
  intervalMs: number;
  /** Total time to wait before giving up. */
  freshnessWindowMs: number;
  /** Optional injected clock for tests. */
  clock?: () => number;
}

export interface StewardVerification {
  status: 'green' | 'red' | 'timeout' | 'not-found';
  /** Reason string from the ledger row (or 'freshness-window-elapsed' on timeout). */
  reason: string;
  /** Final row read from the ledger, when available. */
  row?: StewardLedgerRow;
  /** Wall-clock duration spent polling. */
  durationMs: number;
}

// ─── Strategy / runner outputs ────────────────────────────────────────────

/** Per-phase record emitted by every strategy impl. */
export interface PhaseRecord {
  phase: string;
  ok: boolean;
  startedAtIso: string;
  finishedAtIso: string;
  durationMs: number;
  trafficSharePct?: number;
  healthcheck?: HealthcheckSnapshot;
  reason?: string;
  undoToken?: string;
}

/** Result of executing a deploy strategy (before steward verification). */
export interface StrategyResult {
  strategy: DeployStrategyName;
  ok: boolean;
  phases: PhaseRecord[];
  /** Failure reason from the first failed phase, when ok=false. */
  failureReason?: string;
  /** Phase index that failed (0-based), when ok=false. */
  failedPhaseIndex?: number;
}

/** Result of a rollback execution. */
export interface RollbackResult {
  attempted: boolean;
  method: RollbackMethod | null;
  ok: boolean;
  reason: string;
  durationMs: number;
  phases?: PhaseRecord[];
}

// ─── Runtime state-machine (internal) ─────────────────────────────────────

/** The internal runtime state machine inside `deploy()`. Distinct from
 * the canonical Solution lifecycle FSM (`@caia/state-machine`). The
 * canonical FSM only sees the final transition. */
export type RuntimeState =
  | 'idle'
  | 'loading-spec'
  | 'preconditions-checking'
  | 'acquiring-capability'
  | 'deploying'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'rolling-back'
  | 'rolled-back'
  | 'rollback-failed';

// ─── State-machine transition outcome ─────────────────────────────────────

export interface StateTransitionOutcome {
  attempted: boolean;
  toState: SolutionState | null;
  fromState: SolutionState | null;
  applied: boolean;
  reason: string;
  transitionResult?: SolutionTransitionResult;
}

// ─── Public deploy() configuration + result ───────────────────────────────

export interface DeployConfig {
  store: TicketStore;
  adapter: ByocAdapter;
  capabilityBroker: CapabilityIssuer;
  /** Required for non-test runs. Tests pass `skipSolutionMachine: true`. */
  solutionMachine?: SolutionLifecycleMachine;
  steward: StewardClient;
  /** Polling cadence + freshness window for the steward handoff. */
  stewardPolling?: PollVerificationOpts;
  /** Clock override for tests. */
  clock?: () => Date;
  /** Run-id factory override for tests. */
  runId?: () => string;
  /** Identity for state-machine attestation. Defaults to agent kind. */
  triggeredBy?: SolutionTriggeredBy;
  /** Skip the canonical-FSM transition (tests / dry-run). */
  skipSolutionMachine?: boolean;
  /** Optional event sink for runtime state-machine transitions. Useful
   * for dashboards + tests. */
  onRuntimeState?: (event: RuntimeStateEvent) => void;
  /** Optional event sink for deploy-observability events. The architect
   * spec's `deploymentObservability.eventTypes` lists the canonical
   * names; we emit them verbatim via this sink. */
  onDeployEvent?: (event: DeployEvent) => void;
}

export interface RuntimeStateEvent {
  ticketId: string;
  fromState: RuntimeState;
  toState: RuntimeState;
  atIso: string;
  reason?: string;
}

export type DeployEventType =
  | 'deploy.started'
  | 'deploy.succeeded'
  | 'deploy.failed'
  | 'deploy.rollback.triggered'
  | 'deploy.healthcheck.failed';

export interface DeployEvent {
  type: DeployEventType;
  ticketId: string;
  solutionId: string;
  gitSha: string;
  environment: TargetEnv;
  strategy: DeployStrategyName;
  atIso: string;
  durationMs?: number;
  healthcheckLatencyMs?: number;
  rollbackReason?: string;
}

export type DeploymentStatus =
  | 'deployed'
  | 'deployed-failed'
  | 'deployed-rolled-back'
  | 'precondition-failed'
  | 'unsupported-strategy';

export interface DeploymentResult {
  ticketId: string;
  solutionId: string;
  targetEnv: TargetEnv;
  strategy: DeployStrategyName | null;
  status: DeploymentStatus;
  /** Wall-clock duration of the entire deploy() call. */
  durationMs: number;
  startedAtIso: string;
  finishedAtIso: string;
  /** Strategy execution result (always present except on early
   * precondition-failed / unsupported-strategy). */
  strategyResult?: StrategyResult;
  /** Steward verification result. Present whenever strategy succeeded. */
  stewardVerification?: StewardVerification;
  /** Rollback result. Present whenever rollback was attempted. */
  rollback?: RollbackResult;
  /** State-machine transition outcome. */
  transition: StateTransitionOutcome;
  /** Runtime state-machine trace. */
  runtimeStateTrace: RuntimeStateEvent[];
  /** Capability token id (sealed; never the secret). */
  capabilityTokenId?: string;
  /** Final reason string — populated on failure. */
  reason?: string;
}

// Re-export StewardAttestation so callers don't need to dig into
// @caia/state-machine.
export type { StewardAttestation, SolutionState, SolutionTransitionResult, SolutionTriggeredBy };
