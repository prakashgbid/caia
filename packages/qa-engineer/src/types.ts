/**
 * Public type surface for @caia/qa-engineer.
 *
 * Validates that deployed code is actually working in production. Drives
 * the canonical FSM transition `deployed -> verified` (pass) or
 * `deployed -> verify-failed` (fail) and surfaces a rollback-recommendation
 * payload that the orchestrator can act on.
 */

import type {
  ProjectState,
  StateMachine,
  TransitionResult,
  TriggeredBy,
} from '@caia/state-machine';
import type {
  AttestationCell,
  AttestationMatrix,
  AttestationStatus,
  BackendState,
  MetricBackendRef,
} from '@caia/outcome-steward';

// ─── Production target ──────────────────────────────────────────────────────

/**
 * The unit of work we're verifying. A ticket already deployed to a known
 * production URL; we validate it actually works against real traffic + the
 * declared SLI envelope.
 */
export interface ProductionTarget {
  readonly ticketId: string;
  /** Stable project identifier from the canonical FSM. */
  readonly projectId: string;
  /** Fully-qualified production URL (https://…). */
  readonly productionUrl: string;
  /** Package name whose SLIs to cross-check (e.g. "@caia/some-package"). */
  readonly packageName: string;
  /** Solution identifier from the deploy manifest, if known. */
  readonly solutionId?: string;
  /** Resolved absolute path to the package root (for SLI manifest load). */
  readonly packageRoot?: string;
  /** Optional ticket-author labels for trace/audit. */
  readonly labels?: Readonly<Record<string, string>>;
}

// ─── Playwright run plan + result ───────────────────────────────────────────

export type PlaywrightRunStatus = 'passed' | 'failed' | 'errored';

/**
 * One Playwright spec result, normalised. Each spec is one e2e scenario
 * (login, checkout, etc.). `file` + optional `line` point at the spec
 * source so the rollback recommendation can cite it.
 */
export interface PlaywrightSpecResult {
  readonly specId: string;
  readonly title: string;
  readonly file: string;
  readonly line?: number;
  readonly status: PlaywrightRunStatus | 'skipped' | 'flaky';
  readonly durationMs: number;
  readonly errorMessage?: string;
  readonly retries?: number;
  /** Was this spec marked `required` in the ticket testCases? */
  readonly required: boolean;
}

export interface PlaywrightRunResult {
  readonly status: PlaywrightRunStatus;
  readonly specs: ReadonlyArray<PlaywrightSpecResult>;
  /** Number of required-spec failures. Drives pass/fail. */
  readonly requiredFailures: number;
  readonly totalDurationMs: number;
  readonly mode: 'local' | 'browserless';
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
}

/**
 * Adapter that actually spawns Playwright. Production wires the real
 * runner; tests inject deterministic stubs.
 */
export interface PlaywrightAdapter {
  run(plan: PlaywrightRunPlan): Promise<PlaywrightRunResult>;
}

export interface PlaywrightRunPlan {
  readonly target: ProductionTarget;
  readonly specFiles: ReadonlyArray<string>;
  readonly mode: 'local' | 'browserless';
  /** Hard timeout for the whole run (ms). Default 5 min. */
  readonly timeoutMs: number;
  /** Env passthrough (CI=1 etc.). */
  readonly env: Readonly<Record<string, string>>;
}

// ─── Outcome-steward cross-check ────────────────────────────────────────────

/**
 * Result of querying @caia/outcome-steward for the deployed package's
 * declared SLIs. We do NOT re-run the full hourly steward; we cross-check
 * the just-deployed package only.
 */
export interface OutcomeStewardCheck {
  readonly backend: BackendState;
  readonly matrix: AttestationMatrix;
  /** All cells filtered to the package we deployed. */
  readonly relevantCells: ReadonlyArray<AttestationCell>;
  readonly summary: {
    readonly green: number;
    readonly yellow: number;
    readonly red: number;
    readonly noMetricDeclared: number;
    readonly noMetricStore: number;
    readonly unknown: number;
  };
  /** Overall verdict for the deployed package. */
  readonly verdict: 'all-green' | 'mixed' | 'red' | 'no-metric-declared' | 'no-metric-store' | 'degraded';
}

