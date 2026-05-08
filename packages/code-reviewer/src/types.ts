/**
 * @chiefaia/code-reviewer — public type surface.
 *
 * The Code Reviewer Agent reviews PR diffs for correctness, bugs, style,
 * type safety, test coverage, naming, and comments — and emits a binary
 * `verdict` (`approve` | `request-changes`) plus the underlying findings.
 *
 * Distinct from the two sibling agents:
 *   - `@chiefaia/critic`        — security/regression/cost (BLOCKING).
 *   - `@chiefaia/reviewer`      — craftsmanship (ADVISORY-only, never blocks).
 *   - `@chiefaia/code-reviewer` — this package: correctness/bugs/style
 *                                 (BLOCKING; emits verdict).
 *
 * Code-Reviewer's domain is deliberately disjoint from both siblings:
 *   - Critic catches security/cost/coordination failure modes Mentor's
 *     taxonomy treats as adversarial. Code-Reviewer does not duplicate.
 *   - Reviewer catches stylistic improvements with no block authority.
 *     Code-Reviewer's findings either block or don't — there is no
 *     advisory-style middle tier in this agent.
 */

/** Code-Reviewer severity scale — mirrors Critic's (because both block). */
export type CodeReviewSeverity = 'low' | 'medium' | 'high' | 'critical';

export const SEVERITY_RANK: Readonly<Record<CodeReviewSeverity, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
});

/**
 * Code-Reviewer's seven dimension IDs. Each dimension maps to one of the
 * review domains operator named in `operator_decisions_2026-05-08.md`:
 * "correctness, bugs, style, test coverage, type safety, naming, comments".
 */
export type CodeReviewDimensionId =
  | 'correctness'
  | 'bug-risk'
  | 'style'
  | 'type-safety'
  | 'test-coverage'
  | 'naming'
  | 'comments';

export const ALL_DIMENSIONS: readonly CodeReviewDimensionId[] = Object.freeze([
  'correctness',
  'bug-risk',
  'style',
  'type-safety',
  'test-coverage',
  'naming',
  'comments'
]);

/** Default severity per dimension — verdict synthesiser uses these defaults
 * when the LLM doesn't volunteer one. See DESIGN.md §6. */
export const DEFAULT_SEVERITY: Readonly<Record<CodeReviewDimensionId, CodeReviewSeverity>> = Object.freeze({
  correctness: 'high',
  'bug-risk': 'high',
  style: 'low',
  'type-safety': 'medium',
  'test-coverage': 'medium',
  naming: 'low',
  comments: 'low'
});

/**
 * Critic's 18 failure-mode categories — Code-Reviewer must not duplicate.
 * Mirrored from `@chiefaia/critic` so the merger has a static denylist
 * without taking a runtime dependency on critic.
 */
export const CRITIC_DENYLIST: ReadonlySet<string> = new Set<string>([
  'hallucination',
  'scope-mismatch',
  'incompleteness',
  'wrong-direction',
  'lacking-information',
  'coordination-failure',
  'git-branch-hygiene',
  'cost-overrun',
  'security-regression',
  'operator-confusion',
  'premature-completion',
  're-litigation',
  'decision-classifier-violation',
  'memory-drift',
  'false-modesty',
  'recipe-rot',
  'tool-misuse',
  'ci-flake-masquerade'
]);

/**
 * Advisory Reviewer's 18 craftsmanship dimensions — Code-Reviewer must not
 * duplicate. Mirrored from `@chiefaia/reviewer`.
 *
 * NOTE: Code-Reviewer DOES cover `naming` and `comments` (the operator's
 * domain list explicitly names them). Reviewer's `naming-convention` and
 * `comment-density` are stylistic; Code-Reviewer's are semantic
 * (incorrect-name, misleading-comment). The merger keeps the dimensions
 * separate by ID.
 */
export const ADVISORY_REVIEWER_DENYLIST: ReadonlySet<string> = new Set<string>([
  'idiom-adherence',
  'abstraction-quality',
  'suggested-refactor',
  'test-design',
  'error-handling-style',
  'architecture-pattern',
  'documentation-quality',
  'api-ergonomics',
  'function-length',
  'file-length',
  'magic-numbers',
  'duplicate-imports',
  'deep-nesting',
  'todo-without-ticket',
  'console-logging',
  'type-any'
]);

