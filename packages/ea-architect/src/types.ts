/**
 * @caia/ea-architect — public type surface.
 *
 * Types describe the plan → review → outcome contract that callers of
 * the EA Architect Agent rely on. The agent reviews PLATFORM-LEVEL plans
 * (research, spec, implementation, architecture-change, process-change)
 * against the EA Repository (ADRs, principles, lessons, risk register).
 *
 * Distinct from `@caia/ea-reviewer`: that audits per-ticket composed
 * architecture from the 17 architects; this audits platform plans.
 */

/** The five plan types the agent reviews. */
export type PlanType =
  | 'research'
  | 'spec'
  | 'implementation'
  | 'architecture-change'
  | 'process-change';

/** Outcome status for a single review pass. */
export type ReviewStatus =
  | 'approved'
  | 'approved-with-modifications'
  | 'rejected'
  | 'needs-clarification';

/** State-machine states emitted as transitions during the review cycle. */
export type EaReviewState =
  | 'ea-review-pending'
  | 'ea-review-revisions-requested'
  | 'ea-review-approved'
  | 'ea-review-conditional-approval'
  | 'ea-review-rejected'
  | 'ea-review-escalated-to-operator';

/** Reasons the agent escalates to the operator. */
export type EscalationReason =
  | 'product-pivot'
  | 'billing-model-change'
  | 'fundamental-architecture-reversal'
  | 'security-posture-change'
  | 'principle-amendment'
  | 'strategic-direction-change';

/** The model tier picked for a given review. */
export type ModelTier = 'sonnet' | 'opus';

/** Input every caller must pass to submitPlan. */
export interface PlanSubmission {
  planMarkdown: string;
  planType: PlanType;
  callerAgentId: string;
  submittedBy: string;
  /** Optional list of affected components, used for blast-radius calc. */
  affectedComponents?: string[];
  /** Optional pre-assigned submission id; one is generated otherwise. */
  submissionId?: string;
}

/** A proposed new ADR the agent drafts when the plan introduces a decision. */
export interface NewAdrDraft {
  title: string;
  status: 'Accepted' | 'Proposed';
  context: string;
  decision: string;
  consequences: string;
  /** ADR ids this new ADR supersedes (e.g. "ADR-060"). */
  supersedes?: string[];
  /** Affected components, comma-separated in the rendered ADR. */
  affectedComponents?: string[];
  /** Reversibility classification. */
  reversibility?: 'Reversible' | 'One-way' | 'Irreversible';
  /** Decision-makers field. */
  decisionMakers?: 'Operator' | 'EA Architect Agent' | 'Both';
}

/** Existing ADR the plan affects. */
export interface AffectedAdr {
  adrId: string;
  action: 'amend' | 'supersede';
  reason?: string;
}

/** Escalation envelope surfaced to the operator's INBOX. */
export interface OperatorEscalation {
  reason: string;
  decisionPoint: string;
  recommendation?: string;
  category?: EscalationReason;
}

/** Result of a single review pass. */
export interface ReviewOutcome {
  status: ReviewStatus;
  reasoning: string;
  cited_adrs: string[];
  cited_principles: string[];
  cited_lessons: string[];
  requested_modifications?: string[];
  new_adrs_to_file?: NewAdrDraft[];
  affected_existing_adrs?: AffectedAdr[];
  escalation_to_operator?: OperatorEscalation;
  /** Submission id (echo of input or freshly-generated). */
  submissionId: string;
  /** Iteration number — increments each time the caller resubmits. */
  iteration: number;
  /** ISO timestamp of when this outcome was produced. */
  reviewedAtIso: string;
  /** Model tier used. */
  modelTier: ModelTier;
}

/** One entry in the iteration history of a submission. */
export interface ReviewHistoryEntry {
  iteration: number;
  outcome: ReviewOutcome;
  transitionTo: EaReviewState;
  at: string;
}

/** Full history for a submission. */
export interface ReviewHistory {
  submissionId: string;
  callerAgentId: string;
  planType: PlanType;
  entries: ReviewHistoryEntry[];
  /** Current state. */
  currentState: EaReviewState;
}

/**
 * A loaded ADR record from the repository — used by the loader and the
 * relevance index.
 */
export interface AdrRecord {
  /** Numeric id, e.g. 15 for ADR-015. */
  id: number;
  /** Canonical "ADR-015" form. */
  adrId: string;
  /** File path on disk. */
  filePath: string;
  /** Title (first heading without the prefix). */
  title: string;
  /** Status — Accepted | Proposed | Deprecated | Superseded by ADR-XXX. */
  status: string;
  /** Affected components list (best-effort parse). */
  affectedComponents: string[];
  /** Body text for relevance scoring. */
  body: string;
  /** Tokenised keywords for the index. */
  keywords: string[];
}

