/**
 * Shared types for the Curator scan-loop.
 *
 * The scan loop is intentionally generic so future PRs can add more
 * scanners across the 80-dimension taxonomy from
 * `agent/memory/curator_agent_directive.md` without changing the
 * orchestrator or the digest renderer.
 *
 * A Scanner returns Findings. A Finding is a structured statement of:
 *   - what dimension it touches
 *   - how severe it is
 *   - the impact / effort of fixing it
 *   - the evidence backing the claim
 *   - a recommendation
 *
 * The Curator orchestrator runs a set of scanners over a ScanContext
 * (paths, env vars, injected shell function for tests), aggregates
 * Findings, and the digest renderer turns them into a markdown report.
 */

/**
 * The 10 categories from `curator_agent_directive.md`. Each Finding
 * declares which it belongs to so the digest can section by category.
 */
export type Category =
  | 'Quality & Performance'
  | 'Subscription & Resource Efficiency'
  | 'Intelligence & Autonomy'
  | 'Reliability & Resilience'
  | 'Security & Trust'
  | 'Code Health & Maintainability'
  | 'Observability & Operations'
  | 'Developer & User Experience'
  | 'Strategic & Ecosystem'
  | 'Curator Self-improvement';

/**
 * Severity of a Finding. 'info' is purely descriptive (no action
 * needed); 'low' / 'medium' / 'high' / 'critical' grade the urgency.
 */
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/**
 * Effort estimate. Curator ranks findings by impact / effort so cheap
 * + impactful changes float to the top of the digest.
 */
export type Effort = 'trivial' | 'small' | 'medium' | 'large' | 'xlarge';

/**
 * A single Finding from a scanner.
 */
export interface Finding {
  /** The scanner that produced this finding (used for traceability + dedup). */
  scannerId: string;
  /** The dimension touched (free-form text — taxonomy is extensible per directive). */
  dimension: string;
  /** Which of the 10 categories this finding belongs to. */
  category: Category;
  /** Severity. */
  severity: Severity;
  /** One-line headline. */
  title: string;
  /** Human-readable detail (markdown ok). */
  detail: string;
  /** Evidence: file paths, command outputs, line numbers, etc. */
  evidence: string[];
  /** Recommended next step. */
  recommendation: string;
  /** Effort estimate. */
  effort: Effort;
  /**
   * Numeric impact score (0..100). Combined with effort to rank.
   * Conservative default: 50.
   */
  impactScore: number;
  /** When the finding was produced. */
  detectedAt: string;
}

/**
 * The context passed to each scanner. Carries the paths it may read +
 * an injected shell-runner so tests don't actually exec anything.
 */
export interface ScanContext {
  /** Absolute path to the caia repo root. */
  repoRoot: string;
  /** Absolute path to the agent memory directory. */
  memoryDir: string;
  /** Absolute path to the reports directory (digests land here). */
  reportsDir: string;
  /**
   * Shell-runner injected by the orchestrator. Returns stdout (trimmed).
   * Should throw on non-zero exit. Tests pass a mock; production passes
   * a real `execFileSync` wrapper.
   */
  runShell: (cmd: string, args: string[]) => string;
  /**
   * Optional environment access (for env-var lookups). Defaults to
   * `process.env`; tests pass a fixed object.
   */
  env?: Record<string, string | undefined>;
  /** Injected clock; defaults to `() => new Date()`. */
  now?: () => Date;
}

/** A scanner — pure function over a ScanContext returning Findings. */
export interface Scanner {
  /** Stable identifier (used in Finding.scannerId). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Which category most of its findings belong to. */
  category: Category;
  /** Run the scan. May be sync or async. */
  scan(ctx: ScanContext): Promise<Finding[]> | Finding[];
}

/**
 * The aggregated result of a scan run — used by the digest renderer.
 */
export interface ScanRunResult {
  /** When the run started + ended. */
  startedAt: string;
  endedAt: string;
  /** All findings, in scanner-registration order. */
  findings: Finding[];
  /** Per-scanner timing + finding count. */
  perScanner: Array<{
    scannerId: string;
    name: string;
    durationMs: number;
    findingCount: number;
    error: string | null;
  }>;
}
