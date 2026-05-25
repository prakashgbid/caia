/**
 * @caia/usage-steward — core type definitions.
 *
 * Single source of truth for every other module. No value imports here;
 * keep this file dependency-free so any module can pull from it without
 * introducing cycles.
 */

// ─── Scanner kinds + tooling probe ──────────────────────────────────────────

/**
 * The four scanners this steward orchestrates. The names map 1:1 to
 * an npm/binary name that must be `which`-resolvable on $PATH for the
 * scanner cell to be considered live.
 */
export type ScannerKind = 'knip' | 'depcheck' | 'ts-prune' | 'dependency-cruiser';

/**
 * Per-scanner tool-availability state. The steward's graceful-degradation
 * contract: a missing binary never marks a package red — it marks the
 * scanner cell `no-tooling` and emits a degraded warning.
 *
 * `present`  = binary on $PATH, ran successfully.
 * `failed`   = binary on $PATH, but the run errored (parse error, etc.).
 * `absent`   = binary not on $PATH; cell is `no-tooling`.
 */
export type ScannerToolingState = 'present' | 'failed' | 'absent';

/**
 * The categorical kind of a finding. Each scanner can emit any subset
 * of these. The cross-checker uses the kind to decide red vs yellow.
 */
export type UsageFindingKind =
  | 'unused-file'
  | 'unused-export'
  | 'unused-enum-member'
  | 'unused-class-member'
  | 'unused-dependency'
  | 'unlisted-dependency' // declared in code, missing from package.json
  | 'unresolved-import'
  | 'circular-dependency'
  | 'orphan-module'
  | 'dev-dep-in-prod'
  | 'missing-in-package-json'
  | 'static-analysis-disagreement'; // knip says used, ts-prune says unused, etc.

/**
 * Severity of a finding. The cross-checker maps these into the cell
 * status. `info` is never enough on its own to mark a cell red.
 *
 * - `error`  — would-be-red on its own.
 * - `warn`   — yellow contribution.
 * - `info`   — informational only.
 */
export type UsageFindingSeverity = 'error' | 'warn' | 'info';

// ─── UsageFinding (the scanner output shape) ───────────────────────────────

/**
 * One finding from one scanner. Every scanner normalises its native
 * output to this shape so the rest of the steward can stay
 * scanner-agnostic.
 *
 * `packageName` is best-effort: scanner tools often report file paths
 * rather than package names. The scanner's own resolver tries to map
 * the file back to its owning package via the closest enclosing
 * package.json; if it can't, `packageName` is left null and the
 * cross-checker treats the finding as repo-scoped.
 */
export interface UsageFinding {
  readonly scanner: ScannerKind;
  readonly kind: UsageFindingKind;
  readonly severity: UsageFindingSeverity;
  /** Best-effort package the finding belongs to (e.g. "@caia/foo"). */
  readonly packageName: string | null;
  /** Absolute path to the file the scanner flagged. */
  readonly filePath: string | null;
  /** Exported symbol name, if applicable. */
  readonly symbol: string | null;
  /** Dependency name, if applicable. */
  readonly dependency: string | null;
  /** Free-form human-readable description. */
  readonly message: string;
  /** Raw scanner-specific payload, for forensic inspection. */
  readonly raw?: unknown;
}

// ─── Scanner result ─────────────────────────────────────────────────────────

/**
 * What one scanner returns from one run. The `tooling` state captures
 * whether the binary was present and exited cleanly; `findings` is the
 * normalised output. `durationMs` lets the dashboard surface slow runs.
 */
export interface ScannerResult {
  readonly scanner: ScannerKind;
  readonly tooling: ScannerToolingState;
  readonly findings: ReadonlyArray<UsageFinding>;
  readonly durationMs: number;
  /** Tool's CLI version (`knip --version`) when available. */
  readonly toolVersion?: string;
  /** If `tooling === 'failed'`, the captured error message. */
  readonly errorMessage?: string;
  /** Stdout/stderr tail (cap 4 KB each), for forensic inspection. */
  readonly stdoutTail?: string;
  readonly stderrTail?: string;
}

