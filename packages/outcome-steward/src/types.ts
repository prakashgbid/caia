/**
 * @caia/outcome-steward — core type definitions.
 *
 * Kept in a single module so every other module imports from a single
 * source of truth and there are no cycles.
 *
 * Spec: research/real_definition_of_done_enforcement_2026.md §4.3 + §12 A8.
 */

// ─── Backend health ─────────────────────────────────────────────────────────

/**
 * The metric backend's self-reported state.
 *
 * `absent`   = no metric store is reachable (Prometheus / Grafana not
 *              deployed yet). The steward MUST NOT mark anything red on
 *              `absent`; it degrades gracefully.
 * `degraded` = backend reachable but returning errors or timing out.
 *              The steward writes `unknown` attestations and retries.
 * `present`  = backend healthy. Full attestation applies.
 */
export type BackendState = 'absent' | 'degraded' | 'present';

export interface BackendHealth {
  readonly backend: BackendState;
  /** Free-form note for the dashboard. */
  readonly note?: string;
}

// ─── Forward reference for MetricBackend (structurally typed here to avoid cycles) ─

export interface MetricBackendRef {
  readonly kind: string;
  health(): Promise<BackendHealth>;
  query(opts: MetricQueryOptions): Promise<MetricSeries>;
}

// ─── Metric query primitives ────────────────────────────────────────────────

/**
 * One sample of a time-series: `[unixSeconds, value]`.
 */
export type MetricSample = readonly [number, number];

/**
 * A queried time-series. The result of one metric query.
 */
export interface MetricSeries {
  /** The PromQL / Grafana query string that produced this series. */
  readonly query: string;
  /** Optional metric name extracted from the result labels. */
  readonly metric: string | null;
  /** Sample points sorted ascending by timestamp. */
  readonly samples: ReadonlyArray<MetricSample>;
  /** Optional labels from the result vector. */
  readonly labels: Readonly<Record<string, string>>;
}

export interface MetricQueryOptions {
  /** Inclusive lower bound of the freshness window. */
  readonly since: Date;
  /** Inclusive upper bound (default: now). */
  readonly until?: Date;
  /** Step in seconds for range queries. */
  readonly stepSeconds?: number;
  /** Raw PromQL expression. */
  readonly query: string;
  /** Hard timeout per query (ms). */
  readonly timeoutMs?: number;
}

// ─── Threshold direction operators ──────────────────────────────────────────

/**
 * Threshold compare operator.
 *
 *   gt  — value must be > threshold
 *   gte — value must be >= threshold
 *   lt  — value must be < threshold
 *   lte — value must be <= threshold
 *   eq  — value must be == threshold (within epsilon)
 *   neq — value must be != threshold (within epsilon)
 */
export type ThresholdDirection = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

/**
 * Expected trend direction of the linear regression slope over the window.
 *
 *   up      — slope must be positive (improving for "higher is better" SLIs)
 *   down    — slope must be negative (improving for "lower is better" SLIs)
 *   flat    — slope must be near zero (stable SLI)
 *   any     — no trend check; only the threshold gate matters
 */
export type TrendDirection = 'up' | 'down' | 'flat' | 'any';

export type TrendResult = 'up' | 'down' | 'flat' | 'unknown';

// ─── Expected SLI (manifest declaration) ────────────────────────────────────

/**
 * A declared SLI / metric that the package owner asserts will move in
 * the declared direction within `freshnessHours`. The steward queries
 * the metric backend; a missing or off-trend metric is flagged.
 */
export interface ExpectedSli {
  /** Stable identifier, e.g. "@caia/dispatch-gate:request_latency_p95". */
  readonly metric: string;
  /** Raw PromQL expression to evaluate. */
  readonly query: string;
  /** Threshold value. */
  readonly threshold: number;
  /** Compare operator. */
  readonly direction: ThresholdDirection;
  /** Expected trend direction over the window. Defaults to 'any'. */
  readonly trendDirection?: TrendDirection;
  /** Freshness window in hours (default 24). */
  readonly freshnessHours?: number;
  /**
   * If true and the metric is missing/off-trend, the attestation is
   * `yellow` not `red`. Used for SLIs that aren't strictly required.
   */
  readonly optional?: boolean;
  /** Human-readable description for the dashboard. */
  readonly description?: string;
}

