/**
 * @chiefaia/critic — public type surface.
 *
 * The Critic Agent classifies adversarial findings into Mentor's 18-category
 * failure-mode taxonomy (mentor_agent_directive.md). Each category is a stable
 * `FailureModeId`. Adding a 19th in Mentor's directive auto-extends Critic via
 * a fresh `taxonomyPath` reload.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
});

/**
 * Failure-mode taxonomy IDs — 1:1 with mentor_agent_directive.md
 * ## Failure-mode taxonomy. The kebab-case form is canonical for Critic;
 * Mentor's existing slug-based clusterer uses a flattened form
 * (`prematurecompletion`, `relitigation`, etc.) — bridge in
 * `taxonomy.ts::flattenForMentor`.
 */
export type FailureModeId =
  | 'hallucination'
  | 'scope-mismatch'
  | 'incompleteness'
  | 'wrong-direction'
  | 'lacking-information'
  | 'coordination-failure'
  | 'git-branch-hygiene'
  | 'cost-overrun'
  | 'security-regression'
  | 'operator-confusion'
  | 'premature-completion'
  | 're-litigation'
  | 'decision-classifier-violation'
  | 'memory-drift'
  | 'false-modesty'
  | 'recipe-rot'
  | 'tool-misuse'
  | 'ci-flake-masquerade';

export const ALL_FAILURE_MODES: readonly FailureModeId[] = Object.freeze([
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

/** Default severity floor per category — see DESIGN.md §5.4 */
export const DEFAULT_SEVERITY: Readonly<Record<FailureModeId, Severity>> = Object.freeze({
  'security-regression': 'critical',
  'cost-overrun': 'high',
  'git-branch-hygiene': 'high',
  'premature-completion': 'high',
  'hallucination': 'high',
  'wrong-direction': 'high',
  're-litigation': 'medium',
  'decision-classifier-violation': 'medium',
  'tool-misuse': 'medium',
  'incompleteness': 'medium',
  'scope-mismatch': 'medium',
  'coordination-failure': 'medium',
  'memory-drift': 'medium',
  'ci-flake-masquerade': 'medium',
  'lacking-information': 'low',
  'operator-confusion': 'low',
  'false-modesty': 'low',
  'recipe-rot': 'low'
});

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
  /** Memory roots — pre-loaded for re-litigation / memory-drift detectors. */
  memoryFiles: readonly MemoryFileRef[];
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
}

export interface MemoryFileRef {
  /** e.g. 'feedback_no_api_key_billing.md' */
  filename: string;
  /** First-line topic extracted from the markdown frontmatter `name:` field. */
  topic: string;
  /** Body — read by re-litigation detector for keyword cross-checks. */
  bodyExcerpt: string;
}

export interface AdversarialFinding {
  /** Stable hash of `category|file|line|attackVector` — dedup key. */
  id: string;
  category: FailureModeId;
  severity: Severity;
  file: string;
  /** 1-based line in the new file (post-change). 0 if not line-localised. */
  line: number;
  /** Short human-readable name e.g. 'literal-credential-shape'. */
  attackVector: string;
  /** Why this is a problem — one paragraph max. */
  description: string;
  /** Concrete steps the reader can run to reproduce. */
  reproductionSteps: string[];
  /** Optional fix sketch. */
  suggestedMitigation?: string;
  source: 'deterministic' | 'llm-reasoned';
  /** Detector identifier for traceability. */
  detectorId: string;
  /** ≤200 chars of the offending diff hunk for context. */
  excerpt: string;
}

export interface AdversarialReview {
  prNumber: number;
  reviewedAtIso: string;
  totalFindings: number;
  findings: AdversarialFinding[];
  blockingFindings: AdversarialFinding[];
  summary: ReviewSummary;
}

export interface ReviewSummary {
  countBySeverity: Record<Severity, number>;
  countByCategory: Partial<Record<FailureModeId, number>>;
  chunksReviewed: number;
  durationMs: number;
  deterministic: number;
  llmReasoned: number;
  /** True iff the LLM tier ran; false in deterministic-only mode. */
  llmEnabled: boolean;
  /** Truthful even if 0 — false signals an LLM call was attempted but failed. */
  llmReasoningSucceeded: boolean;
}

/**
 * Detector contract — every deterministic detector implements this.
 * LLM-reasoned tier is a single composed `LlmReasonedDetector` not a fleet.
 */
export interface Detector {
  readonly id: string;
  readonly category: FailureModeId;
  scan(hunk: DiffHunk, ctx: ScanContext): AdversarialFinding[];
}

/** LLM-reasoned tier seam — replaceable in tests. */
export interface LlmReasoner {
  reason(input: LlmReasonInput): Promise<LlmReasonOutput>;
}

export interface LlmReasonInput {
  hunks: readonly DiffHunk[];
  taxonomy: readonly TaxonomyEntry[];
  pr: ScanContext['pr'];
}

export interface LlmReasonOutput {
  findings: ReadonlyArray<Omit<AdversarialFinding, 'id' | 'source' | 'detectorId'>>;
  /** Whether the LLM call returned valid JSON. False → caller drops findings. */
  ok: boolean;
  /** Optional debug / error string. */
  diagnostic?: string;
}

export interface TaxonomyEntry {
  id: FailureModeId;
  /** Human-readable description from mentor_agent_directive.md taxonomy line. */
  description: string;
}

/** Filesystem read seam — every disk read goes through this. */
export interface FsReader {
  exists(p: string): boolean;
  readFile(p: string): string;
  /** List entries in a dir; `[]` if missing. */
  readDir(p: string): string[];
}