// ─── Expected imports (per-package manifest declaration) ───────────────────

/**
 * A declared (consumer, symbol, package) triple. The package owner
 * asserts that the named consumer must import `symbol` from this
 * package. If the import is missing from the static graph the
 * cross-checker emits a `declared-import-missing` finding and the
 * cell trends yellow → red.
 */
export interface ExpectedImport {
  /** Consumer file or package (e.g. "apps/caia/src/dispatcher.ts"). */
  readonly consumer: string;
  /** Exported symbol that must be imported. */
  readonly symbol: string;
  /**
   * Optional explicit package — defaults to the package declaring the
   * stanza. Useful when a re-export chains through another package.
   */
  readonly package?: string;
  /** Soft expectation — drift becomes yellow, not red. */
  readonly optional?: boolean;
  readonly description?: string;
}

/**
 * A declared export the steward asks knip to confirm is reachable.
 * Mirrors knip's `--include exports,nsExports,classMembers`.
 */
export interface ExpectedExport {
  readonly symbol: string;
  /** Soft expectation — orphan becomes yellow, not red. */
  readonly optional?: boolean;
  readonly description?: string;
}

/**
 * Per-package manifest. Loaded from either:
 *  - `package.json#caia.usage.expectedImports[]` / `expectedExports[]`
 *  - sibling `usage.yaml` file
 * `package.json` wins on conflict.
 */
export interface PackageExpectations {
  readonly packageName: string;
  readonly packageDir: string;
  readonly solutionId?: string;
  readonly source: 'package.json' | 'usage.yaml' | 'synthetic';
  readonly expectedImports: ReadonlyArray<ExpectedImport>;
  readonly expectedExports: ReadonlyArray<ExpectedExport>;
}

// ─── Deploy manifest (canonical list of deployed packages) ─────────────────