/**
 * Adapter that calls into @caia/outcome-steward to cross-check the
 * deployed package's SLIs. Default impl wires real `crossCheck` +
 * `classifyCell`; tests inject deterministic results.
 */
export interface OutcomeStewardAdapter {
  check(target: ProductionTarget, opts: OutcomeStewardCheckOptions): Promise<OutcomeStewardCheck>;
}

export interface OutcomeStewardCheckOptions {
  readonly backend: MetricBackendRef;
  readonly windowHours: number;
  readonly site: string;
  readonly now: () => Date;
}

// ─── Rollback recommendation ────────────────────────────────────────────────

export type RollbackSeverity = 'recommended' | 'urgent' | 'wait';

export interface RollbackRecommendation {
  readonly severity: RollbackSeverity;
  readonly reason: string;
  /** Specific evidence — Playwright spec ids + cell keys. */
  readonly evidence: {
    readonly failedSpecs: ReadonlyArray<string>;
    readonly redCells: ReadonlyArray<string>;
  };
  /** Suggested orchestrator steps. Transport-agnostic; orchestrator decides. */
  readonly steps: ReadonlyArray<string>;
}

// ─── State-machine outcome ──────────────────────────────────────────────────

export interface StateTransitionOutcome {
  readonly attempted: true;
  readonly fromState: ProjectState;
  readonly toState: ProjectState;
  readonly applied: boolean;
  readonly reason: string;
  readonly transitionResult: TransitionResult;
}

// ─── Public result ──────────────────────────────────────────────────────────

export interface ValidateInProductionResult {
  readonly ticketId: string;
  readonly projectId: string;
  readonly productionUrl: string;
  readonly packageName: string;
  readonly status: 'passed' | 'failed';
  readonly playwright: PlaywrightRunResult;
  readonly outcomeSteward?: OutcomeStewardCheck;
  readonly rollbackRecommendation?: RollbackRecommendation;
  readonly transition?: StateTransitionOutcome;
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface ValidateInProductionConfig {
  readonly playwright: PlaywrightAdapter;
  readonly outcomeSteward: OutcomeStewardAdapter;
  readonly specStrategy: SpecStrategy;
  readonly stateMachine?: StateMachine;
  readonly triggeredBy?: TriggeredBy;
  readonly skipStateMachine?: boolean;
  readonly mode?: 'local' | 'browserless';
  readonly windowHours?: number;
  readonly site?: string;
  readonly playwrightTimeoutMs?: number;
  readonly clock?: () => Date;
  readonly metricBackend?: MetricBackendRef;
}

/**
 * The strategy module that knows how to rewrite test-author-emitted e2e
 * specs so they target the production URL instead of localhost. Lives
 * in `./test-strategy.ts`; injected so tests can stub it.
 */
export interface SpecStrategy {
  resolveSpecs(target: ProductionTarget): Promise<SpecResolution>;
}

export interface SpecResolution {
  readonly specFiles: ReadonlyArray<string>;
  /**
   * Spec files that have been rewritten in-memory or out-of-tree to
   * point at `target.productionUrl`. The Playwright adapter is expected
   * to honour the `PLAYWRIGHT_BASE_URL` env or `baseURL` on
   * `definePlaywrightConfig` — this field is informational.
   */
  readonly rewrittenSpecCount: number;
  /** The base URL injected into the rewritten specs. */
  readonly baseUrl: string;
  /** Original spec dir from the test-author run (typically `tests/e2e`). */
  readonly originalSpecDir: string;
}

/**
 * Canonical FSM constants — must stay in sync with @caia/state-machine.
 * Exported so callers can reason about which states this package owns.
 */
export const SOURCE_STATE = 'deployed';
export const PASS_STATE = 'verified';
export const FAIL_STATE = 'verify-failed';

export type SourceState = typeof SOURCE_STATE;
export type PassState = typeof PASS_STATE;
export type FailState = typeof FAIL_STATE;