export interface PackageExpectations {
  /** Package name, e.g. "@caia/dispatch-gate". */
  readonly packageName: string;
  /** Stable solution identifier from the lockfile, if present. */
  readonly solutionId?: string;
  /** Where this declaration was loaded from. */
  readonly source: 'package.json' | 'outcome.yaml';
  /** Declared expected SLIs. */
  readonly expectedSli: ReadonlyArray<ExpectedSli>;
}

// ─── Deploy manifest (subset we care about) ─────────────────────────────────

export interface DeployManifestEntry {
  /** Package name, e.g. "@caia/dispatch-gate". */
  readonly name: string;
  /** Absolute or repo-relative path to the package root. */
  readonly path?: string;
  /** Identifier of the deployed solution, if declared. */
  readonly solutionId?: string;
  /** Free-form metadata. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DeployManifest {
  readonly schemaVersion: number;
  readonly entries: ReadonlyArray<DeployManifestEntry>;
}

// ─── Cross-check result ─────────────────────────────────────────────────────

/**
 * Per-(package, solution, sliMetric) outcome of joining the manifest's
 * declared expected SLIs against the metric backend.
 */
export interface CrossCheckResult {
  readonly packageName: string;
  readonly solutionId: string;
  readonly sli: ExpectedSli;
  /** Latest value of the metric in the window, or null if absent. */
  readonly latestValue: number | null;
  /** Linear-regression slope (units per hour). */
  readonly trendSlopePerHour: number | null;
  /** Trend classification derived from the slope + trendDirection. */
  readonly trend: TrendResult;
  /** Whether the latest value satisfies the threshold check. */
  readonly thresholdSatisfied: boolean;
  /** Whether the trend satisfies the declared trendDirection. */
  readonly trendSatisfied: boolean;
  /** Whether the metric had any samples at all in the window. */
  readonly metricPresent: boolean;
  /** Number of samples returned. */
  readonly sampleCount: number;
  /** ISO timestamp of the most recent sample, if any. */
  readonly mostRecentAtIso: string | null;
}

// ─── Attestation matrix (per-(package, solution, sli)) ──────────────────────

export type AttestationStatus =
  | 'green'
  | 'yellow'
  | 'red'
  | 'no-metric-declared'
  | 'no-metric-store'
  | 'unknown';

export interface AttestationCell {
  readonly packageName: string;
  readonly solutionId: string;
  readonly sliMetric: string;
  readonly status: AttestationStatus;
  /** Latest observed value. */
  readonly latestValue: number | null;
  readonly threshold: number;
  readonly direction: ThresholdDirection;
  readonly trend: TrendResult;
  readonly trendSlopePerHour: number | null;
  /** The cross-check row that drove the classification. */
  readonly result: CrossCheckResult | null;
  /** Free-form note for the dashboard. */
  readonly note?: string;
}

export interface AttestationMatrix {
  /** Cells keyed `${packageName}::${solutionId}::${sliMetric}`. */
  readonly cells: ReadonlyMap<string, AttestationCell>;
  /** Distinct package names. */
  readonly packages: ReadonlyArray<string>;
  /** Distinct solution ids encountered. */
  readonly solutions: ReadonlyArray<string>;
}

// ─── Run artifacts ──────────────────────────────────────────────────────────

export interface Attestation {
  readonly packageName: string;
  readonly solutionId: string;
  readonly sliMetric: string;
  readonly status: AttestationStatus;
  readonly latestValue: number | null;
  readonly threshold: number;
  readonly direction: ThresholdDirection;
  readonly trend: TrendResult;
  readonly trendSlopePerHour: number | null;
  readonly windowHours: number;
  readonly observedAt: string; // ISO-8601
  readonly note?: string;
}

export interface RunRow {
  readonly runId: string;
  readonly startedAt: string; // ISO-8601
  readonly finishedAt: string; // ISO-8601
  readonly site: string;
  readonly backend: BackendState;
  readonly windowHours: number;
  readonly attestations: ReadonlyArray<Attestation>;
  readonly summary: {
    readonly green: number;
    readonly yellow: number;
    readonly red: number;
    readonly noMetricDeclared: number;
    readonly noMetricStore: number;
    readonly unknown: number;
  };
}

export interface StatusSnapshot {
  readonly latestRunId: string;
  readonly latestRunAt: string;
  readonly backend: BackendState;
  readonly summary: RunRow['summary'];
  readonly cells: ReadonlyArray<AttestationCell>;
}

/**
 * One row in the green-attestations JSONL — input to the SPS 5th-AND
 * completion gate (only green outcome attestations let a Solution
 * transition to `done`).
 */
export interface GreenAttestation {
  readonly attestationId: string;
  readonly runId: string;
  readonly packageName: string;
  readonly solutionId: string;
  readonly sliMetric: string;
  readonly value: number;
  readonly threshold: number;
  readonly direction: ThresholdDirection;
  readonly windowHours: number;
  readonly observedAt: string;
  readonly site: string;
}

// ─── Reporter ───────────────────────────────────────────────────────────────

/**
 * Eight event types emitted by the reporter (per spec §4.3):
 *
 *  - outcome-steward.run.completed              (always, exactly once)
 *  - outcome-steward.attestation.green          (per green cell — input to 5th-AND gate)
 *  - outcome-steward.attestation.red            (per red cell)
 *  - outcome-steward.attestation.yellow         (per yellow cell)
 *  - outcome-steward.cold-metric.detected       (per cell where the metric is missing entirely)
 *  - outcome-steward.trend-violation.detected   (per cell where threshold ok but trend wrong)
 *  - outcome-steward.no-metric-store.warning    (once iff backend === 'absent')
 *  - outcome-steward.degraded.warning           (once iff backend === 'degraded')
 */
export type OutcomeEventType =
  | 'outcome-steward.run.completed'
  | 'outcome-steward.attestation.green'
  | 'outcome-steward.attestation.red'
  | 'outcome-steward.attestation.yellow'
  | 'outcome-steward.cold-metric.detected'
  | 'outcome-steward.trend-violation.detected'
  | 'outcome-steward.no-metric-store.warning'
  | 'outcome-steward.degraded.warning';

export interface OutcomeEventPayload {
  readonly runId: string;
  readonly observedAt: string;
  readonly site: string;
  readonly backend: BackendState;
  readonly packageName?: string;
  readonly solutionId?: string;
  readonly sliMetric?: string;
  readonly latestValue?: number | null;
  readonly threshold?: number;
  readonly direction?: ThresholdDirection;
  readonly trend?: TrendResult;
  readonly note?: string;
}

export interface OutcomeEvent {
  readonly type: OutcomeEventType;
  readonly payload: OutcomeEventPayload;
}

// ─── Configuration ──────────────────────────────────────────────────────────

export interface RunOpts {
  /** Where to look for the canonical deploy manifest. */
  readonly deployManifestPath?: string;
  /** Where to look for packages. Defaults to the repo's `packages/`. */
  readonly packagesRoot?: string;
  /** JSONL audit log path. */
  readonly runsJsonlPath?: string;
  /** Status snapshot path. */
  readonly statusJsonPath?: string;
  /** Green-attestation JSONL path. */
  readonly attestationsJsonlPath?: string;
  /** INBOX path for failure routing. */
  readonly inboxPath?: string;
  /** Freshness window in hours. */
  readonly windowHours?: number;
  /** Site identifier (e.g. "caia-mac", "stolution-k3s"). */
  readonly site?: string;
  /** Backend instance to query. */
  readonly backend?: MetricBackendRef;
  /** Don't write any artifacts; just compute. */
  readonly dryRun?: boolean;
  /** Suppress stdout chatter. */
  readonly quiet?: boolean;
  /** Optional event emitter for reporter. */
  readonly emit?: (event: OutcomeEvent) => void;
  /** Override the run's clock. */
  readonly now?: () => Date;
}

export interface RunResult {
  readonly run: RunRow;
  readonly matrix: AttestationMatrix;
  readonly greenCount: number;
  readonly inboxAppended: boolean;
  readonly eventsEmitted: number;
}