export interface DeployManifestEntry {
  readonly name: string;
  readonly path?: string;
  readonly solutionId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DeployManifest {
  readonly schemaVersion: number;
  readonly entries: ReadonlyArray<DeployManifestEntry>;
}

// ─── Cross-check output ────────────────────────────────────────────────────

/**
 * A single cross-check observation about one (package, expectation)
 * tuple. The cross-checker emits zero or more of these per package per
 * run.
 */
export interface CrossCheckObservation {
  readonly packageName: string;
  readonly observationKind:
    | 'declared-import-missing'
    | 'declared-import-present'
    | 'declared-export-orphan'
    | 'declared-export-reachable'
    | 'undeclared-orphan'
    | 'undeclared-unused-dep'
    | 'scanner-disagreement'
    | 'scanner-no-tooling';
  readonly severity: UsageFindingSeverity;
  readonly detail: string;
  /** The originating expectation, when applicable. */
  readonly expectedImport?: ExpectedImport;
  readonly expectedExport?: ExpectedExport;
  /** Underlying finding(s) the observation rests on. */
  readonly supportingFindings: ReadonlyArray<UsageFinding>;
}

// ─── Attestation cell + matrix ─────────────────────────────────────────────

/**
 * Per-cell attestation status. Same five-state vocabulary as
 * `@caia/activation-steward` so the lifecycle conductor can join
 * the two without translation.
 *
 * - `green`        — all expectations met; no errors.
 * - `yellow`       — soft drift (warnings, optional misses, disagreements).
 * - `red`          — at least one hard expectation missed.
 * - `no-tooling`   — every scanner was absent; degraded, not failed.
 * - `unknown`      — every available scanner errored.
 */
export type AttestationStatus = 'green' | 'yellow' | 'red' | 'no-tooling' | 'unknown';

export interface AttestationCell {
  readonly packageName: string;
  readonly solutionId: string | null;
  readonly status: AttestationStatus;
  readonly expectedImportCount: number;
  readonly satisfiedImportCount: number;
  readonly expectedExportCount: number;
  readonly reachableExportCount: number;
  readonly orphanCount: number;
  readonly unusedDepCount: number;
  readonly missingDepCount: number;
  readonly circularDepCount: number;
  readonly scannerStates: Readonly<Record<ScannerKind, ScannerToolingState>>;
  readonly observations: ReadonlyArray<CrossCheckObservation>;
  readonly note?: string;
}

export interface AttestationMatrix {
  readonly cells: ReadonlyMap<string, AttestationCell>;
  readonly orderedPackages: ReadonlyArray<string>;
}

// ─── Run row (JSONL audit line) ────────────────────────────────────────────

export interface AttestationSummary {
  readonly green: number;
  readonly yellow: number;
  readonly red: number;
  readonly noTooling: number;
  readonly unknown: number;
}

export interface AttestationEntry {
  readonly packageName: string;
  readonly solutionId: string | null;
  readonly status: AttestationStatus;
  readonly observedAt: string;
  readonly note?: string;
}

export interface RunRow {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly site: string;
  readonly packagesRoot: string;
  readonly scannerStates: Readonly<Record<ScannerKind, ScannerToolingState>>;
  readonly attestations: ReadonlyArray<AttestationEntry>;
  readonly summary: AttestationSummary;
}

export interface StatusSnapshot {
  readonly latestRunId: string;
  readonly latestRunAt: string;
  readonly site: string;
  readonly summary: AttestationSummary;
  readonly scannerStates: Readonly<Record<ScannerKind, ScannerToolingState>>;
  readonly cells: ReadonlyArray<AttestationCell>;
}

// ─── Event bus surface ─────────────────────────────────────────────────────

export type UsageEventType =
  | 'usage-steward.run.completed'
  | 'usage-steward.orphan.detected'
  | 'usage-steward.declared-import.missing'
  | 'usage-steward.scanner.degraded'
  | 'usage-steward.no-tooling.warning';

export interface UsageEventPayload {
  readonly runId: string;
  readonly observedAt: string;
  readonly site: string;
  readonly packageName?: string;
  readonly scanner?: ScannerKind;
  readonly note?: string;
  readonly detail?: string;
}

export interface UsageEvent {
  readonly type: UsageEventType;
  readonly payload: UsageEventPayload;
}

// ─── Run options + result ──────────────────────────────────────────────────

export interface RunOpts {
  /** Override Date.now (tests). */
  readonly now?: () => Date;
  /** Skip every disk write + INBOX append + bus emit. */
  readonly dryRun?: boolean;
  /** Suppress console summary. */
  readonly quiet?: boolean;
  /** Site identifier (default "caia-mac"). */
  readonly site?: string;
  /** Override packages root (default ~/Documents/projects/caia/packages). */
  readonly packagesRoot?: string;
  /** Override deploy_manifest.yaml path. */
  readonly deployManifestPath?: string;
  /** Override JSONL audit path. */
  readonly runsJsonlPath?: string;
  /** Override status snapshot path. */
  readonly statusJsonPath?: string;
  /** Override attestations green-id list path. */
  readonly attestationsJsonlPath?: string;
  /** Override INBOX path. */
  readonly inboxPath?: string;
  /**
   * Restrict to a specific list of packages (useful for tests +
   * one-shot diagnostics). When null/undefined, scans every package
   * under `packagesRoot`.
   */
  readonly only?: ReadonlyArray<string>;
  /** Override which scanners run (e.g. tests pin a deterministic subset). */
  readonly scanners?: ReadonlyArray<ScannerKind>;
  /** Event-bus emit. Defaults to a no-op. */
  readonly emit?: (event: UsageEvent) => void;
  /**
   * Inject a synthetic scanner runner. Used by tests + the integration
   * suite to substitute deterministic outputs for the real binaries.
   */
  readonly runScanner?: ScannerRunner;
}

/**
 * A function that runs one scanner against one package and returns the
 * normalised result. The default implementation shells out; tests
 * inject a deterministic stub.
 */
export type ScannerRunner = (
  scanner: ScannerKind,
  packageDir: string,
  opts: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<ScannerResult>;

export interface RunResult {
  readonly run: RunRow;
  readonly matrix: AttestationMatrix;
  readonly inboxAppended: boolean;
  readonly eventsEmitted: number;
  readonly newGreenIds: ReadonlyArray<string>;
}
