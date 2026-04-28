/**
 * Shared type definitions for the orchestrator-middleware enforcement layer.
 * No HTTP calls, no framework dependencies — pure data shapes.
 *
 * @no-events — this module only defines types; no domain operations are performed here.
 */

/** A single match produced by the banned-phrase scanner. */
export interface BannedPhraseMatch {
  /** The literal phrase (or pattern description) that matched. */
  phrase: string;
  /** Zero-based character offset of the match start within the scanned message. */
  position: number;
  /** Up to 50 characters on each side of the match for human-readable context. */
  context: string;
}

/** Aggregate result returned by `scanForBannedPhrases`. */
export interface BannedPhraseResult {
  violations: BannedPhraseMatch[];
  /** True when no violations were found. */
  clean: boolean;
  /** Human-readable rewrite guidance emitted when violations exist. */
  rewriteSuggestion?: string;
}

/** Immutable record of a spawned task that must be acknowledged via task_run_record. */
export interface TaskSpawnRecord {
  sessionId: string;
  title: string;
  kind: 'code' | 'task';
  cwd: string;
  prompt: string;
  projectSlug?: string;
  domainSlugs?: string[];
  /** ISO 8601 timestamp of when the task was started. */
  startedAt: string;
  /** root_prompt_id from the governing PromptContext, if available. */
  rootPromptId?: string;
}

/** Immutable record created by `PromptContext` when a prompt body is first seen. */
export interface PromptRecord {
  body: string;
  receivedVia: 'chat' | 'api' | 'cli' | 'scheduled-task';
  /** SHA-256 hex digest of `body`, used for deduplication within a session. */
  hash: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

/** A structured compliance violation emitted by any enforcement component. */
export interface MiddlewareViolation {
  /** Rule identifier, e.g. "TRACE-001", "TASK-001", "AUTON-001". */
  ruleId: string;
  severity: 'block' | 'warn' | 'log';
  message: string;
  context: Record<string, unknown>;
  /** ISO 8601 timestamp of when the violation was recorded. */
  timestamp: string;
}
