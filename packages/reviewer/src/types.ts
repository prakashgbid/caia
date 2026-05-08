/**
 * @chiefaia/reviewer — public type surface.
 *
 * The Reviewer Agent classifies craftsmanship findings into 18 dimensions
 * spanning naming/length/comments/idioms/abstraction/test-design/etc.
 * The dimension list is DISJOINT from Critic's 18 failure-mode categories
 * (mentor_agent_directive.md) — Reviewer never overlaps with Critic.
 *
 * Reviewer findings are advisory; there is NO `blockingFindings` output.
 */

/** Reviewer's severity scale — deliberately distinct lexicon from Critic.
 * Critic uses low/medium/high/critical (block-worthy spectrum); Reviewer's
 * vocabulary explicitly avoids any term that implies blocking.
 *
 * - `praise`: exemplary craftsmanship worth highlighting.
 * - `nit`: pure cosmetic; freely ignorable.
 * - `suggestion`: improves readability with low effort.
 * - `consider`: meaningful refactor opportunity, low risk.
 */
export type CraftsmanshipSeverity = 'praise' | 'nit' | 'suggestion' | 'consider';

export const SEVERITY_RANK: Readonly<Record<CraftsmanshipSeverity, number>> = Object.freeze({
  praise: 0,
  nit: 1,
  suggestion: 2,
  consider: 3
});

/**
 * Craftsmanship dimension IDs — 18 total, deliberately disjoint from
 * Critic's `FailureModeId`.
 *
 * Deterministic-tier (10): naming-convention through type-any.
 * LLM-reasoned-tier (8):   idiom-adherence through api-ergonomics.
 */
export type CraftsmanshipDimensionId =
  | 'naming-convention'
  | 'function-length'
  | 'file-length'
  | 'comment-density'
  | 'magic-numbers'
  | 'duplicate-imports'
  | 'deep-nesting'
  | 'todo-without-ticket'
  | 'console-logging'
  | 'type-any'
  | 'idiom-adherence'
  | 'abstraction-quality'
  | 'suggested-refactor'
  | 'test-design'
  | 'error-handling-style'
  | 'architecture-pattern'
  | 'documentation-quality'
  | 'api-ergonomics';

export const ALL_DIMENSIONS: readonly CraftsmanshipDimensionId[] = Object.freeze([
  'naming-convention',
  'function-length',
  'file-length',
  'comment-density',
  'magic-numbers',
  'duplicate-imports',
  'deep-nesting',
  'todo-without-ticket',
  'console-logging',
  'type-any',
  'idiom-adherence',
  'abstraction-quality',
  'suggested-refactor',
  'test-design',
  'error-handling-style',
  'architecture-pattern',
  'documentation-quality',
  'api-ergonomics'
]);

/** Default severity per dimension — see DESIGN.md §6.4 */
export const DEFAULT_SEVERITY: Readonly<Record<CraftsmanshipDimensionId, CraftsmanshipSeverity>> = Object.freeze({
  'naming-convention': 'nit',
  'function-length': 'consider',
  'file-length': 'consider',
  'comment-density': 'suggestion',
  'magic-numbers': 'suggestion',
  'duplicate-imports': 'nit',
  'deep-nesting': 'suggestion',
  'todo-without-ticket': 'nit',
  'console-logging': 'suggestion',
  'type-any': 'consider',
  'idiom-adherence': 'consider',
  'abstraction-quality': 'consider',
  'suggested-refactor': 'consider',
  'test-design': 'suggestion',
  'error-handling-style': 'suggestion',
  'architecture-pattern': 'consider',
  'documentation-quality': 'suggestion',
  'api-ergonomics': 'consider'
});

/**
 * Critic's 18 failure-mode categories — Reviewer must never overlap.
 * Mirrored verbatim from `@chiefaia/critic` types.ts so the merger has
 * a static denylist without taking a runtime dependency on critic.
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

export interface ScanContext {
  /** Conventions excerpts loaded from AGENTS.md / craftsmanship docs. */
  conventionExcerpts: readonly ConventionExcerpt[];
  /** PR metadata for hygiene checks. */
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
  /** Thresholds — pulled from ResolvedReviewerAgentConfig. */
  thresholds: {
    maxFunctionLines: number;
    maxFileLines: number;
    maxNestingDepth: number;
  };
}

export interface ConventionExcerpt {
  /** Source path or filename, e.g. 'AGENTS.md'. */
  source: string;
  /** Section heading, e.g. 'Code style (non-negotiable)'. */
  heading: string;
  /** Body — first ~500 chars. */
  bodyExcerpt: string;
}

export interface CraftsmanshipFinding {
  /** Stable hash of `dimension|file|line|suggestionTitle` — dedup key. */
  id: string;
  dimension: CraftsmanshipDimensionId;
  severity: CraftsmanshipSeverity;
  file: string;
  /** 1-based line in the new file (post-change). 0 if not line-localised. */
  line: number;
  /** Short human-readable name e.g. 'extract-magic-number'. */
  suggestionTitle: string;
  /** Why this would be cleaner — one paragraph max. */
  description: string;
  /** Optional concrete refactor sketch. */
  suggestedChange?: string;
  source: 'deterministic' | 'llm-reasoned';
  /** Detector identifier for traceability. */
  detectorId: string;
  /** ≤200 chars of the offending diff hunk for context. */
  excerpt: string;
}

export interface CraftsmanshipReview {
  prNumber: number;
  reviewedAtIso: string;
  totalFindings: number;
  findings: CraftsmanshipFinding[];
  summary: ReviewSummary;
  // Note: NO `blockingFindings` — Reviewer is advisory-only by design.
}

export interface ReviewSummary {
  countBySeverity: Record<CraftsmanshipSeverity, number>;
  countByDimension: Partial<Record<CraftsmanshipDimensionId, number>>;
  chunksReviewed: number;
  durationMs: number;
  deterministic: number;
  llmReasoned: number;
  /** True iff the LLM tier ran; false in deterministic-only mode. */
  llmEnabled: boolean;
  /** Truthful even if 0 — false signals an LLM call was attempted but failed. */
  llmReasoningSucceeded: boolean;
  /** Findings dropped because their dimension fell on Critic's denylist. */
  redirectsToCritic: number;
}

/** Detector contract — every deterministic detector implements this. */
export interface Detector {
  readonly id: string;
  readonly dimension: CraftsmanshipDimensionId;
  scan(hunk: DiffHunk, ctx: ScanContext): CraftsmanshipFinding[];
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
  findings: ReadonlyArray<Omit<CraftsmanshipFinding, 'id' | 'source' | 'detectorId'>>;
  /** Whether the LLM call returned valid JSON. False → caller drops findings. */
  ok: boolean;
  /** Optional debug / error string. */
  diagnostic?: string;
}

/** Filesystem read seam — every disk read goes through this. */
export interface FsReader {
  exists(p: string): boolean;
  readFile(p: string): string;
  /** List entries in a dir; `[]` if missing. */
  readDir(p: string): string[];
}
