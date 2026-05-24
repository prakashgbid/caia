/**
 * @caia/activation-steward — core type definitions.
 *
 * Kept in a single module so every other module imports from a single
 * source of truth and there are no cycles.
 */

// ─── Backend health ─────────────────────────────────────────────────────────

/**
 * The trace backend's self-reported health state.
 *
 * `absent`   = no telemetry pipeline is wired (the operator hasn't
 *              deployed Tempo / Jaeger / OTLP collector yet). The
 *              steward MUST NOT mark anything red on `absent`; it
 *              degrades gracefully.
 * `degraded` = backend reachable but returning errors or timing out.
 *              The steward writes `unknown` attestations and retries.
 * `present`  = backend healthy. Full attestation applies.
 */
export type TelemetryState = 'absent' | 'degraded' | 'present';

export interface BackendHealth {
  readonly telemetry: TelemetryState;
  /** Free-form note for the dashboard. */
  readonly note?: string;
}

// ─── Trace query primitives ─────────────────────────────────────────────────

export interface TraceQueryOptions {
  /** Inclusive lower bound of the freshness window. */
  readonly since: Date;
  /** Inclusive upper bound (default: now). */
  readonly until?: Date;
  /** Filter to a specific service.name. */
  readonly serviceName?: string;
  /** Filter to a specific span.name. */
  readonly spanName?: string;
  /** Filter to a specific tenant_id semantic attribute. */
  readonly tenantId?: string;
  /** Optional raw TraceQL — backend-specific. */
  readonly traceql?: string;
  /** Hard timeout per query (ms). */
  readonly timeoutMs?: number;
}

/**
 * One matched span. Backends normalise their native shape to this.
 */
export interface TraceMatch {
  readonly serviceName: string;
  readonly spanName: string;
  readonly tenantId: string | null;
  readonly callpath: string | null;
  readonly traceId: string;
  readonly spanId: string;
  readonly timestamp: Date;
  readonly status: 'ok' | 'error' | 'unset';
  /** Arbitrary attributes carried on the span. */
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

// ─── Expected call paths (manifest declaration) ─────────────────────────────

/**
 * A declared call-path that the package owner asserts will fire in
 * production within `freshnessHours`. The steward queries the trace
 * backend for evidence; a missing path is a cold-path candidate.
 */
export interface ExpectedCallPath {
  /** Stable identifier, e.g. "@caia/dispatch-gate:DisjointWriteGate.acquire". */
  readonly path: string;
  /** Service the span is expected to originate from. */
  readonly serviceName: string;
  /** Span name to match (defaults to last segment of `path`). */
  readonly spanName?: string;
  /** Freshness window in hours (default 24). */
  readonly freshnessHours?: number;
  /**
   * If true and the path is cold, the attestation is `yellow` not
   * `red`. Used for callpaths that aren't strictly required.
   */
  readonly optional?: boolean;
  /** Human-readable description for the dashboard. */
  readonly description?: string;
}

export interface PackageExpectations {
  /** The package name, e.g. "@caia/dispatch-gate". */
  readonly packageName: string;
  /** Stable solution identifier from the lockfile, if present. */
  readonly solutionId?: string;
  /** Where this declaration was loaded from. */
  readonly source: 'package.json' | 'activation.yaml';
  /** Declared expected call-paths. */
  readonly expectedCallPaths: ReadonlyArray<ExpectedCallPath>;
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
 * Per-(package, tenant, callpath) outcome of joining the manifest's
 * declared expected call-paths against the trace aggregates.
 */
export interface CrossCheckResult {
  readonly packageName: string;
  readonly tenantId: string;
  readonly callpath: ExpectedCallPath;
  /** Number of distinct spans matching the callpath in the window. */
  readonly spanCount: number;
  /** Number of distinct traces matching. */
  readonly traceCount: number;
  /** Most recent matching span's timestamp, if any. */
  readonly mostRecentAt: Date | null;
  /** Whether the path was hit in the window. */
  readonly hit: boolean;
}

// ─── Attestation matrix (per-package × per-tenant) ──────────────────────────

export type AttestationStatus = 'green' | 'yellow' | 'red' | 'no-telemetry' | 'unknown';

export interface AttestationCell {
  readonly packageName: string;
  readonly tenantId: string;
  readonly status: AttestationStatus;
  /** Number of expected paths declared. */
  readonly expectedPathCount: number;
  /** Number of expected paths actually hit. */
  readonly hitPathCount: number;
  /** Per-callpath results that drove the classification. */
  readonly callpathResults: ReadonlyArray<CrossCheckResult>;
  /** Free-form note for the dashboard. */
  readonly note?: string;
}

export interface AttestationMatrix {
  /** Cells keyed `${packageName}::${tenantId}`. */
  readonly cells: ReadonlyMap<string, AttestationCell>;
  /** Distinct tenant ids encountered. */
  readonly tenants: ReadonlyArray<string>;
  /** Distinct package names. */
  readonly packages: ReadonlyArray<string>;
}

// ─── Run artifacts ──────────────────────────────────────────────────────────

export interface Attestation {
  readonly packageName: string;
  readonly tenantId: string;
  readonly status: AttestationStatus;
  readonly windowHours: number;
  readonly observedAt: string; // ISO-8601
  readonly hitPathCount: number;
  readonly expectedPathCount: number;
  readonly note?: string;
}

export interface RunRow {
  /** Stable per-run identifier. */
  readonly runId: string;
  readonly startedAt: string; // ISO-8601
  readonly finishedAt: string; // ISO-8601
  readonly site: string;
  readonly telemetry: TelemetryState;
  readonly windowHours: number;
  readonly attestations: ReadonlyArray<Attestation>;
  readonly summary: {
    readonly green: number;
    readonly yellow: number;
    readonly red: number;
    readonly noTelemetry: number;
    readonly unknown: number;
  };
}

export interface StatusSnapshot {
  readonly latestRunId: string;
  readonly latestRunAt: string;
  readonly telemetry: TelemetryState;
  readonly summary: RunRow['summary'];
  readonly cells: ReadonlyArray<AttestationCell>;
}

// ─── Reporter ───────────────────────────────────────────────────────────────

export type ActivationEventType =
  | 'activation-steward.run.completed'
  | 'activation-steward.cold-path.detected'
  | 'activation-steward.no-telemetry.warning'
  | 'activation-steward.degraded.warning';

export interface ActivationEventPayload {
  readonly runId: string;
  readonly observedAt: string;
  readonly site: string;
  readonly telemetry: TelemetryState;
  readonly packageName?: string;
  readonly tenantId?: string;
  readonly callpath?: string;
  readonly note?: string;
}

export interface ActivationEvent {
  readonly type: ActivationEventType;
  readonly payload: ActivationEventPayload;
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
  /** INBOX path for failure routing. */
  readonly inboxPath?: string;
  /** Freshness window in hours. */
  readonly windowHours?: number;
  /** Site identifier (e.g. "caia-mac", "stolution-k3s"). */
  readonly site?: string;
  /** Backend instance to query. */
  readonly backend?: import('./trace-collector.js').TraceBackend;
  /** Don't write any artifacts; just compute. */
  readonly dryRun?: boolean;
  /** Suppress stdout chatter. */
  readonly quiet?: boolean;
  /** Optional event emitter for reporter. */
  readonly emit?: (event: ActivationEvent) => void;
  /** Override the run's clock. */
  readonly now?: () => Date;
}

export interface RunResult {
  readonly run: RunRow;
  readonly matrix: AttestationMatrix;
  readonly inboxAppended: boolean;
  readonly eventsEmitted: number;
}