/** A principle entry loaded from the repository. */
export interface PrincipleRecord {
  /** Canonical id like "P9". */
  id: string;
  /** Short title. */
  title: string;
  /** Body (statement + rationale + implications). */
  body: string;
  /** Tokenised keywords. */
  keywords: string[];
}

/** A lessons-learned entry. */
export interface LessonRecord {
  /** File-derived id like "L01" or "lesson-01". */
  id: string;
  filePath: string;
  title: string;
  body: string;
  keywords: string[];
}

/** A risk register entry (parsed best-effort). */
export interface RiskRecord {
  id: string;
  category: string;
  description: string;
  body: string;
  keywords: string[];
}

/** Feedback memory entry. */
export interface FeedbackRecord {
  /** Canonical id from frontmatter name field (e.g. "feedback-no-timelines"). */
  id: string;
  filePath: string;
  title: string;
  body: string;
  keywords: string[];
}

/** The fully-loaded EA Repository. */
export interface EaRepository {
  rootPath: string;
  adrs: AdrRecord[];
  principles: PrincipleRecord[];
  lessons: LessonRecord[];
  risks: RiskRecord[];
  feedback: FeedbackRecord[];
  /** Max ADR id observed; the next ADR is maxAdrId + 1. */
  maxAdrId: number;
}

/** A relevance score for an item against a query. */
export interface RelevanceMatch<T> {
  item: T;
  score: number;
  /** Which terms matched. */
  matchedKeywords: string[];
}

/** Topic-selected slice of the repository for context injection. */
export interface RelevantContext {
  adrs: RelevanceMatch<AdrRecord>[];
  principles: RelevanceMatch<PrincipleRecord>[];
  lessons: RelevanceMatch<LessonRecord>[];
  risks: RelevanceMatch<RiskRecord>[];
  feedback: RelevanceMatch<FeedbackRecord>[];
}

/** Emitted event envelope for state transitions. */
export interface EaReviewEvent {
  /** Dotted event type, e.g. "ea-architect.review.approved". */
  type: string;
  submissionId: string;
  callerAgentId: string;
  planType: PlanType;
  iteration: number;
  fromState: EaReviewState | null;
  toState: EaReviewState;
  outcome: ReviewOutcome;
  at: string;
}

/** Event handler. */
export type EaReviewEventHandler = (event: EaReviewEvent) => void | Promise<void>;

/** Event bus contract used by the agent. */
export interface EaEventBus {
  on(type: string, handler: EaReviewEventHandler): () => void;
  emit(event: EaReviewEvent): Promise<void>;
}

/**
 * Critic adapter — wraps the LLM call. Swappable for tests.
 * Production wires this to @chiefaia/claude-spawner via the default impl.
 */
export interface CriticAdapter {
  review(input: CriticInput): Promise<CriticOutput>;
}

export interface CriticInput {
  planMarkdown: string;
  planType: PlanType;
  affectedComponents: string[];
  context: RelevantContext;
  /** Iteration in the conversation (>=1). */
  iteration: number;
  /** Model tier requested. */
  modelTier: ModelTier;
}

export interface CriticOutput {
  /** Raw status emitted by the model. */
  status: ReviewStatus;
  reasoning: string;
  cited_adrs: string[];
  cited_principles: string[];
  cited_lessons: string[];
  requested_modifications: string[];
  new_adrs_to_file: NewAdrDraft[];
  affected_existing_adrs: AffectedAdr[];
  escalation_to_operator?: OperatorEscalation;
  /** True if the LLM call succeeded and emitted parseable JSON. */
  ok: boolean;
  diagnostic?: string;
}

/** Filesystem abstraction. */
export interface FsAdapter {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  appendFile(path: string, content: string): void;
  readDir(path: string): string[];
  mkdir(path: string): void;
}

/** Clock abstraction. */
export type Clock = () => Date;

/** Agent configuration. */
export interface EaArchitectConfig {
  /** Path to the EA Repository root. Defaults to ~/Documents/projects/caia-ea. */
  repositoryPath?: string;
  /** Path to the operator's INBOX. Defaults to ~/Documents/projects/agent-memory/INBOX.md. */
  inboxPath?: string;
  /** Path to the agent-memory directory (for feedback memories). */
  agentMemoryPath?: string;
  /** Critic adapter override. Production uses the default Claude one. */
  critic?: CriticAdapter;
  /** Event bus override. Defaults to an in-process bus. */
  eventBus?: EaEventBus;
  /** Filesystem override (tests). */
  fs?: FsAdapter;
  /** Clock override (tests). */
  clock?: Clock;
  /** UUID-like submission-id generator. */
  generateSubmissionId?: () => string;
  /** Whether to write ADRs on approval. Default true. */
  autoFileAdrs?: boolean;
  /** Whether to escalate to INBOX on escalation. Default true. */
  surfaceEscalations?: boolean;
}
