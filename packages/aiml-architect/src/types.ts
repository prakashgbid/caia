/**
 * Core types for @chiefaia/aiml-architect.
 *
 * All types are pure data — no methods, no mutation. The four entry-point
 * methods (selectModel / reviewPromptPattern / ownEvalSuite /
 * coordinateApprenticeLoop) return immutable verdicts.
 */

// ─── Model selection ──────────────────────────────────────────────────────

export type Provider = 'local' | 'claude' | 'apprentice';

export type QualityBar = 'best-effort' | 'standard' | 'high';

export type Hardware = 'mac-m1-pro-16gb' | 'mac-m4-32gb' | 'cloud';

export interface SelectModelParams {
  /** A task-category key — matches `routing-config.ts::ROUTING_RULES[*].taskType`. */
  readonly taskCategory: string;
  /** Estimated input token count (pre-encoding). */
  readonly contextSizeTokens: number;
  /** Quality bar — 'high' forces Claude; 'standard' / 'best-effort' allow local. */
  readonly qualityBar: QualityBar;
  /** Hardware budget — defaults to mac-m1-pro-16gb. */
  readonly hardware?: Hardware;
  /** Override the decision tree. Rarely used. */
  readonly forceProvider?: Provider;
}

export interface FallbackEntry {
  readonly provider: Provider;
  readonly model: string;
}

export interface ModelChoice {
  readonly provider: Provider;
  readonly model: string;
  /** Apprentice adapter path, when provider==='apprentice'. */
  readonly adapter?: string;
  /** Human-readable rationale; surfaced into traces + agent prompts. */
  readonly rationale: string;
  /** Ordered fallback chain — each entry is one hop down. */
  readonly fallbackChain: ReadonlyArray<FallbackEntry>;
  /** Per-call cost estimate in USD; 0 for local. */
  readonly estimatedCostUsd: number;
}

// ─── Prompt-pattern review ────────────────────────────────────────────────

export type PromptPatternKind =
  | 'cot'
  | 'few-shot'
  | 'role'
  | 'json-shape'
  | 'self-consistency'
  | 'rag'
  | 'tree-of-thought'
  | 'react'
  | 'system-block'
  | 'output-shape'
  | 'token-waste'
  | 'ambiguity'
  | 'negation-density';

export type FindingSeverity = 'info' | 'warn' | 'error';

export interface PromptFinding {
  readonly pattern: PromptPatternKind;
  readonly severity: FindingSeverity;
  readonly detail: string;
  readonly recommendation: string;
}

export interface ReviewPromptPatternParams {
  /** Stable id for trace correlation; e.g. 'apprentice-corpus.distiller'. */
  readonly templateId: string;
  /** The prompt template body (entire text). */
  readonly template: string;
  /** What this prompt is intended to do. */
  readonly intendedTaskCategory: string;
  /** Expected output shape; defaults to 'plain'. */
  readonly expectedOutputShape?: 'plain' | 'json' | 'markdown' | 'code';
}

export interface ReviewResult {
  /** Score in [0,1]; 1 = ideal. */
  readonly score: number;
  readonly findings: ReadonlyArray<PromptFinding>;
  readonly recommendDspyCompile: boolean;
  readonly recommendDspyCompileReason?: string;
  /** When score < 0.5, propose a rewrite of the template. */
  readonly rewriteSuggestion?: string;
}

// ─── Eval-suite ownership ─────────────────────────────────────────────────

export type EvalIssueKind =
  | 'missing-task-coverage'
  | 'duplicate-prompt'
  | 'unanchored-assertion'
  | 'stale-baseline'
  | 'suite-not-found';

export interface EvalIssue {
  readonly kind: EvalIssueKind;
  readonly detail: string;
  readonly promptId?: string;
}

export interface EvalSuite {
  /** Absolute path to canonical-100.yaml. */
  readonly path: string;
  /** Total number of test prompts in the suite. */
  readonly promptCount: number;
  readonly lastUpdatedIso: string;
  /** Map of taskCategory → prompt count. */
  readonly perTaskCategoryCoverage: Readonly<Record<string, number>>;
  /** Map of assertion type → usage count. */
  readonly perAssertionTypeUsage: Readonly<Record<string, number>>;
  /** Audit findings; empty when the suite is healthy. */
  readonly integrityIssues: ReadonlyArray<EvalIssue>;
}

// ─── Apprentice loop coordination ─────────────────────────────────────────

export type CoordinateDecision = 'retrain' | 'hold' | 'promote-canary' | 'rollback';

export interface FailureSignal {
  readonly eventType: string;
  readonly count: number;
  readonly sinceMs: number;
}

export interface CostSignal {
  readonly dimension: string;
  readonly severity: string;
  readonly detail: string;
}

export interface TrainingPlan {
  readonly decision: CoordinateDecision;
  readonly rationale: string;
  /** Path to a candidate adapter when decision==='promote-canary'. */
  readonly candidateAdapterPath?: string;
  /** Estimated cost (USD) of the recommended action. */
  readonly estimatedCostUsd: number;
  /** Window-start that triggered this verdict. */
  readonly eligibleSinceMs?: number;
  readonly failureSignals: ReadonlyArray<FailureSignal>;
  readonly costSignals: ReadonlyArray<CostSignal>;
}

// ─── Read-only ports (test seams) ────────────────────────────────────────

export interface FsReader {
  exists(path: string): boolean;
  readDir(path: string): string[];
  readFile(path: string): string;
  stat(path: string): { mtimeMs: number; size: number; isFile: boolean };
}

/** Minimal projection of `@chiefaia/mentor-event-bus`'s EmittedEvent. */
export interface MentorEventRecord {
  readonly id: string;
  readonly type: string;
  readonly emittedAtMs: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface MentorReader {
  /**
   * Read events newer than `sinceMs`. Bounded — implementations may cap.
   */
  readSince(sinceMs: number, limit?: number): MentorEventRecord[];
}

/** Read-only Curator finding stream. Mirrors `Finding` from @chiefaia/curator. */
export interface CuratorFinding {
  readonly scannerId: string;
  readonly category: string;
  readonly dimension: string;
  readonly severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  readonly title: string;
  readonly detail: string;
  readonly detectedAtMs: number;
}

export interface CuratorReader {
  /** Latest findings; bounded. */
  readRecent(limit?: number): CuratorFinding[];
}

/** Read-only adapter registry on disk. */
export interface AdapterRegistryEntry {
  readonly name: string;
  readonly path: string;
  readonly winRate?: number;
  readonly forgettingFlags?: number;
  readonly blessedAtMs?: number;
}

export interface AdapterRegistryReader {
  list(): AdapterRegistryEntry[];
}
