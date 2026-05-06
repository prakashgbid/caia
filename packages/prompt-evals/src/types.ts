/**
 * Public types for @chiefaia/prompt-evals.
 *
 * Promptfoo's native YAML config is the source of truth for individual
 * test cases (under `evals/<agent>.yaml`). The TS layer here ships:
 *
 *   1. A deterministic local provider (no LLM API key needed) that the
 *      YAML configs reference via `providers: ['file://./evals/_lib/local-provider.mjs']`.
 *   2. A baseline tracker that compares latest-run pass-rate against
 *      the recorded baseline in `baselines/<agent>.json`.
 *   3. A CLI that aggregates per-agent runs into a single CI-friendly
 *      JSON summary with overall pass rate + per-agent diff vs baseline.
 */

/**
 * Result for a single test case from a promptfoo run.
 */
export interface PromptfooTestResult {
  readonly testIdx: number;
  readonly description: string;
  readonly success: boolean;
  /** Optional failure reason for a failed assertion. */
  readonly failureReason?: string;
}

/**
 * Aggregate result for a single agent's eval suite.
 */
export interface AgentEvalResult {
  /** Agent slug, matching the YAML file basename (e.g., `caia-ba`). */
  readonly agent: string;
  /** Path to the YAML eval file. */
  readonly evalPath: string;
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  /** 0..1 fraction. */
  readonly passRate: number;
  readonly results: readonly PromptfooTestResult[];
}

/**
 * Per-agent baseline record stored under `baselines/<agent>.json`.
 *
 * The baseline tracker fails CI when the latest pass-rate drops below
 * `passRate - regressionTolerance`. Operators bump the baseline manually
 * via `caia-prompt-evals baseline --update <agent>` after a deliberate
 * change.
 */
export interface AgentBaseline {
  readonly agent: string;
  readonly passRate: number;
  readonly totalTests: number;
  readonly recordedAt: string;
  /** Default 0.05 (5pp regression allowed before failing CI). */
  readonly regressionTolerance: number;
}

/**
 * Per-agent diff between the current run + the recorded baseline.
 */
export interface BaselineDiff {
  readonly agent: string;
  readonly baseline: AgentBaseline | null;
  readonly current: AgentEvalResult;
  /** When `regression`, current passRate < baseline passRate - tolerance. */
  readonly status: 'no-baseline' | 'within-tolerance' | 'improved' | 'regression';
  readonly delta: number;
}

/**
 * Aggregate CI-friendly summary across every agent eval suite.
 */
export interface RunSummary {
  readonly startedAt: string;
  readonly endedAt: string;
  readonly agentCount: number;
  readonly totalTests: number;
  readonly totalPassed: number;
  readonly totalFailed: number;
  readonly overallPassRate: number;
  readonly perAgent: readonly AgentEvalResult[];
  readonly baselineDiffs: readonly BaselineDiff[];
  /** True when zero `regression` diffs were detected. */
  readonly ok: boolean;
}