export interface DiffHunk {
  /** File path relative to repo root (post-rename if renamed). */
  file: string;
  /** Old start line — 1-based. 0 for added files. */
  oldStart: number;
  /** New start line — 1-based. 0 for deleted files. */
  newStart: number;
  /** Hunk header — e.g. '@@ -10,5 +10,7 @@'. */
  header: string;
  /** Hunk body — contiguous diff lines. Includes ` `, `+`, `-` prefixes. */
  body: string;
  /** Status — added / modified / deleted / renamed. */
  status: 'added' | 'modified' | 'deleted' | 'renamed';
}

export interface ParsedDiff {
  hunks: DiffHunk[];
  totalBytes: number;
  fileCount: number;
}

export interface ConventionExcerpt {
  /** Source path or filename, e.g. 'AGENTS.md'. */
  source: string;
  /** Section heading. */
  heading: string;
  /** Body — first ~500 chars. */
  bodyExcerpt: string;
}

export interface ScanContext {
  /** Conventions excerpts loaded from AGENTS.md / craftsmanship docs. */
  conventionExcerpts: readonly ConventionExcerpt[];
  /** PR metadata for the LLM prompt. */
  pr: {
    prNumber: number;
    branch: string;
    baseBranch: string;
    title: string;
    body?: string;
    commitSubjects: readonly string[];
  };
  /** Wall clock for stable id-hash. */
  reviewedAtIso: string;
}

export interface CodeReviewFinding {
  /** Stable hash of `dimension|file|line|issueTitle` — dedup key. */
  id: string;
  dimension: CodeReviewDimensionId;
  severity: CodeReviewSeverity;
  file: string;
  /** 1-based line in the new file (post-change). 0 if not line-localised. */
  line: number;
  /** Short human-readable name — e.g. 'null-deref-on-result'. */
  issueTitle: string;
  /** Why this is a problem — one paragraph max. */
  description: string;
  /** Concrete steps to reproduce or to verify the bug — if applicable. */
  reproductionSteps?: string[];
  /** Suggested fix sketch. */
  suggestedFix?: string;
  source: 'deterministic' | 'llm-reasoned';
  /** Detector identifier for traceability. */
  detectorId: string;
  /** ≤200 chars of the offending diff hunk for context. */
  excerpt: string;
}

/** Binary verdict — operator-named in `operator_decisions_2026-05-08.md`:
 * "Either requests-changes blocks merge."
 */
export type Verdict = 'approve' | 'request-changes';

export interface CodeReview {
  prNumber: number;
  reviewedAtIso: string;
  /** The headline output — synthesised from finding severity + presence. */
  verdict: Verdict;
  /** All findings above the severity floor. */
  findings: CodeReviewFinding[];
  /** Findings that drove the `request-changes` verdict (severity >= floor for blocking). */
  blockingFindings: CodeReviewFinding[];
  totalFindings: number;
  summary: ReviewSummary;
}

export interface ReviewSummary {
  countBySeverity: Record<CodeReviewSeverity, number>;
  countByDimension: Partial<Record<CodeReviewDimensionId, number>>;
  chunksReviewed: number;
  durationMs: number;
  deterministic: number;
  llmReasoned: number;
  llmEnabled: boolean;
  llmReasoningSucceeded: boolean;
  /** Findings dropped because their dimension fell on Critic's denylist. */
  redirectsToCritic: number;
  /** Findings dropped because their dimension fell on advisory Reviewer's
   * denylist. Surfaces if the LLM tries to wander into stylistic-only
   * dimensions. */
  redirectsToReviewer: number;
}

/** Detector contract — every deterministic detector implements this. */
export interface Detector {
  readonly id: string;
  readonly dimension: CodeReviewDimensionId;
  scan(hunk: DiffHunk, ctx: ScanContext): CodeReviewFinding[];
}

/** LLM-reasoned tier seam — replaceable in tests. */
export interface LlmReviewer {
  review(input: LlmReviewInput): Promise<LlmReviewOutput>;
}

export interface LlmReviewInput {
  hunks: readonly DiffHunk[];
  conventionExcerpts: readonly ConventionExcerpt[];
  pr: ScanContext['pr'];
}

export interface LlmReviewOutput {
  findings: ReadonlyArray<Omit<CodeReviewFinding, 'id' | 'source' | 'detectorId'>>;
  ok: boolean;
  diagnostic?: string;
}

/** Filesystem read seam — every disk read goes through this. */
export interface FsReader {
  exists(p: string): boolean;
  readFile(p: string): string;
  readDir(p: string): string[];
}
