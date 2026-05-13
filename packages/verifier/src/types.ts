/**
 * Public types for @chiefaia/verifier.
 *
 * The VERIFIER spawn is the fourth review-sibling alongside Critic /
 * Code-Reviewer / Reviewer. Its domain is acceptance-criteria-satisfaction
 * (the spec-truth check), distinct from Critic's security/regression/cost,
 * Code-Reviewer's correctness/style, and Reviewer's craftsmanship.
 *
 * Authority: ~/Documents/projects/agent-memory/reliability_99pct_design_2026-05-11.md §6.3.
 */

/** Coarse-grained binary verdict for the SPS done_status_guard trigger. */
export type OverallVerdict = 'pass' | 'fail';

/** Fine-grained verdict driving slot-manager routing. */
export type FineVerdict = 'pass' | 'fail-impl' | 'fail-spec' | 'uncertain';

/** Per-AC verdict (positionally aligned with implementor self-cert). */
export type AcVerdict = 'met' | 'not-met' | 'uncertain';

/** Per-test verdict from the actual test runner output. */
export type TestVerdict = 'passing' | 'failing' | 'not-run';

/** Per-DoD-stage verdict from the diff. */
export type DodStageVerdict = 'evidenced' | 'missing-evidence' | 'not-applicable';

export type Recommendation = 'merge' | 're-implement' | 're-decompose' | 'operator-decide';

export type RoutingClass = 'autonomous-loop' | 'operator-routed';

/** Per-AC row in the verdict object. */
export interface AcVerdictRow {
  ac: string;
  verdict: AcVerdict;
  evidence: string;
  implementor_self_cert_matches?: boolean;
}

export interface TestVerdictRow {
  test: string;
  verdict: TestVerdict;
  runner_output_excerpt: string;
  implementor_self_cert_matches?: boolean;
}

export interface DodStageVerdictRow {
  stage: string;
  verdict: DodStageVerdict;
  evidence: string;
}

export interface OutOfScopeFile {
  path: string;
  implementor_rationale: string | null;
}

export interface ArchitecturalConstraintViolation {
  constraint: string;
  evidence: string;
}

/** The full strict-JSON verdict object the verifier emits. */
export interface VerifierVerdict {
  schema_version: 'v1';
  verifier_spawn_id: string;
  implementing_spawn_id: string;
  task_id: string;
  pr_url?: string | null;
  pr_head_sha?: string | null;
  overall: OverallVerdict;
  verdict: FineVerdict;
  acceptance_criteria_verdicts: AcVerdictRow[];
  tests_required_verdicts: TestVerdictRow[];
  tests_run_verdict: boolean;
  file_scope_verdict: boolean;
  dod_stages_verdicts: DodStageVerdictRow[];
  out_of_scope_files_touched: OutOfScopeFile[];
  architectural_constraint_violations: ArchitecturalConstraintViolation[];
  recommendation: Recommendation;
  reasons: string[];
  blocking: boolean;
  summary: string;
  verifier_worktree_cleaned_up?: boolean;
}

/** Inputs the verifier's prompt builder needs. */
export interface VerifierSpawnInputs {
  /** Spawn id assigned by the slot-manager for this verifier. */
  verifierSpawnId: string;
  /** Implementing spawn id (the one whose work we're verifying). */
  implementingSpawnId: string;
  /** SPS node id (the task being verified). */
  taskId: string;
  /** PR URL the implementor opened. */
  prUrl: string;
  /** Branch name of the implementor's PR (origin/<branch>). */
  prBranch: string;
  /** Base SHA of the PR (the merge-base). */
  prBaseSha: string;
  /** Head SHA of the PR — the verifier worktree is checked out at this SHA. */
  prHeadSha: string;
  /** Absolute path to the FRESH worktree the spawner created for this verifier. */
  verifierWorktree: string;
  /** Routing class — controls the `blocking` field. */
  routingClass: RoutingClass;
  /** SPS spec material (UDP-derived). */
  spec: {
    title: string;
    workDirective: string;
    parentContext: string;
    techContext: string[];
    architecturalConstraints: string[];
    dodRequiredStages: string[];
    acceptanceCriteria: Array<string | { ac?: string; text?: string }>;
    fileScope: string[];
    testsRequired: Array<string | { name?: string; path?: string; kind?: string }>;
    testsFilterExpr: string;
  };
  /** The implementor's strict-JSON DoD self-cert blob (per spawn_output_schema.v2.json). */
  implementorClaim: Record<string, unknown>;
}

/** Outcome a runner returns after a complete verifier run (worktree-managed). */
export interface VerifierRunOutcome {
  ok: boolean;
  verdict: VerifierVerdict | null;
  /** Raw last-line stdout from the spawn (for debugging when verdict=null). */
  rawLastLine: string | null;
  /** Stdout/stderr captured (truncated). */
  stdoutTail: string;
  stderrTail: string;
  /** Path of the verifier worktree the runner created/cleaned. */
  worktreePath: string;
  /** Cleanup outcome — TRUE iff the worktree was removed (success or failure). */
  worktreeCleanedUp: boolean;
  /** Why cleanup ran (success | exception | timeout) — for the cleanup audit. */
  cleanupReason: 'success' | 'exception' | 'timeout' | 'sigterm';
  /** Wall-clock elapsed in milliseconds. */
  durationMs: number;
  /** Failure reason class for the SPS, if !ok. */
  failureReason: string | null;
}
